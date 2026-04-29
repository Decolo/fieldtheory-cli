import { countBookmarkProjections } from './archive-projections.js';
import { listBookmarkAnalysisInputs, type BookmarkAnalysisInput } from './bookmark-analysis-input.js';
import { readBookmarkAnalysisRecords } from './bookmark-analysis-store.js';
import type { BookmarkAnalysisModelInfo, BookmarkAnalysisRecord } from './bookmark-analysis-types.js';
import { loadBookmarkAnalysisProviderConfig, type BookmarkAnalysisProviderConfig } from './config.js';
import { readBookmarkCurationProfile } from './bookmark-curation-profile.js';
import {
  createBookmarkCurationProvider,
  normalizeBookmarkCurationDraft,
  type BookmarkCurationInput,
  type BookmarkCurationProvider,
} from './bookmark-curation-provider.js';
import {
  buildBookmarkCurationMeta,
  mergeBookmarkCurationRecords,
  readBookmarkCurationRecords,
} from './bookmark-curation-store.js';
import type { BookmarkCurationMeta, BookmarkCurationRecord } from './bookmark-curation-types.js';

export interface RunBookmarkCurationOptions {
  limit?: number;
  batchSize?: number;
  refresh?: boolean;
  provider?: BookmarkCurationProvider;
  config?: BookmarkAnalysisProviderConfig;
  now?: () => Date;
  onProgress?: (progress: BookmarkCurationProgress) => void;
}

export interface BookmarkCurationProgress {
  completed: number;
  total: number;
  failed: number;
  batchNumber: number;
  batchTotal: number;
}

export interface BookmarkCurationRunResult {
  records: BookmarkCurationRecord[];
  meta: BookmarkCurationMeta;
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
  inputs: BookmarkAnalysisInput[],
  analyses: BookmarkAnalysisRecord[],
): BookmarkCurationInput[] {
  const analysisByTweetId = new Map(analyses.map((record) => [record.tweetId, record]));
  return inputs.flatMap((input) => {
    const analysis = analysisByTweetId.get(input.tweetId);
    return analysis ? [{ input, analysis }] : [];
  });
}

function buildRecord(
  item: BookmarkCurationInput,
  draft: ReturnType<typeof normalizeBookmarkCurationDraft>,
  model: BookmarkAnalysisModelInfo,
  curatedAt: string,
): BookmarkCurationRecord {
  return {
    id: item.input.id,
    tweetId: item.input.tweetId,
    url: item.input.url,
    sourceBookmarkId: item.input.id,
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
    sourceUpdatedAt: item.input.bookmarkedAt ?? item.input.postedAt ?? null,
  };
}

async function curateBookmarkCurationInputs(
  inputs: BookmarkCurationInput[],
  profile: string,
  options: RunBookmarkCurationOptions = {},
): Promise<BookmarkCurationRecord[]> {
  const config = options.config ?? loadBookmarkAnalysisProviderConfig();
  const provider = options.provider ?? createBookmarkCurationProvider(config);
  const now = options.now ?? (() => new Date());
  const drafts = await provider.curate(inputs, profile);
  return inputs.map((item, index) => buildRecord(
    item,
    normalizeBookmarkCurationDraft(drafts[index] ?? {}, item),
    provider.model,
    now().toISOString(),
  ));
}

export async function runBookmarkCuration(
  options: RunBookmarkCurationOptions = {},
): Promise<BookmarkCurationRunResult> {
  const config = options.config ?? loadBookmarkAnalysisProviderConfig();
  const provider = options.provider ?? createBookmarkCurationProvider(config);
  const profile = await readBookmarkCurationProfile();
  const [allInputs, analyses, existing] = await Promise.all([
    listBookmarkAnalysisInputs({ limit: options.limit }),
    readBookmarkAnalysisRecords(),
    readBookmarkCurationRecords(),
  ]);
  const curationInputs = buildCurationInputs(allInputs, analyses);
  if (curationInputs.length === 0 && allInputs.length > 0) {
    throw new Error('No bookmark classification records found. Run `ft bookmarks classify` before `ft bookmarks curate`.');
  }

  const existingTweetIds = new Set(existing.map((record) => record.tweetId));
  const inputs = options.refresh
    ? curationInputs
    : curationInputs.filter((item) => !existingTweetIds.has(item.input.tweetId));
  const sourceCount = await countBookmarkProjections().catch(() => curationInputs.length);
  const batchSize = Math.max(1, Number(options.batchSize ?? config.batchSize) || 1);
  const batches = chunk(inputs, batchSize);
  const now = options.now ?? (() => new Date());
  let merged = existing;
  let completed = 0;
  let failedCount = 0;
  let meta = buildBookmarkCurationMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    curatedCount: existing.length,
    failedCount: 0,
    model: provider.model,
    profilePath: profile.path,
  });

  for (const [index, batch] of batches.entries()) {
    const batchRecords: BookmarkCurationRecord[] = [];
    try {
      batchRecords.push(...await curateBookmarkCurationInputs(batch, profile.content, {
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
            batchRecords.push(...await curateBookmarkCurationInputs([item], profile.content, {
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
      meta = buildBookmarkCurationMeta({
        generatedAt: now().toISOString(),
        sourceCount,
        curatedCount: merged.length + batchRecords.length,
        failedCount,
        model: provider.model,
        profilePath: profile.path,
      });
      merged = await mergeBookmarkCurationRecords(batchRecords, meta);
    }

    options.onProgress?.({
      completed,
      total: inputs.length,
      failed: failedCount,
      batchNumber: index + 1,
      batchTotal: batches.length,
    });
  }

  meta = buildBookmarkCurationMeta({
    generatedAt: now().toISOString(),
    sourceCount,
    curatedCount: merged.length,
    failedCount,
    model: provider.model,
    profilePath: profile.path,
  });
  if (inputs.length === 0 || failedCount > 0) {
    merged = await mergeBookmarkCurationRecords([], meta);
  }

  return {
    records: merged,
    meta: { ...meta, curatedCount: merged.length },
    skippedCount: options.refresh ? 0 : curationInputs.length - inputs.length,
    profilePath: profile.path,
    usedDefaultProfile: profile.usedDefault,
  };
}
