import { appendLine, pathExists, readJson, readJsonLines, writeJson } from './fs.js';
import { upsertBookmarksInArchive, upsertLikesInArchive } from './archive-actions.js';
import { bookmarkTweet, likeTweet } from './graphql-actions.js';
import { loadFeedPreferences } from './feed-preferences.js';
import { scoreSemanticItem } from './feed-semantic-scorer.js';
import { SemanticStore } from './semantic-store.js';
import {
  twitterBookmarksCachePath,
  twitterFeedAgentLogPath,
  twitterFeedAgentStatePath,
  twitterLikesCachePath,
} from './paths.js';
import type {
  BookmarkRecord,
  FeedAgentItemState,
  FeedAgentLogEntry,
  FeedAgentState,
  FeedRecord,
  LikeRecord,
} from './types.js';
import type { XSessionOptions } from './x-graphql.js';

const FEED_AGENT_SCHEMA_VERSION = 1;
const DEFAULT_LIKE_THRESHOLD = 0.62;
const DEFAULT_BOOKMARK_THRESHOLD = 0.68;

export interface FeedConsumeOptions extends XSessionOptions {
  candidateLimit?: number;
  dryRun?: boolean;
  likeThreshold?: number;
  bookmarkThreshold?: number;
}

export interface FeedConsumeResult {
  runId: string;
  startedAt: string;
  finishedAt: string;
  dryRun: boolean;
  evaluated: number;
  liked: number;
  bookmarked: number;
  skipped: number;
  failed: number;
  statePath: string;
  logPath: string;
}

function loadDefaultState(): FeedAgentState {
  return {
    provider: 'twitter',
    schemaVersion: FEED_AGENT_SCHEMA_VERSION,
    totalRuns: 0,
    totalEvaluated: 0,
    totalLiked: 0,
    totalBookmarked: 0,
    items: {},
  };
}

async function loadState(): Promise<FeedAgentState> {
  const statePath = twitterFeedAgentStatePath();
  if (!(await pathExists(statePath))) return loadDefaultState();
  return readJson<FeedAgentState>(statePath);
}

function sortCandidates(items: FeedRecord[], state: FeedAgentState): FeedRecord[] {
  const itemState = state.items;
  return [...items].sort((left, right) => {
    const leftState = itemState[left.tweetId] ?? itemState[left.id];
    const rightState = itemState[right.tweetId] ?? itemState[right.id];
    const leftEval = Date.parse(leftState?.lastEvaluatedAt ?? '') || 0;
    const rightEval = Date.parse(rightState?.lastEvaluatedAt ?? '') || 0;
    if (leftEval !== rightEval) return leftEval - rightEval;
    return String(right.postedAt ?? right.syncedAt ?? '').localeCompare(String(left.postedAt ?? left.syncedAt ?? ''));
  });
}

function toLikeRecord(item: FeedRecord, actedAt: string): LikeRecord {
  return {
    id: item.tweetId,
    tweetId: item.tweetId,
    url: item.url,
    text: item.text,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    authorProfileImageUrl: item.authorProfileImageUrl,
    author: item.author,
    postedAt: item.postedAt,
    likedAt: actedAt,
    syncedAt: actedAt,
    conversationId: item.conversationId,
    inReplyToStatusId: item.inReplyToStatusId,
    inReplyToUserId: item.inReplyToUserId,
    quotedStatusId: item.quotedStatusId,
    quotedTweet: item.quotedTweet,
    language: item.language,
    sourceApp: item.sourceApp,
    possiblySensitive: item.possiblySensitive,
    engagement: item.engagement,
    media: item.media,
    mediaObjects: item.mediaObjects,
    links: item.links,
    tags: item.tags,
    ingestedVia: 'graphql',
  };
}

function toBookmarkRecord(item: FeedRecord, actedAt: string): BookmarkRecord {
  return {
    id: item.tweetId,
    tweetId: item.tweetId,
    url: item.url,
    text: item.text,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    authorProfileImageUrl: item.authorProfileImageUrl,
    author: item.author,
    postedAt: item.postedAt,
    bookmarkedAt: actedAt,
    sortIndex: item.sortIndex,
    syncedAt: actedAt,
    conversationId: item.conversationId,
    inReplyToStatusId: item.inReplyToStatusId,
    inReplyToUserId: item.inReplyToUserId,
    quotedStatusId: item.quotedStatusId,
    quotedTweet: item.quotedTweet,
    language: item.language,
    sourceApp: item.sourceApp,
    possiblySensitive: item.possiblySensitive,
    engagement: item.engagement,
    media: item.media,
    mediaObjects: item.mediaObjects,
    links: item.links,
    tags: item.tags,
    ingestedVia: 'graphql',
  };
}

async function appendLog(entry: FeedAgentLogEntry): Promise<void> {
  await appendLine(twitterFeedAgentLogPath(), JSON.stringify(entry));
}

