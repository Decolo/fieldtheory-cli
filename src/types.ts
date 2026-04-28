import type { ArchiveRecordBase } from './archive-core.js';
export type {
  ArchiveIngestMode,
  ArchiveItem,
  ArchiveSourceAttachment,
  ArchiveSourceAttachments,
  ArchiveSourceKind,
} from './archive-core.js';

export interface BookmarkMediaVariant {
  url?: string;
  contentType?: string;
  bitrate?: number;
}

export interface BookmarkMediaObject {
  url?: string;
  mediaUrl?: string;
  expandedUrl?: string;
  previewUrl?: string;
  type?: string;
  altText?: string;
  extAltText?: string;
  width?: number;
  height?: number;
  videoVariants?: BookmarkMediaVariant[];
  variants?: BookmarkMediaVariant[];
}

export interface BookmarkAuthorSnapshot {
  id?: string;
  handle?: string;
  name?: string;
  profileImageUrl?: string;
  bio?: string;
  followerCount?: number;
  followingCount?: number;
  tweetCount?: number;
  isVerified?: boolean;
  snapshotAt?: string;
  description?: string;
  location?: string;
  url?: string;
  verified?: boolean;
  followersCount?: number;
  statusesCount?: number;
}

export interface BookmarkEngagementSnapshot {
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
  bookmarkCount?: number;
  viewCount?: number;
}

export interface QuotedTweetSnapshot {
  id: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  media?: string[];
  mediaObjects?: BookmarkMediaObject[];
  url: string;
}

/** Compatibility projection over the canonical archive item model. */
export interface BookmarkRecord extends ArchiveRecordBase {
  id: string;
  tweetId: string;
  bookmarkedAt?: string | null;
  /** X's opaque bookmark ordering key. Useful for chronology, not timestamps. */
  sortIndex?: string | null;
  ingestedVia?: 'api' | 'browser' | 'graphql';
}

/** Compatibility projection over the canonical archive item model. */
export interface LikeRecord extends ArchiveRecordBase {
  id: string;
  tweetId: string;
  likedAt?: string | null;
  ingestedVia?: 'browser' | 'graphql';
}

/** Compatibility projection over the canonical archive item model. */
export interface FeedRecord extends ArchiveRecordBase {
  id: string;
  tweetId: string;
  sortIndex?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
  ingestedVia?: 'graphql';
}

export interface BookmarkCacheMeta {
  provider: 'twitter';
  schemaVersion: number;
  lastFullSyncAt?: string;
  lastIncrementalSyncAt?: string;
  totalBookmarks: number;
}

export interface LikesCacheMeta {
  provider: 'twitter';
  schemaVersion: number;
  lastFullSyncAt?: string;
  lastIncrementalSyncAt?: string;
  totalLikes: number;
}

export interface FeedCacheMeta {
  provider: 'twitter';
  schemaVersion: number;
  lastSyncAt?: string;
  totalItems: number;
  totalSkippedEntries: number;
}

export interface AccountTimelineRecord {
  id: string;
  tweetId: string;
  targetUserId: string;
  targetHandle: string;
  targetName?: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  url: string;
  text: string;
  postedAt?: string | null;
  syncedAt: string;
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  quotedStatusId?: string;
  quotedTweet?: QuotedTweetSnapshot;
  language?: string;
  sourceApp?: string;
  possiblySensitive?: boolean;
  engagement?: BookmarkEngagementSnapshot;
  media?: string[];
  mediaObjects?: BookmarkMediaObject[];
  links?: string[];
  tags?: string[];
  ingestedVia?: 'graphql';
}

export interface AccountRegistryEntry {
  userId: string;
  currentHandle: string;
  handles: string[];
  name?: string;
  lastSyncedAt?: string;
}

export interface AccountRegistry {
  schemaVersion: number;
  byHandle: Record<string, string>;
  byUserId: Record<string, AccountRegistryEntry>;
}

export interface AccountTimelineCacheMeta {
  provider: 'twitter';
  schemaVersion: number;
  targetUserId: string;
  targetHandle: string;
  targetName?: string;
  lastSyncAt?: string;
  retention: string;
  totalItems: number;
  latestTweetId?: string;
  latestTweetPostedAt?: string | null;
  latestChanged?: boolean;
}

