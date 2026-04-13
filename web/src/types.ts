export type ArchiveSource = 'bookmarks' | 'likes';
export type HybridSearchSource = 'bookmarks' | 'likes' | 'feed';
export type HybridSearchMode = 'topic' | 'action';
export type HybridSearchScope = HybridSearchSource | 'all';
export type ViewSource = 'search' | ArchiveSource;

export interface StatusBucket {
  total: number;
  hasCache: boolean;
  hasIndex: boolean;
}

export interface StatusResponse {
  dataDir: string;
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
  source: ArchiveSource;
  total: number;
  limit: number;
  offset: number;
  items: T[];
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
