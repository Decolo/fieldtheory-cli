export type LegacyArchiveSource = 'bookmarks' | 'likes';
export type ArchiveSource = LegacyArchiveSource | 'feed';
export type ArchiveFilter = ArchiveSource | 'all';
export type HybridSearchSource = 'bookmarks' | 'likes' | 'feed';
export type HybridSearchMode = 'topic' | 'action';
export type HybridSearchScope = HybridSearchSource | 'all';
export type ViewSource = 'dashboard' | 'search' | ArchiveSource;

export interface ArchiveSourceAttachment {
  source: HybridSearchSource;
  sourceTimestamp?: string | null;
  orderingKey?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
  syncedAt: string;
  ingestedVia?: string | null;
  sourceRecordId?: string;
}

export interface ArchiveItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  syncedAt: string;
  source: HybridSearchSource;
  sources: HybridSearchSource[];
  sourceCount: number;
  sourceDates: Partial<Record<HybridSearchSource, string | null>>;
  attachments: Partial<Record<HybridSearchSource, ArchiveSourceAttachment>>;
  isBookmarked: boolean;
  isLiked: boolean;
  isInFeed: boolean;
}

export interface StatusBucket {
  total: number;
  hasCache: boolean;
  hasIndex: boolean;
}

export interface StatusResponse {
  dataDir: string;
  archive: StatusBucket;
  bookmarks: StatusBucket;
  likes: StatusBucket;
  feed: StatusBucket;
}

export interface BookmarkItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  bookmarkedAt?: string | null;
  categories: string[];
  primaryCategory?: string | null;
  domains: string[];
  primaryDomain?: string | null;
  githubUrls: string[];
  links: string[];
  mediaCount: number;
  linkCount: number;
  likeCount?: number | null;
  repostCount?: number | null;
  replyCount?: number | null;
  quoteCount?: number | null;
  bookmarkCount?: number | null;
  viewCount?: number | null;
}

export interface LikeItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  likedAt?: string | null;
  links: string[];
  mediaCount: number;
  linkCount: number;
  likeCount?: number | null;
  repostCount?: number | null;
  replyCount?: number | null;
  quoteCount?: number | null;
  bookmarkCount?: number | null;
  viewCount?: number | null;
}

export interface HybridSearchResult {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  source: HybridSearchSource;
  sources: HybridSearchSource[];
  sourceCount: number;
  score: number;
  topicScore: number;
  actionScore: number;
  matchedQueries: string[];
  sourceDates: Partial<Record<HybridSearchSource, string | null>>;
  isBookmarked: boolean;
  isLiked: boolean;
  isInFeed: boolean;
}

export interface ListResponse<T> {
  source: LegacyArchiveSource;
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface ArchiveListResponse {
  resource: 'archive';
  source: ArchiveFilter;
  total: number;
  limit: number;
  offset: number;
  items: ArchiveItem[];
}

export interface HybridSearchResponse {
  query: string;
  mode: HybridSearchMode;
  scope: HybridSearchScope;
  usedEngine: boolean;
  expansions: string[];
  total: number;
  items: HybridSearchResult[];
}

export interface HybridSummaryResponse extends HybridSearchResponse {
  summary: string;
}

export interface FeedMetricWindow {
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface FeedMetricDay {
  date: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface FeedActionDay {
  date: string;
  likes: number;
  bookmarks: number;
}

export interface FeedMetricsResponse {
  generatedAt: string;
  feedCollection: {
    windows: {
      last24h: FeedMetricWindow;
      last7d: FeedMetricWindow;
    };
    daily: FeedMetricDay[];
    lastOutcome: {
      timestamp: string;
      outcome: 'success' | 'error';
      kind?: string;
      summary?: string;
    } | null;
  };
  actions: {
    totals: {
      likes: number;
      bookmarks: number;
    };
    daily: FeedActionDay[];
    latestLikeAt: string | null;
    latestBookmarkAt: string | null;
  };
}
