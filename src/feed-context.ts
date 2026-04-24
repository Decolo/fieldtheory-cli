import { readJsonLines } from './fs.js';
import { writeFeedConversationBundle } from './feed-context-store.js';
import { fetchConversationContext, resolveConversationTarget } from './graphql-conversation.js';
import { twitterFeedCachePath } from './paths.js';
import type { FeedConversationBundle, FeedRecord } from './types.js';
import type { XSessionOptions } from './x-graphql.js';

export interface FeedContextSyncOptions extends XSessionOptions {
  limit?: number;
  tweetId?: string;
  maxReplies?: number;
}

export interface FeedContextSyncResult {
  requested: number;
  processed: number;
  stored: number;
  skipped: number;
  unavailable: number;
  totalReplies: number;
  bundles: FeedConversationBundle[];
}

function trimReplies(bundle: FeedConversationBundle, maxReplies: number): FeedConversationBundle {
  if (!Number.isFinite(maxReplies) || maxReplies <= 0 || bundle.replies.length <= maxReplies) return bundle;
  return {
    ...bundle,
    outcome: 'partial',
    summary: `Conversation fetched successfully with ${bundle.replies.length} replies; stored the first ${maxReplies}.`,
    replies: bundle.replies.slice(0, maxReplies),
  };
}

function matchTweet(record: FeedRecord, tweetId: string): boolean {
  return String(record.id) === tweetId || String(record.tweetId) === tweetId;
}

export async function readFeedContextCandidates(options: { tweetId?: string; limit?: number } = {}): Promise<FeedRecord[]> {
  const records = await readJsonLines<FeedRecord>(twitterFeedCachePath());
  if (options.tweetId) {
    return records.filter((record) => matchTweet(record, String(options.tweetId)));
  }
  const limit = Math.max(1, Number(options.limit) || 10);
  return records.slice(0, limit);
}

export async function syncFeedConversationContext(options: FeedContextSyncOptions = {}): Promise<FeedContextSyncResult> {
  const candidates = await readFeedContextCandidates({
    tweetId: options.tweetId,
    limit: options.limit ?? 10,
  });

  if (candidates.length === 0) {
    throw new Error(
      options.tweetId
        ? `Feed item not found locally: ${String(options.tweetId)}`
        : 'No local feed data found. Run: ft feed sync',
    );
  }

  const bundles: FeedConversationBundle[] = [];
  let stored = 0;
  let skipped = 0;
  let unavailable = 0;
  let totalReplies = 0;

  for (const candidate of candidates) {
    if (!resolveConversationTarget(candidate)) {
      skipped += 1;
      continue;
    }

    const bundle = trimReplies(
      await fetchConversationContext(candidate, options),
      Math.max(1, Number(options.maxReplies) || 40),
    );
    await writeFeedConversationBundle(bundle);
    bundles.push(bundle);
    stored += 1;
    totalReplies += bundle.replies.length;
    if (bundle.outcome === 'unavailable') unavailable += 1;
  }

  return {
    requested: candidates.length,
    processed: bundles.length + skipped,
    stored,
    skipped,
    unavailable,
    totalReplies,
    bundles,
  };
}
