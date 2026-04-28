import { rm } from 'node:fs/promises';
import { removeFeedItemsFromArchive } from './archive-actions.js';
import { readJsonLines, pathExists, readJson, writeJson } from './fs.js';
import { twitterFeedCachePath, twitterFeedContextBundlePath, twitterFeedContextStatePath } from './paths.js';
import type { FeedConversationStoreState, FeedRecord } from './types.js';

export interface FeedTrimPlan {
  totalItems: number;
  keepCount: number;
  removeCount: number;
  keepBoundaryId?: string;
  firstRemoveId?: string;
  removalIds: string[];
}

export interface FeedTrimResult {
  totalBefore: number;
  totalAfter: number;
  kept: number;
  removed: number;
  contextRemoved: number;
  batchesCompleted: number;
  keepBoundaryId?: string;
  firstRemovedId?: string;
  cachePath?: string;
  dbPath?: string;
}

export interface TrimFeedOptions {
  keep: number;
  batchSize: number;
  pauseSeconds: number;
  sleep?: (ms: number) => Promise<void>;
  onProgress?: (progress: {
    batchNumber: number;
    batchTotal: number;
    completed: number;
    totalToRemove: number;
    pausedSeconds?: number;
  }) => void;
}

function recordTimestamp(record: FeedRecord): number {
  const raw = record.syncedAt ?? record.postedAt ?? '';
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function numericSortIndex(value: string | null | undefined): bigint | null {
  return value && /^\d+$/.test(value) ? BigInt(value) : null;
}

function compareFeedByRecency(a: FeedRecord, b: FeedRecord): number {
  const delta = recordTimestamp(b) - recordTimestamp(a);
  if (delta !== 0) return delta;

  const leftSort = numericSortIndex(a.sortIndex);
  const rightSort = numericSortIndex(b.sortIndex);
  if (leftSort !== null && rightSort !== null && leftSort !== rightSort) {
    return leftSort < rightSort ? 1 : -1;
  }

  const pageDelta = (a.fetchPage ?? Number.MAX_SAFE_INTEGER) - (b.fetchPage ?? Number.MAX_SAFE_INTEGER);
  if (pageDelta !== 0) return pageDelta;
  const positionDelta = (a.fetchPosition ?? Number.MAX_SAFE_INTEGER) - (b.fetchPosition ?? Number.MAX_SAFE_INTEGER);
  if (positionDelta !== 0) return positionDelta;
  return String(b.id).localeCompare(String(a.id));
}

export async function planFeedTrim(keep: number): Promise<FeedTrimPlan> {
  const existing = await readJsonLines<FeedRecord>(twitterFeedCachePath());
  const sorted = [...existing].sort(compareFeedByRecency);
  const keepCount = Math.max(0, Math.min(keep, sorted.length));
  const keepBoundary = keepCount > 0 ? sorted[keepCount - 1] : undefined;
  const removable = sorted.slice(keepCount);

  return {
    totalItems: sorted.length,
    keepCount,
    removeCount: removable.length,
    keepBoundaryId: keepBoundary?.id,
    firstRemoveId: removable[0]?.id,
    removalIds: removable.map((record) => record.tweetId),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const width = Math.max(1, size);
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += width) {
    batches.push(items.slice(i, i + width));
  }
  return batches;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function removeFeedContextBundles(tweetIds: string[]): Promise<number> {
  let removed = 0;
  for (const tweetId of tweetIds) {
    const filePath = twitterFeedContextBundlePath(tweetId);
    if (await pathExists(filePath)) {
      await rm(filePath, { force: true });
      removed += 1;
    }
  }

  const statePath = twitterFeedContextStatePath();
  if (await pathExists(statePath)) {
    const state = await readJson<FeedConversationStoreState>(statePath);
    const targets = new Set(tweetIds);
    const records = Object.fromEntries(
      Object.entries(state.records ?? {}).filter(([key, value]) => (
        !targets.has(String(key)) && !targets.has(String(value.rootFeedTweetId)) && !targets.has(String(value.rootFeedItemId))
      )),
    );
    if (Object.keys(records).length !== Object.keys(state.records ?? {}).length) {
      await writeJson(statePath, { ...state, records } satisfies FeedConversationStoreState);
    }
  }

  return removed;
}

export async function trimFeed(options: TrimFeedOptions): Promise<FeedTrimResult> {
  const keep = Math.max(0, Math.trunc(options.keep));
  const batchSize = Math.max(1, Math.trunc(options.batchSize));
  const pauseSeconds = Math.max(0, options.pauseSeconds);
  const plan = await planFeedTrim(keep);

  if (plan.removeCount === 0) {
    return {
      totalBefore: plan.totalItems,
      totalAfter: plan.totalItems,
      kept: plan.keepCount,
      removed: 0,
      contextRemoved: 0,
      batchesCompleted: 0,
      keepBoundaryId: plan.keepBoundaryId,
    };
  }

  const batches = chunk(plan.removalIds, batchSize);
  const sleep = options.sleep ?? defaultSleep;
  let completed = 0;
  let contextRemoved = 0;
  let lastArchiveState: Awaited<ReturnType<typeof removeFeedItemsFromArchive>> | undefined;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    lastArchiveState = await removeFeedItemsFromArchive(batch);
    contextRemoved += await removeFeedContextBundles(batch);
    completed += batch.length;

    options.onProgress?.({
      batchNumber: index + 1,
      batchTotal: batches.length,
      completed,
      totalToRemove: plan.removeCount,
    });

    if (pauseSeconds > 0 && index < batches.length - 1) {
      options.onProgress?.({
        batchNumber: index + 1,
        batchTotal: batches.length,
        completed,
        totalToRemove: plan.removeCount,
        pausedSeconds: pauseSeconds,
      });
      await sleep(pauseSeconds * 1000);
    }
  }

  return {
    totalBefore: plan.totalItems,
    totalAfter: lastArchiveState?.totalRemaining ?? plan.keepCount,
    kept: keep,
    removed: completed,
    contextRemoved,
    batchesCompleted: batches.length,
    keepBoundaryId: plan.keepBoundaryId,
    firstRemovedId: plan.firstRemoveId,
    cachePath: lastArchiveState?.cachePath,
    dbPath: lastArchiveState?.dbPath,
  };
}
