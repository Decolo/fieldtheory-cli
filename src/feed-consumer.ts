import { appendLine, pathExists, readJson, readJsonLines, writeJson } from './fs.js';
import { upsertBookmarksInArchive, upsertLikesInArchive } from './archive-actions.js';
import { RemoteTweetActionError, bookmarkTweet, likeTweet } from './graphql-actions.js';
import { loadFeedPreferences } from './feed-preferences.js';
import { scoreSemanticItem } from './feed-semantic-scorer.js';
import { SemanticStore } from './semantic-store.js';
import {
  twitterArchiveCachePath,
  twitterBookmarksCachePath,
  twitterFeedAgentLogPath,
  twitterFeedAgentStatePath,
  twitterLikesCachePath,
} from './paths.js';
import type {
  ArchiveItem,
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
  actionRetries: number;
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

function actionErrorDetail(error: unknown): NonNullable<FeedAgentLogEntry['actionDetails']>[keyof NonNullable<FeedAgentLogEntry['actionDetails']>] {
  if (error instanceof RemoteTweetActionError) {
    return {
      attempts: error.attempts,
      retryable: error.retryable,
      errorKind: error.kind ?? 'unknown',
    };
  }
  return { errorKind: 'unknown' };
}

interface FeedArchiveActionState {
  likeSet: Set<string>;
  bookmarkSet: Set<string>;
}

async function loadFeedArchiveActionState(): Promise<FeedArchiveActionState> {
  if (await pathExists(twitterArchiveCachePath())) {
    const archive = await readJsonLines<ArchiveItem>(twitterArchiveCachePath());
    const likeSet = new Set<string>();
    const bookmarkSet = new Set<string>();

    for (const item of archive) {
      addArchiveActionKeys(item, 'like', likeSet);
      addArchiveActionKeys(item, 'bookmark', bookmarkSet);
    }

    return { likeSet, bookmarkSet };
  }

  const [likes, bookmarks] = await Promise.all([
    readJsonLines<LikeRecord>(twitterLikesCachePath()),
    readJsonLines<BookmarkRecord>(twitterBookmarksCachePath()),
  ]);

  return {
    likeSet: new Set(likes.flatMap(recordActionKeys)),
    bookmarkSet: new Set(bookmarks.flatMap(recordActionKeys)),
  };
}

function addArchiveActionKeys(item: ArchiveItem, source: 'like' | 'bookmark', target: Set<string>): void {
  const attachment = source === 'like' ? item.sourceAttachments.like : item.sourceAttachments.bookmark;
  if (!attachment) return;
  if (item.tweetId) target.add(item.tweetId);
  if (item.id) target.add(item.id);
  const sourceRecordId = typeof attachment.metadata?.sourceRecordId === 'string'
    ? attachment.metadata.sourceRecordId
    : null;
  if (sourceRecordId) target.add(sourceRecordId);
}

function recordActionKeys(record: { id: string; tweetId: string }): string[] {
  return record.id === record.tweetId ? [record.tweetId] : [record.tweetId, record.id];
}

export async function consumeFeedItems(items: FeedRecord[], options: FeedConsumeOptions = {}): Promise<FeedConsumeResult> {
  const startedAt = new Date().toISOString();
  const runId = `run-${startedAt.replace(/[-:.TZ]/g, '').slice(0, 14)}`;
  const dryRun = Boolean(options.dryRun);
  const likeThreshold = options.likeThreshold ?? DEFAULT_LIKE_THRESHOLD;
  const bookmarkThreshold = options.bookmarkThreshold ?? DEFAULT_BOOKMARK_THRESHOLD;
  const [{ bookmarkSet, likeSet }, state] = await Promise.all([
    loadFeedArchiveActionState(),
    loadState(),
  ]);
  const explicitPreferences = loadFeedPreferences();
  const candidateLimit = options.candidateLimit ?? items.length ?? 1;
  const candidates = sortCandidates(items, state).slice(0, Math.max(0, candidateLimit));
  const semanticStore = await SemanticStore.open();

  let evaluated = 0;
  let liked = 0;
  let bookmarked = 0;
  let skipped = 0;
  let failed = 0;
  let actionRetries = 0;
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
      const actionDetails: NonNullable<FeedAgentLogEntry['actionDetails']> = {};

      if (wantLike) {
        if (dryRun) {
          likeAction = 'planned';
        } else {
          try {
            const result = await likeTweet(key, options);
            pendingLikes.push(toLikeRecord(item, timestamp));
            itemState.likedAt = timestamp;
            likeSet.add(key);
            likeAction = 'applied';
            actionDetails.like = { attempts: result.attempts };
            actionRetries += Math.max(0, result.attempts - 1);
            liked += 1;
          } catch (error) {
            likeAction = 'failed';
            errorMessage = (error as Error).message;
            actionDetails.like = actionErrorDetail(error);
            const likeAttempts = actionDetails.like?.attempts ?? 1;
            actionRetries += Math.max(0, likeAttempts - 1);
            failed += 1;
          }
        }
      }

      if (wantBookmark) {
        if (dryRun) {
          bookmarkAction = 'planned';
        } else {
          try {
            const result = await bookmarkTweet(key, options);
            pendingBookmarks.push(toBookmarkRecord(item, timestamp));
            itemState.bookmarkedAt = timestamp;
            bookmarkSet.add(key);
            bookmarkAction = 'applied';
            actionDetails.bookmark = { attempts: result.attempts };
            actionRetries += Math.max(0, result.attempts - 1);
            bookmarked += 1;
          } catch (error) {
            bookmarkAction = 'failed';
            errorMessage = errorMessage ?? (error as Error).message;
            actionDetails.bookmark = actionErrorDetail(error);
            actionRetries += Math.max(0, (actionDetails.bookmark?.attempts ?? 1) - 1);
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
        actionDetails: Object.keys(actionDetails).length > 0 ? actionDetails : undefined,
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
    actionRetries,
    statePath: twitterFeedAgentStatePath(),
    logPath: twitterFeedAgentLogPath(),
  };
}
