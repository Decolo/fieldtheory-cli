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
  handle?: string;
  name?: string;
  profileImageUrl?: string;
  description?: string;
  location?: string;
  url?: string;
  verified?: boolean;
  followersCount?: number;
  followingCount?: number;
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

export interface BookmarkRecord {
  id: string;
  tweetId: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  url: string;
  text: string;
  postedAt?: string | null;
  bookmarkedAt?: string | null;
  /** X's opaque bookmark ordering key. Useful for chronology, not timestamps. */
  sortIndex?: string | null;
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
  ingestedVia?: 'api' | 'browser' | 'graphql';
}

export interface LikeRecord {
  id: string;
  tweetId: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  url: string;
  text: string;
  postedAt?: string | null;
  likedAt?: string | null;
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
  ingestedVia?: 'browser' | 'graphql';
}

export interface FeedRecord {
  id: string;
  tweetId: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  url: string;
  text: string;
  postedAt?: string | null;
  syncedAt: string;
  sortIndex?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
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

export interface FeedAgentItemState {
  tweetId: string;
  lastEvaluatedAt?: string;
  lastRunId?: string;
  lastLikeScore?: number;
  lastBookmarkScore?: number;
  likedAt?: string;
  bookmarkedAt?: string;
}

export interface FeedAgentState {
  provider: 'twitter';
  schemaVersion: number;
  lastRunAt?: string;
  lastRunId?: string;
  totalRuns: number;
  totalEvaluated: number;
  totalLiked: number;
  totalBookmarked: number;
  items: Record<string, FeedAgentItemState>;
}

export type FeedPreferenceTargetKind = 'author' | 'domain' | 'topic';
export type FeedPreferenceActionKind = 'like' | 'bookmark';
export type FeedPreferenceDisposition = 'prefer' | 'avoid';

export interface FeedPreferenceRule {
  kind: FeedPreferenceTargetKind;
  value: string;
  createdAt: string;
}

export interface FeedPreferenceBucket {
  prefer: FeedPreferenceRule[];
  avoid: FeedPreferenceRule[];
}

export interface FeedPreferences {
  like: FeedPreferenceBucket;
  bookmark: FeedPreferenceBucket;
}

export interface FeedDaemonState {
  schemaVersion: number;
  pid?: number;
  startedAt?: string;
  lastTickStartedAt?: string;
  lastTickFinishedAt?: string;
  lastFetchAdded?: number;
  lastFetchTotalItems?: number;
  lastConsumed?: number;
  lastLiked?: number;
  lastBookmarked?: number;
  lastFailed?: number;
  lastError?: string;
  intervalMs?: number;
}

export interface FeedAgentLogEntry {
  runId: string;
  timestamp: string;
  tweetId: string;
  authorHandle?: string;
  url: string;
  decision: 'skip' | 'like' | 'bookmark' | 'like+bookmark' | 'dry-run' | 'error';
  likeScore: number;
  bookmarkScore: number;
  actions: {
    like: 'applied' | 'already-done' | 'skipped' | 'planned' | 'failed';
    bookmark: 'applied' | 'already-done' | 'skipped' | 'planned' | 'failed';
  };
  reasons: string[];
  error?: string;
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
  preferences: {
    likePrefer: number;
    likeAvoid: number;
    bookmarkPrefer: number;
    bookmarkAvoid: number;
  };
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

export interface SemanticPreferenceRow {
  id: string;
  action: FeedPreferenceActionKind;
  disposition: FeedPreferenceDisposition;
  rawText: string;
  normalizedText: string;
  textHash: string;
  embeddingVersion: string;
  vector: number[];
}

export interface SemanticSearchHit {
  id: string;
  distance: number;
  score: number;
  row: SemanticDocumentRow | SemanticPreferenceRow;
}
