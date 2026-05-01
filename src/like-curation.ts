import { countLikeProjections } from './archive-projections.js';
import { listLikeAnalysisInputs, type LikeAnalysisInput } from './like-analysis-input.js';
import { readLikeAnalysisRecords } from './like-analysis-store.js';
import type { LikeAnalysisModelInfo, LikeAnalysisRecord } from './like-analysis-types.js';
import { loadLikeAnalysisProviderConfig, type LikeAnalysisProviderConfig } from './config.js';
import { readLikeCurationProfile } from './like-curation-profile.js';
import {
  createLikeCurationProvider,
  normalizeLikeCurationDraft,
  type LikeCurationInput,
  type LikeCurationProvider,
} from './like-curation-provider.js';
import {
  buildLikeCurationMeta,
  mergeLikeCurationRecords,
  readLikeCurationRecords,
} from './like-curation-store.js';
import type { LikeCurationMeta, LikeCurationRecord } from './like-curation-types.js';

export interface RunLikeCurationOptions {
  limit?: number;
  batchSize?: number;
  refresh?: boolean;
  provider?: LikeCurationProvider;
  config?: LikeAnalysisProviderConfig;
  now?: () => Date;
  onProgress?: (progress: LikeCurationProgress) => void;
}

export interface LikeCurationProgress {
  completed: number;
  total: number;
  failed: number;
  batchNumber: number;
  batchTotal: number;
}

export interface LikeCurationRunResult {
  records: LikeCurationRecord[];
  meta: LikeCurationMeta;
  skippedCount: number;
  profilePath: string;
  usedDefaultProfile: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function buildCurationInputs(
  inputs: LikeAnalysisInput[],
  analyses: LikeAnalysisRecord[],
): LikeCurationInput[] {
  const analysisByTweetId = new Map(analyses.map((record) => [record.tweetId, record]));
  return inputs.flatMap((input) => {
    const analysis = analysisByTweetId.get(input.tweetId);
    return analysis ? [{ input, analysis }] : [];
  });
}

function buildRecord(
  item: LikeCurationInput,
  draft: ReturnType<typeof normalizeLikeCurationDraft>,
  model: LikeAnalysisModelInfo,
  curatedAt: string,
): LikeCurationRecord {
  return {
    id: item.input.id,
    tweetId: item.input.tweetId,
    url: item.input.url,
    sourceLikeId: item.input.id,
    authorHandle: item.input.authorHandle,
    decision: draft.decision,
    value: draft.value,
    freshness: draft.freshness,
    confidence: draft.confidence,
    rationale: draft.rationale,
    signals: draft.signals,
    evidence: draft.evidence,
    model,
    curatedAt,
    sourceUpdatedAt: item.input.likedAt ?? item.input.postedAt ?? null,
  };
}

async function curateLikeCurationInputs(
  inputs: LikeCurationInput[],
  profile: string,
  options: RunLikeCurationOptions = {},
): Promise<LikeCurationRecord[]> {
  const config = options.config ?? loadLikeAnalysisProviderConfig();
  const provider = options.provider ?? createLikeCurationProvider(config);
  const now = options.now ?? (() => new Date());
  const drafts = await provider.curate(inputs, profile);
  return inputs.map((item, index) => buildRecord(
    item,
    normalizeLikeCurationDraft(drafts[index] ?? {}, item),
    provider.model,
    now().toISOString(),
  ));
}

export async function runLikeCuration(
  options: RunLikeCurationOptions = {},
): Promise<LikeCurationRunResult> {
  const config = options.config ?? loadLikeAnalysisProviderConfig();
  const provider = options.provider ?? createLikeCurationProvider(config);
  const profile = await readLikeCurationProfile();
  const [allInputs, analyses, existing] = await Promise.all([
    listLikeAnalysisInputs({ limit: options.limit }),
    readLikeAnalysisRecords(),
    readLikeCurationRecords(),
  ]);
  const curationInputs = buildCurationInputs(allInputs, analyses);
  if (curationInputs.length === 0 && allInputs.length > 0) {
    throw new Error('No like classification records found. Run `ft likes classify` before `ft likes curate`.');
  }

  const existingTweetIds = new Set(existing.map((record) => record.tweetId));
  const inputs = options.refresh
    ? curationInputs
    : curationInputs.filter((item) => !existingTweetIds.has(item.input.tweetId));
  const sourceCount = await countLikeProjections().catch(() => curationInputs.length);
  const batchSize = Math.max(1, Number(options.batchSize ?? config.batchSize) || 1);
  const batches = chunk(inputs, batchSize);
  const now = options.now ?? (() => new Date());
  let merged = existing;
  let completed = 0;
  let failedCount = 0;
  let meta = buildLikeCurationMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    curatedCount: existing.length,
    failedCount: 0,
    model: provider.model,
    profilePath: profile.path,
  });

  for (const [index, batch] of batches.entries()) {
    const batchRecords: LikeCurationRecord[] = [];
    try {
      batchRecords.push(...await curateLikeCurationInputs(batch, profile.content, {
        config,
        provider,
        now,
      }));
    } catch {
      if (batch.length <= 1) {
        failedCount += batch.length;
      } else {
        for (const item of batch) {
          try {
            batchRecords.push(...await curateLikeCurationInputs([item], profile.content, {
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
      meta = buildLikeCurationMeta({
        generatedAt: now().toISOString(),
        sourceCount,
        curatedCount: merged.length + batchRecords.length,
        failedCount,
        model: provider.model,
        profilePath: profile.path,
      });
      merged = await mergeLikeCurationRecords(batchRecords, meta);
    }

    options.onProgress?.({
      completed,
      total: inputs.length,
      failed: failedCount,
      batchNumber: index + 1,
      batchTotal: batches.length,
    });
  }

  meta = buildLikeCurationMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    curatedCount: merged.length,
    failedCount,
    model: provider.model,
    profilePath: profile.path,
  });
  if (inputs.length === 0 || failedCount > 0) {
    merged = await mergeLikeCurationRecords([], meta);
  }

  return {
    records: merged,
    meta: { ...meta, curatedCount: merged.length },
    skippedCount: options.refresh ? 0 : curationInputs.length - inputs.length,
    profilePath: profile.path,
    usedDefaultProfile: profile.usedDefault,
  };
}
