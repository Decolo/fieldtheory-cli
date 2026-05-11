import { removeBookmarksFromArchive } from './archive-actions.js';
import { readJsonLines } from './fs.js';
import { fetchRemoteBookmarkIds, type RemoteBookmarkIdsOptions } from './graphql-bookmarks.js';
import { RemoteTweetActionError, unbookmarkTweet } from './graphql-actions.js';
import { twitterBookmarksCachePath } from './paths.js';
import type { BookmarkRecord } from './types.js';
import type { XSessionOptions } from './x-graphql.js';

export interface BookmarkTrimPlan {
  totalBookmarks: number;
  keepCount: number;
  removeCount: number;
  keepBoundaryId?: string;
  firstRemoveId?: string;
  removalIds: string[];
}

export interface BookmarkTrimProgress {
  batchNumber: number;
  batchTotal: number;
  completed: number;
  totalToRemove: number;
  currentTweetId?: string;
  pausedSeconds?: number;
}

export interface TrimBookmarksOptions extends XSessionOptions {
  keep: number;
  batchSize: number;
  pauseSeconds: number;
  /** @deprecated 429 responses are terminal for account-safety reasons. */
  rateLimitBackoffSeconds?: number;
  /** @deprecated 429 responses are terminal for account-safety reasons. */
  maxRateLimitRetries?: number;
  onProgress?: (progress: BookmarkTrimProgress) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface TrimBookmarksResult {
  totalBefore: number;
  totalAfter: number;
  kept: number;
  removed: number;
  batchesCompleted: number;
  keepBoundaryId?: string;
  firstRemovedId?: string;
  cachePath?: string;
  dbPath?: string;
}

export interface BookmarksRemotePruneProgress {
  phase: 'fetch-remote' | 'rewrite-local';
  page?: number;
  remoteCount?: number;
}

export interface PruneLocalBookmarksMissingRemotelyOptions extends RemoteBookmarkIdsOptions {
  onProgress?: (progress: BookmarksRemotePruneProgress) => void;
}

export interface PruneLocalBookmarksMissingRemotelyResult {
  localBefore: number;
  remoteCount: number;
  removed: number;
  localAfter: number;
  removedIds: string[];
  missingIds: string[];
  cachePath?: string;
  dbPath?: string;
  stopReason: string;
}

export class BookmarkTrimRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(message: string, retryAfterSeconds: number) {
    super(message);
    this.name = 'BookmarkTrimRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function bookmarkTimestamp(record: BookmarkRecord): number {
  const raw = record.bookmarkedAt ?? record.postedAt ?? '';
  const value = Date.parse(raw);
  return Number.isFinite(value) ? value : 0;
}

function compareBookmarksByRecency(a: BookmarkRecord, b: BookmarkRecord): number {
  const delta = bookmarkTimestamp(b) - bookmarkTimestamp(a);
  if (delta !== 0) return delta;
  return String(b.id).localeCompare(String(a.id));
}

export async function planBookmarksTrim(keep: number): Promise<BookmarkTrimPlan> {
  const existing = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());
  const sorted = [...existing].sort(compareBookmarksByRecency);
  const keepCount = Math.max(0, Math.min(keep, sorted.length));
  const keepBoundary = keepCount > 0 ? sorted[keepCount - 1] : undefined;
  const removable = sorted.slice(keepCount);

