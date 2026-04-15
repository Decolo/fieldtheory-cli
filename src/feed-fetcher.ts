import { readJsonLines } from './fs.js';
import { syncFeedGraphQL, type FeedSyncProgress } from './graphql-feed.js';
import { twitterFeedCachePath } from './paths.js';
import type { FeedRecord } from './types.js';
import type { XSessionOptions } from './x-graphql.js';

export interface FeedFetchOptions extends XSessionOptions {
  maxPages?: number;
  delayMs?: number;
  maxMinutes?: number;
  onProgress?: (progress: FeedSyncProgress) => void;
}

export interface FeedFetchResult {
  added: number;
  totalItems: number;
  stopReason?: string;
  newItems: FeedRecord[];
}

export async function fetchFeedItems(options: FeedFetchOptions = {}): Promise<FeedFetchResult> {
  const before = await readJsonLines<FeedRecord>(twitterFeedCachePath());
  const beforeIds = new Set(before.map((record) => record.tweetId ?? record.id));

  const syncResult = await syncFeedGraphQL({
    ...options,
    maxPages: options.maxPages ?? 1,
    delayMs: options.delayMs ?? 600,
    maxMinutes: options.maxMinutes ?? 5,
    onProgress: options.onProgress,
  });

  const after = await readJsonLines<FeedRecord>(twitterFeedCachePath());
  const newItems = after.filter((record) => !beforeIds.has(record.tweetId ?? record.id));

  return {
    added: syncResult.added,
    totalItems: syncResult.totalItems,
    stopReason: syncResult.stopReason,
    newItems,
  };
}
