import { countBookmarkProjections } from './archive-projections.js';
import { buildBookmarkAnalysisInput, listBookmarkAnalysisInputs, type BookmarkAnalysisInput } from './bookmark-analysis-input.js';
import { createBookmarkAnalysisProvider, normalizeBookmarkAnalysisDraft, type BookmarkAnalysisProvider } from './bookmark-analysis-provider.js';
import { buildBookmarkAnalysisMeta, mergeBookmarkAnalysisRecords, readBookmarkAnalysisRecords } from './bookmark-analysis-store.js';
import type {
  BookmarkAnalysisMeta,
  BookmarkAnalysisModelInfo,
  BookmarkAnalysisRecord,
} from './bookmark-analysis-types.js';
import { loadBookmarkAnalysisProviderConfig, type BookmarkAnalysisProviderConfig } from './config.js';

export interface RunBookmarkAnalysisOptions {
  limit?: number;
  batchSize?: number;
  refresh?: boolean;
  provider?: BookmarkAnalysisProvider;
  config?: BookmarkAnalysisProviderConfig;
  now?: () => Date;
  onProgress?: (progress: BookmarkAnalysisProgress) => void;
}

export interface BookmarkAnalysisProgress {
  completed: number;
  total: number;
  failed: number;
  batchNumber: number;
  batchTotal: number;
}

export interface BookmarkAnalysisRunResult {
  records: BookmarkAnalysisRecord[];
  meta: BookmarkAnalysisMeta;
  skippedCount: number;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function deterministicHintStrings(input: BookmarkAnalysisInput): string[] {
  return input.deterministicHints.map((hint) => `${hint.kind}:${hint.value}`);
}

function buildRecord(
  input: BookmarkAnalysisInput,
  draft: ReturnType<typeof normalizeBookmarkAnalysisDraft>,
  model: BookmarkAnalysisModelInfo,
  classifiedAt: string,
): BookmarkAnalysisRecord {
  return {
    id: input.id,
    tweetId: input.tweetId,
    url: input.url,
    sourceBookmarkId: input.id,
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
    sourceUpdatedAt: input.bookmarkedAt ?? input.postedAt ?? null,
  };
}

export async function classifyBookmarkAnalysisInputs(
  inputs: BookmarkAnalysisInput[],
  options: RunBookmarkAnalysisOptions = {},
): Promise<BookmarkAnalysisRecord[]> {
  const config = options.config ?? loadBookmarkAnalysisProviderConfig();
  const provider = options.provider ?? createBookmarkAnalysisProvider(config);
  const batchSize = Math.max(1, Number(options.batchSize ?? config.batchSize) || 1);
  const now = options.now ?? (() => new Date());
  const batches = chunk(inputs, batchSize);
  const records: BookmarkAnalysisRecord[] = [];
  let failed = 0;

  for (const [index, batch] of batches.entries()) {
    try {
      const drafts = await provider.classify(batch);
      for (const [itemIndex, input] of batch.entries()) {
        const draft = normalizeBookmarkAnalysisDraft(drafts[itemIndex] ?? {}, input);
        records.push(buildRecord(input, draft, provider.model, now().toISOString()));
      }
    } catch (error) {
      failed += batch.length;
      throw new Error(`Bookmark analysis batch ${index + 1} failed: ${(error as Error).message}`);
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

export async function runBookmarkAnalysis(
  options: RunBookmarkAnalysisOptions = {},
): Promise<BookmarkAnalysisRunResult> {
  const config = options.config ?? loadBookmarkAnalysisProviderConfig();
  const provider = options.provider ?? createBookmarkAnalysisProvider(config);
  const allInputs = await listBookmarkAnalysisInputs({ limit: options.limit });
  const existing = await readBookmarkAnalysisRecords();
  const existingTweetIds = new Set(existing.map((record) => record.tweetId));
  const inputs = options.refresh
    ? allInputs
    : allInputs.filter((input) => !existingTweetIds.has(input.tweetId));
  const sourceCount = await countBookmarkProjections().catch(() => inputs.length);
  const batchSize = Math.max(1, Number(options.batchSize ?? config.batchSize) || 1);
  const batches = chunk(inputs, batchSize);
  const now = options.now ?? (() => new Date());
  let merged = existing;
  let completed = 0;
  let failedCount = 0;
  let meta = buildBookmarkAnalysisMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    analyzedCount: existing.length,
    failedCount: 0,
    model: provider.model,
  });

  for (const [index, batch] of batches.entries()) {
    const batchRecords: BookmarkAnalysisRecord[] = [];
    try {
      batchRecords.push(...await classifyBookmarkAnalysisInputs(batch, {
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
            batchRecords.push(...await classifyBookmarkAnalysisInputs([input], {
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
      meta = buildBookmarkAnalysisMeta({
        generatedAt: now().toISOString(),
        sourceCount,
        analyzedCount: merged.length + batchRecords.length,
        failedCount,
        model: provider.model,
      });
      merged = await mergeBookmarkAnalysisRecords(batchRecords, meta);
    }

    options.onProgress?.({
      completed,
      total: inputs.length,
      failed: failedCount,
      batchNumber: index + 1,
      batchTotal: batches.length,
    });
  }

  meta = buildBookmarkAnalysisMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    analyzedCount: merged.length,
    failedCount,
    model: provider.model,
  });
  if (inputs.length === 0 || failedCount > 0) {
    merged = await mergeBookmarkAnalysisRecords([], meta);
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

export { buildBookmarkAnalysisInput };