export async function consumeFeedItems(items: FeedRecord[], options: FeedConsumeOptions = {}): Promise<FeedConsumeResult> {
  const startedAt = new Date().toISOString();
  const runId = `run-${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const dryRun = Boolean(options.dryRun);
  const likeThreshold = options.likeThreshold ?? DEFAULT_LIKE_THRESHOLD;
  const bookmarkThreshold = options.bookmarkThreshold ?? DEFAULT_BOOKMARK_THRESHOLD;
  const [bookmarks, likes, state] = await Promise.all([
    readJsonLines<BookmarkRecord>(twitterBookmarksCachePath()),
    readJsonLines<LikeRecord>(twitterLikesCachePath()),
    loadState(),
  ]);
  const explicitPreferences = loadFeedPreferences();
  const bookmarkSet = new Set(bookmarks.map((record) => record.tweetId ?? record.id));
  const likeSet = new Set(likes.map((record) => record.tweetId ?? record.id));
  const candidateLimit = options.candidateLimit ?? items.length ?? 1;
  const candidates = sortCandidates(items, state).slice(0, Math.max(0, candidateLimit));
  const semanticStore = await SemanticStore.open();

  let evaluated = 0;
  let liked = 0;
  let bookmarked = 0;
  let skipped = 0;
  let failed = 0;
  const pendingLikes: LikeRecord[] = [];
  const pendingBookmarks: BookmarkRecord[] = [];

  try {
    for (const item of candidates) {
      evaluated += 1;
      const key = item.tweetId;
      const itemState: FeedAgentItemState = state.items[key] ?? { tweetId: key };
      let decision;
      try {
        decision = await scoreSemanticItem(semanticStore, explicitPreferences, item);
      } catch (error) {
        const timestamp = new Date().toISOString();
        failed += 1;
        skipped += 1;
        itemState.lastEvaluatedAt = timestamp;
        itemState.lastRunId = runId;
        itemState.lastLikeScore = 0;
        itemState.lastBookmarkScore = 0;
        state.items[key] = itemState;
        await appendLog({
          runId,
          timestamp,
          tweetId: key,
          authorHandle: item.authorHandle,
          url: item.url,
          decision: 'error',
          likeScore: 0,
          bookmarkScore: 0,
          actions: {
            like: 'skipped',
            bookmark: 'skipped',
          },
          reasons: [],
          error: (error as Error).message,
        });
        continue;
      }
      const alreadyLiked = Boolean(itemState.likedAt || likeSet.has(key));
      const alreadyBookmarked = Boolean(itemState.bookmarkedAt || bookmarkSet.has(key));
      const wantLike = !decision.like.blocked && !alreadyLiked && decision.like.score >= likeThreshold;
      const wantBookmark = !decision.bookmark.blocked && !alreadyBookmarked && decision.bookmark.score >= bookmarkThreshold;
      const timestamp = new Date().toISOString();

      let likeAction: FeedAgentLogEntry['actions']['like'] = alreadyLiked ? 'already-done' : 'skipped';
      let bookmarkAction: FeedAgentLogEntry['actions']['bookmark'] = alreadyBookmarked ? 'already-done' : 'skipped';
      let errorMessage: string | undefined;

      if (wantLike) {
        if (dryRun) {
          likeAction = 'planned';
        } else {
          try {
            await likeTweet(key, options);
            pendingLikes.push(toLikeRecord(item, timestamp));
            itemState.likedAt = timestamp;
            likeSet.add(key);
            likeAction = 'applied';
            liked += 1;
          } catch (error) {
            likeAction = 'failed';
            errorMessage = (error as Error).message;
            failed += 1;
          }
        }
      }

      if (wantBookmark) {
        if (dryRun) {
          bookmarkAction = 'planned';
        } else {
          try {
            await bookmarkTweet(key, options);
            pendingBookmarks.push(toBookmarkRecord(item, timestamp));
            itemState.bookmarkedAt = timestamp;
            bookmarkSet.add(key);
            bookmarkAction = 'applied';
            bookmarked += 1;
          } catch (error) {
            bookmarkAction = 'failed';
            errorMessage = errorMessage ?? (error as Error).message;
            failed += 1;
          }
        }
      }

      if (!wantLike && !wantBookmark) skipped += 1;

      itemState.lastEvaluatedAt = timestamp;
      itemState.lastRunId = runId;
      itemState.lastLikeScore = decision.like.score;
      itemState.lastBookmarkScore = decision.bookmark.score;
      state.items[key] = itemState;

      await appendLog({
        runId,
        timestamp,
        tweetId: key,
        authorHandle: item.authorHandle,
        url: item.url,
        decision: errorMessage
          ? 'error'
          : dryRun && (wantLike || wantBookmark)
            ? 'dry-run'
            : wantLike && wantBookmark
              ? 'like+bookmark'
              : wantLike
                ? 'like'
                : wantBookmark
                  ? 'bookmark'
                  : 'skip',
        likeScore: decision.like.score,
        bookmarkScore: decision.bookmark.score,
        actions: {
          like: likeAction,
          bookmark: bookmarkAction,
        },
        reasons: [...decision.like.reasons, ...decision.bookmark.reasons],
        error: errorMessage,
      });
    }
  } finally {
    await semanticStore.close();
  }

  if (pendingLikes.length > 0) await upsertLikesInArchive(pendingLikes);
  if (pendingBookmarks.length > 0) await upsertBookmarksInArchive(pendingBookmarks);

  const finishedAt = new Date().toISOString();
  state.lastRunAt = finishedAt;
  state.lastRunId = runId;
  state.totalRuns += 1;
  state.totalEvaluated += evaluated;
  state.totalLiked += liked;
  state.totalBookmarked += bookmarked;
  await writeJson(twitterFeedAgentStatePath(), state);

  return {
    runId,
    startedAt,
    finishedAt,
    dryRun,
    evaluated,
    liked,
    bookmarked,
    skipped,
    failed,
    statePath: twitterFeedAgentStatePath(),
    logPath: twitterFeedAgentLogPath(),
  };
}
