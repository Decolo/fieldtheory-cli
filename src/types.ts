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

export type FollowedAccountState = 'active' | 'protected' | 'suspended' | 'unavailable' | 'unfollowed';

export interface FollowedAccountSnapshot {
  userId: string;
  handle: string;
  name?: string;
  description?: string;
  profileImageUrl?: string;
  followersCount?: number;
  followingCount?: number;
  statusesCount?: number;
  verified?: boolean;
  protected?: boolean;
  state: FollowedAccountState;
  sourceUserId?: string;
  lastPostedAt?: string | null;
  lastSyncedAt: string;
}

export type AccountRelevanceLabelValue = 'valuable' | 'not-valuable' | 'neutral';

export interface AccountRelevanceLabel {
  targetUserId: string;
  currentHandle: string;
  value: AccountRelevanceLabelValue;
  updatedAt: string;
  note?: string;
}

export type AccountReviewStage = 'stage1' | 'stage2';
export type AccountReviewDisposition = 'healthy' | 'candidate' | 'deferred' | 'unfollowed';
export type AccountReviewReason = 'inactive' | 'low_engagement' | 'low_relevance' | 'uncertain';

export interface AccountReviewEvidence {
  inactivityDays?: number;
  inactivityThresholdDays?: number;
  followerCount?: number;
  avgLikeCount?: number;
  avgReplyCount?: number;
  avgViewCount?: number;
  label?: AccountRelevanceLabelValue;
  fetchStatus?: 'cached' | 'fetched' | 'failed' | 'unavailable';
  note?: string;
}

export interface AccountReviewResult {
  targetUserId: string;
  handle: string;
  name?: string;
  stage: AccountReviewStage;
  disposition: AccountReviewDisposition;
  primaryReason: AccountReviewReason;
  score: number;
  evidence: AccountReviewEvidence;
  lastPostedAt?: string | null;
  lastEvaluatedAt: string;
}

export interface FollowingReviewState {
  provider: 'twitter';
  schemaVersion: number;
  sourceUserId?: string;
  lastFollowingSyncAt?: string;
  followingSnapshotComplete: boolean;
  lastReviewRunAt?: string;
  lastReviewCount: number;
  totalFollowing: number;
  candidateCount: number;
  deepScannedUserIds: string[];
  lastCursor?: string;
}

export interface FollowingAccountEvidenceCache {
  targetUserId: string;
  handle: string;
  fetchedAt: string;
  recordCount: number;
  lastPostedAt?: string | null;
  avgLikeCount?: number;
  avgReplyCount?: number;
  avgViewCount?: number;
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

export type FeedDaemonStage = 'fetch' | 'semantic' | 'tick';
export type FeedDaemonOutcome = 'success' | 'error';
export type FeedDaemonErrorKind =
  | 'network'
  | 'auth'
  | 'rate_limit'
  | 'upstream'
  | 'semantic'
  | 'config'
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
  indexedItems?: number;
}

export interface FeedDaemonState {
  schemaVersion: number;
  pid?: number;
  startedAt?: string;
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastFetchAdded?: number;
  lastFetchTotalItems?: number;
  lastIndexedItems?: number;
  lastError?: string;
  intervalMs?: number;
  lastTick?: FeedDaemonLastTick;
}

export type EmbeddingProviderName = 'aliyun-bailian' | 'openai-compatible';
export type SemanticDocumentSource = 'feed' | 'likes' | 'bookmarks';

export interface SemanticMeta {
  schemaVersion: number;
  provider: EmbeddingProviderName;
  model: string;
  baseUrl: string;
  dimensions: number;
  embeddingVersion: string;
  updatedAt: string;
  lastFullRebuildAt?: string;
  documents: Record<SemanticDocumentSource, number>;
}

export interface SemanticDocumentRow {
  id: string;
  source: SemanticDocumentSource;
  tweetId: string;
  url: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  text: string;
  textHash: string;
  embeddingVersion: string;
  vector: number[];
}

export interface SemanticSearchHit {
  id: string;
  distance: number;
  score: number;
  row: SemanticDocumentRow;
}