export interface AccountTimelineState {
  provider: 'twitter';
  schemaVersion: number;
  targetUserId: string;
  targetHandle: string;
  lastRunAt?: string;
  totalRuns: number;
  totalFetched: number;
  totalStored: number;
  totalAdded: number;
  lastAdded: number;
  lastPruned: number;
  latestTweetId?: string;
  latestTweetPostedAt?: string | null;
  latestChanged?: boolean;
  lastSeenIds: string[];
  stopReason?: string;
  lastCursor?: string;
}

export type ArchiveExportResource = 'bookmarks' | 'likes' | 'feed' | 'accounts';
export type ArchiveExportSource = 'bookmark' | 'like' | 'feed' | 'account';

export interface ArchiveExportFilters {
  query?: string;
  author?: string;
  after?: string;
  before?: string;
  limit?: number;
}

export interface ArchiveExportItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  collectedAt?: string | null;
  source: ArchiveExportSource;
  sourceDetails: Record<string, unknown>;
}

export interface ArchiveExportPayload {
  resource: ArchiveExportResource;
  items: ArchiveExportItem[];
  meta: {
    count: number;
    generatedAt: string;
    filters: Record<string, string | number>;
  };
}

export interface XOAuthTokenSet {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  obtained_at: string;
}
export interface BookmarkBackfillState {
  provider: 'twitter';
  lastRunAt?: string;
  totalRuns: number;
  totalAdded: number;
  lastAdded: number;
  lastSeenIds: string[];
  stopReason?: string;
  /** Saved pagination cursor for resuming an interrupted sync. */
  lastCursor?: string;
}

export interface LikesBackfillState {
  provider: 'twitter';
  lastRunAt?: string;
  totalRuns: number;
  totalAdded: number;
  lastAdded: number;
  lastSeenIds: string[];
  stopReason?: string;
}

export interface FeedBackfillState {
  provider: 'twitter';
  lastRunAt?: string;
  totalRuns: number;
  totalFetched: number;
  totalStored: number;
  totalSkippedEntries: number;
  lastSeenIds: string[];
  stopReason?: string;
  lastCursor?: string;
}

export type FeedConversationTargetKind = 'feed_tweet' | 'quoted_tweet';
export type FeedConversationFetchOutcome = 'success' | 'partial' | 'unavailable' | 'unsupported';

export interface FeedConversationReply {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  postedAt?: string | null;
  syncedAt: string;
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  quotedStatusId?: string;
  quotedTweet?: QuotedTweetSnapshot;
  language?: string;
  sourceApp?: string;
  possiblySensitive?: boolean;
  engagement?: BookmarkEngagementSnapshot;
  media?: string[];
  mediaObjects?: BookmarkMediaObject[];
  links?: string[];
  tags?: string[];
  ingestedVia?: 'graphql';
}

export interface FeedConversationBundle {
  schemaVersion: number;
  rootFeedTweetId: string;
  rootFeedItemId: string;
  conversationTweetId: string;
  conversationId: string;
  targetKind: FeedConversationTargetKind;
  targetUrl?: string;
  fetchedAt: string;
  outcome: FeedConversationFetchOutcome;
  unavailableReason?: string;
  summary?: string;
  replies: FeedConversationReply[];
}

export interface FeedConversationFetchState {
  rootFeedTweetId: string;
  rootFeedItemId: string;
  conversationTweetId?: string;
  conversationId?: string;
  targetKind?: FeedConversationTargetKind;
  lastFetchedAt?: string;
  outcome?: FeedConversationFetchOutcome;
  replyCount: number;
  unavailableReason?: string;
  summary?: string;
}

export interface FeedConversationStoreState {
  provider: 'twitter';
  schemaVersion: number;
  updatedAt?: string;
  records: Record<string, FeedConversationFetchState>;
}

export type FeedDaemonStage = 'fetch' | 'tick';
export type FeedDaemonOutcome = 'success' | 'error';
export type FeedDaemonErrorKind =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'unknown';

export interface FeedDaemonLastTick {
  tickId: string;
  startedAt: string;
  finishedAt: string;
  stage: FeedDaemonStage;
  outcome: FeedDaemonOutcome;
  errorKind?: FeedDaemonErrorKind;
  summary?: string;
  durationMs: number;
  fetchAdded?: number;
  fetchTotalItems?: number;
}

export interface FeedDaemonState {
  schemaVersion: number;
  pid?: number;
  startedAt?: string;
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastFetchAdded?: number;
  lastFetchTotalItems?: number;
  lastError?: string;
  intervalMs?: number;
  lastTick?: FeedDaemonLastTick;
}
