import { removeBookmarksFromArchive } from './archive-actions.js';
import { readJsonLines } from './fs.js';
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
  rateLimitBackoffSeconds?: number;
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
  const maxRateLimitRetries = Math.max(0, Math.trunc(options.maxRateLimitRetries ?? 3));
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
      let attempts = 0;

      while (true) {
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
          break;
        } catch (error) {
          const isRateLimited = error instanceof RemoteTweetActionError && error.status === 429;
          if (isRateLimited && attempts < maxRateLimitRetries) {
            attempts += 1;
            options.onProgress?.({
              batchNumber: index + 1,
              batchTotal: batches.length,
              completed,
              totalToRemove: plan.removeCount,
              currentTweetId: tweetId,
              pausedSeconds: rateLimitBackoffSeconds,
            });
            await sleep(rateLimitBackoffSeconds * 1000);
            continue;
          }

          if (succeededIds.length > 0) {
            lastArchiveState = await removeBookmarksFromArchive(succeededIds);
          }

          if (isRateLimited) {
            throw new BookmarkTrimRateLimitError(
              `Rate limited after ${completed}/${plan.removeCount} removals.\n` +
              `Retry after ${rateLimitBackoffSeconds}s or rerun the command later.\n` +
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