  return {
    totalBookmarks: sorted.length,
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

export async function trimBookmarks(options: TrimBookmarksOptions): Promise<TrimBookmarksResult> {
  const keep = Math.max(0, Math.trunc(options.keep));
  const batchSize = Math.max(1, Math.trunc(options.batchSize));
  const pauseSeconds = Math.max(0, options.pauseSeconds);
  const rateLimitBackoffSeconds = Math.max(
    1,
    Math.trunc(options.rateLimitBackoffSeconds ?? Math.max(pauseSeconds, 300)),
  );
  const plan = await planBookmarksTrim(keep);

  if (plan.removeCount === 0) {
    return {
      totalBefore: plan.totalBookmarks,
      totalAfter: plan.totalBookmarks,
      kept: plan.keepCount,
      removed: 0,
      batchesCompleted: 0,
      keepBoundaryId: plan.keepBoundaryId,
    };
  }

  const batches = chunk(plan.removalIds, batchSize);
  const sleep = options.sleep ?? defaultSleep;
  let completed = 0;
  let lastArchiveState: Awaited<ReturnType<typeof removeBookmarksFromArchive>> | undefined;

  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]!;
    const succeededIds: string[] = [];

    for (const tweetId of batch) {
      options.onProgress?.({
        batchNumber: index + 1,
        batchTotal: batches.length,
        completed,
        totalToRemove: plan.removeCount,
        currentTweetId: tweetId,
      });

      try {
        await unbookmarkTweet(tweetId, options);
        succeededIds.push(tweetId);
        completed += 1;
      } catch (error) {
        const isRateLimited = error instanceof RemoteTweetActionError && error.status === 429;

        if (succeededIds.length > 0) {
          lastArchiveState = await removeBookmarksFromArchive(succeededIds);
        }

        if (isRateLimited) {
          throw new BookmarkTrimRateLimitError(
            `Rate limited after ${completed}/${plan.removeCount} removals. Stopping immediately; no retry was attempted.\n` +
            `${(error as Error).message}`,
            rateLimitBackoffSeconds,
          );
        }

        const prefix = succeededIds.length > 0
          ? `Processed ${completed}/${plan.removeCount} bookmarks before stopping.\n`
          : '';
        throw new Error(`${prefix}${(error as Error).message}`);
      }
    }

    if (succeededIds.length > 0) {
      lastArchiveState = await removeBookmarksFromArchive(succeededIds);
    }

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
    totalBefore: plan.totalBookmarks,
    totalAfter: lastArchiveState?.totalRemaining ?? plan.keepCount,
    kept: keep,
    removed: completed,
    batchesCompleted: batches.length,
    keepBoundaryId: plan.keepBoundaryId,
    firstRemovedId: plan.firstRemoveId,
    cachePath: lastArchiveState?.cachePath,
    dbPath: lastArchiveState?.dbPath,
  };
}

export async function pruneLocalBookmarksMissingRemotely(
  options: PruneLocalBookmarksMissingRemotelyOptions = {},
): Promise<PruneLocalBookmarksMissingRemotelyResult> {
  const local = await readJsonLines<BookmarkRecord>(twitterBookmarksCachePath());

  options.onProgress?.({ phase: 'fetch-remote', page: 0, remoteCount: 0 });
  const remote = await fetchRemoteBookmarkIds({
    ...options,
    onProgress: (progress) => {
      options.onProgress?.({
        phase: 'fetch-remote',
        page: progress.page,
        remoteCount: progress.totalFetched,
      });
    },
  });

  const remoteIds = new Set(remote.ids);
  const removalIds = local
    .filter((record) => !remoteIds.has(record.tweetId))
    .map((record) => record.tweetId);

  if (removalIds.length === 0) {
    return {
      localBefore: local.length,
      remoteCount: remote.ids.length,
      removed: 0,
      localAfter: local.length,
      removedIds: [],
      missingIds: [],
      stopReason: remote.stopReason,
    };
  }

  options.onProgress?.({ phase: 'rewrite-local', remoteCount: remote.ids.length });
  const rewritten = await removeBookmarksFromArchive(removalIds);

  return {
    localBefore: local.length,
    remoteCount: remote.ids.length,
    removed: rewritten.removedIds.length,
    localAfter: rewritten.totalRemaining,
    removedIds: rewritten.removedIds,
    missingIds: rewritten.missingIds,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
    stopReason: remote.stopReason,
  };
}
