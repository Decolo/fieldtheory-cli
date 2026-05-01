import { countLikeProjections } from './archive-projections.js';
import { buildLikeAnalysisInput, listLikeAnalysisInputs, type LikeAnalysisInput } from './like-analysis-input.js';
import { createLikeAnalysisProvider, normalizeLikeAnalysisDraft, type LikeAnalysisProvider } from './like-analysis-provider.js';
import { buildLikeAnalysisMeta, mergeLikeAnalysisRecords, readLikeAnalysisRecords } from './like-analysis-store.js';
import type {
  LikeAnalysisMeta,
  LikeAnalysisModelInfo,
  LikeAnalysisRecord,
} from './like-analysis-types.js';
import { loadLikeAnalysisProviderConfig, type LikeAnalysisProviderConfig } from './config.js';

export interface RunLikeAnalysisOptions {
  limit?: number;
  batchSize?: number;
  refresh?: boolean;
  provider?: LikeAnalysisProvider;
  config?: LikeAnalysisProviderConfig;
  now?: () => Date;
  onProgress?: (progress: LikeAnalysisProgress) => void;
}

export interface LikeAnalysisProgress {
  completed: number;
  total: number;
  failed: number;
  batchNumber: number;
  batchTotal: number;
}

export interface LikeAnalysisRunResult {
  records: LikeAnalysisRecord[];
  meta: LikeAnalysisMeta;
  skippedCount: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function deterministicHintStrings(input: LikeAnalysisInput): string[] {
  return input.deterministicHints.map((hint) => `${hint.kind}:${hint.value}`);
}

function buildRecord(
  input: LikeAnalysisInput,
  draft: ReturnType<typeof normalizeLikeAnalysisDraft>,
  model: LikeAnalysisModelInfo,
  classifiedAt: string,
): LikeAnalysisRecord {
  return {
    id: input.id,
    tweetId: input.tweetId,
    url: input.url,
    sourceLikeId: input.id,
    authorHandle: input.authorHandle,
    primaryCategory: draft.primaryCategory,
    subcategory: draft.subcategory,
    contentType: draft.contentType,
    tags: draft.tags,
    summary: draft.summary,
    confidence: draft.confidence,
    rationale: draft.rationale,
    evidence: draft.evidence,
    deterministicHints: deterministicHintStrings(input),
    model,
    classifiedAt,
    sourceUpdatedAt: input.likedAt ?? input.postedAt ?? null,
  };
}

export async function classifyLikeAnalysisInputs(
  inputs: LikeAnalysisInput[],
  options: RunLikeAnalysisOptions = {},
): Promise<LikeAnalysisRecord[]> {
  const config = options.config ?? loadLikeAnalysisProviderConfig();
  const provider = options.provider ?? createLikeAnalysisProvider(config);
  const batchSize = Math.max(1, Number(options.batchSize ?? config.batchSize) || 1);
  const now = options.now ?? (() => new Date());
  const batches = chunk(inputs, batchSize);
  const records: LikeAnalysisRecord[] = [];
  let failed = 0;

  for (const [index, batch] of batches.entries()) {
    try {
      const drafts = await provider.classify(batch);
      for (const [itemIndex, input] of batch.entries()) {
        const draft = normalizeLikeAnalysisDraft(drafts[itemIndex] ?? {}, input);
        records.push(buildRecord(input, draft, provider.model, now().toISOString()));
      }
    } catch (error) {
      failed += batch.length;
      throw new Error(`Like analysis batch ${index + 1} failed: ${(error as Error).message}`);
    } finally {
      options.onProgress?.({
        completed: records.length,
        total: inputs.length,
        failed,
        batchNumber: index + 1,
        batchTotal: batches.length,
      });
    }
  }

  return records;
}

export async function runLikeAnalysis(
  options: RunLikeAnalysisOptions = {},
): Promise<LikeAnalysisRunResult> {
  const config = options.config ?? loadLikeAnalysisProviderConfig();
  const provider = options.provider ?? createLikeAnalysisProvider(config);
  const allInputs = await listLikeAnalysisInputs({ limit: options.limit });
  const existing = await readLikeAnalysisRecords();
  const existingTweetIds = new Set(existing.map((record) => record.tweetId));
  const inputs = options.refresh
    ? allInputs
    : allInputs.filter((input) => !existingTweetIds.has(input.tweetId));
  const sourceCount = await countLikeProjections().catch(() => inputs.length);
  const batchSize = Math.max(1, Number(options.batchSize ?? config.batchSize) || 1);
  const batches = chunk(inputs, batchSize);
  const now = options.now ?? (() => new Date());
  let merged = existing;
  let completed = 0;
  let failedCount = 0;
  let meta = buildLikeAnalysisMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    analyzedCount: existing.length,
    failedCount: 0,
    model: provider.model,
  });

  for (const [index, batch] of batches.entries()) {
    const batchRecords: LikeAnalysisRecord[] = [];
    try {
      batchRecords.push(...await classifyLikeAnalysisInputs(batch, {
        batchSize,
        config,
        provider,
        now,
      }));
    } catch (error) {
      if (batch.length <= 1) {
        failedCount += batch.length;
      } else {
        for (const input of batch) {
          try {
            batchRecords.push(...await classifyLikeAnalysisInputs([input], {
              batchSize: 1,
              config,
              provider,
              now,
            }));
          } catch {
            failedCount += 1;
          }
        }
      }
    }

    completed += batch.length;
    if (batchRecords.length > 0) {
      meta = buildLikeAnalysisMeta({
        generatedAt: now().toISOString(),
        sourceCount,
        analyzedCount: merged.length + batchRecords.length,
        failedCount,
        model: provider.model,
      });
      merged = await mergeLikeAnalysisRecords(batchRecords, meta);
    }

    options.onProgress?.({
      completed,
      total: inputs.length,
      failed: failedCount,
      batchNumber: index + 1,
      batchTotal: batches.length,
    });
  }

  meta = buildLikeAnalysisMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    analyzedCount: merged.length,
    failedCount,
    model: provider.model,
  });
  if (inputs.length === 0 || failedCount > 0) {
    merged = await mergeLikeAnalysisRecords([], meta);
  }
  return {
    records: merged,
    meta: {
      ...meta,
      analyzedCount: merged.length,
    },
    skippedCount: options.refresh ? 0 : allInputs.length - inputs.length,
  };
}

export { buildLikeAnalysisInput };
