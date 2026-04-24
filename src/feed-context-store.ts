import path from 'node:path';
import { ensureDir, pathExists, readJson, writeJson } from './fs.js';
import {
  twitterFeedContextBundlePath,
  twitterFeedContextRootDir,
  twitterFeedContextStatePath,
} from './paths.js';
import type {
  FeedConversationBundle,
  FeedConversationFetchState,
  FeedConversationStoreState,
} from './types.js';

const SCHEMA_VERSION = 1;

function emptyStoreState(): FeedConversationStoreState {
  return {
    provider: 'twitter',
    schemaVersion: SCHEMA_VERSION,
    records: {},
  };
}

function compareReplyChronology(left: { postedAt?: string | null; id: string }, right: { postedAt?: string | null; id: string }): number {
  const leftPosted = left.postedAt ? Date.parse(left.postedAt) : NaN;
  const rightPosted = right.postedAt ? Date.parse(right.postedAt) : NaN;
  if (Number.isFinite(leftPosted) && Number.isFinite(rightPosted) && leftPosted !== rightPosted) {
    return leftPosted - rightPosted;
  }
  if (/^\d+$/.test(left.id) && /^\d+$/.test(right.id) && left.id !== right.id) {
    return BigInt(left.id) < BigInt(right.id) ? -1 : 1;
  }
  return left.id.localeCompare(right.id);
}

function normalizeBundle(bundle: FeedConversationBundle): FeedConversationBundle {
  const replies = Array.from(
    new Map(
      bundle.replies.map((reply) => [
        String(reply.tweetId || reply.id),
        {
          ...reply,
          id: String(reply.id || reply.tweetId),
          tweetId: String(reply.tweetId || reply.id),
        },
      ]),
    ).values(),
  ).sort(compareReplyChronology);

  return {
    ...bundle,
    schemaVersion: SCHEMA_VERSION,
    rootFeedTweetId: String(bundle.rootFeedTweetId),
    rootFeedItemId: String(bundle.rootFeedItemId),
    conversationTweetId: String(bundle.conversationTweetId),
    conversationId: String(bundle.conversationId),
    replies,
  };
}

function stateFromBundle(bundle: FeedConversationBundle): FeedConversationFetchState {
  return {
    rootFeedTweetId: bundle.rootFeedTweetId,
    rootFeedItemId: bundle.rootFeedItemId,
    conversationTweetId: bundle.conversationTweetId,
    conversationId: bundle.conversationId,
    targetKind: bundle.targetKind,
    lastFetchedAt: bundle.fetchedAt,
    outcome: bundle.outcome,
    replyCount: bundle.replies.length,
    unavailableReason: bundle.unavailableReason,
    summary: bundle.summary,
  };
}

export async function readFeedConversationState(): Promise<FeedConversationStoreState> {
  const filePath = twitterFeedContextStatePath();
  if (!(await pathExists(filePath))) return emptyStoreState();
  const state = await readJson<FeedConversationStoreState>(filePath);
  return {
    ...emptyStoreState(),
    ...state,
    schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
    records: Object.fromEntries(
      Object.entries(state.records ?? {}).map(([key, value]) => [
        String(key),
        {
          ...value,
          rootFeedTweetId: String(value.rootFeedTweetId ?? key),
          rootFeedItemId: String(value.rootFeedItemId ?? value.rootFeedTweetId ?? key),
          conversationTweetId: value.conversationTweetId ? String(value.conversationTweetId) : undefined,
          conversationId: value.conversationId ? String(value.conversationId) : undefined,
          replyCount: Number(value.replyCount ?? 0),
        },
      ]),
    ),
  };
}

export async function writeFeedConversationState(state: FeedConversationStoreState): Promise<void> {
  await ensureDir(twitterFeedContextRootDir());
  await writeJson(twitterFeedContextStatePath(), {
    ...emptyStoreState(),
    ...state,
    provider: 'twitter',
    schemaVersion: SCHEMA_VERSION,
    records: Object.fromEntries(
      Object.entries(state.records ?? {}).map(([key, value]) => [
        String(key),
        {
          ...value,
          rootFeedTweetId: String(value.rootFeedTweetId ?? key),
          rootFeedItemId: String(value.rootFeedItemId ?? value.rootFeedTweetId ?? key),
          replyCount: Number(value.replyCount ?? 0),
        },
      ]),
    ),
  } satisfies FeedConversationStoreState);
}

export async function readFeedConversationBundle(rootFeedTweetId: string): Promise<FeedConversationBundle | null> {
  const filePath = twitterFeedContextBundlePath(rootFeedTweetId);
  if (!(await pathExists(filePath))) return null;
  const bundle = await readJson<FeedConversationBundle>(filePath);
  return normalizeBundle(bundle);
}

export async function writeFeedConversationBundle(bundle: FeedConversationBundle): Promise<FeedConversationBundle> {
  const normalized = normalizeBundle(bundle);
  const filePath = twitterFeedContextBundlePath(normalized.rootFeedTweetId);
  await ensureDir(path.dirname(filePath));
  await writeJson(filePath, normalized);

  const state = await readFeedConversationState();
  state.updatedAt = normalized.fetchedAt;
  state.records[normalized.rootFeedTweetId] = stateFromBundle(normalized);
  await writeFeedConversationState(state);
  return normalized;
}
