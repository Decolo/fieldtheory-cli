import type { HybridSearchMode, HybridSearchResult, HybridSearchScope, HybridSearchSource } from './search-types.js';

export type LegacyArchiveSource = 'bookmarks' | 'likes';
export type ArchiveSource = LegacyArchiveSource | 'feed';
export type ArchiveFilter = ArchiveSource | 'all';

export interface ApiArchiveSourceAttachment {
  source: HybridSearchSource;
  sourceTimestamp?: string | null;
  orderingKey?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
  syncedAt: string;
  ingestedVia?: string | null;
  sourceRecordId?: string;
}

export interface ApiArchiveItem {
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
  attachments: Partial<Record<HybridSearchSource, ApiArchiveSourceAttachment>>;
  isBookmarked: boolean;
  isLiked: boolean;
  isInFeed: boolean;
}

export interface ApiStatusBucket {
  total: number;
  hasCache: boolean;
  hasIndex: boolean;
}

export interface ApiStatusResponse {
  dataDir: string;
  archive: ApiStatusBucket;
  bookmarks: ApiStatusBucket;
  likes: ApiStatusBucket;
  feed: ApiStatusBucket;
}

export interface ApiListResponse<T> {
  source: LegacyArchiveSource;
  total: number;
  limit: number;
  offset: number;
  items: T[];
}

export interface ApiArchiveListResponse {
  resource: 'archive';
  source: ArchiveFilter;
  total: number;
  limit: number;
  offset: number;
  items: ApiArchiveItem[];
}

export interface ApiHybridSearchResponse {
  query: string;
  mode: HybridSearchMode;
  scope: HybridSearchScope;
  usedEngine: boolean;
  expansions: string[];
  total: number;
  items: HybridSearchResult[];
}

export interface ApiHybridSummaryResponse {
  query: string;
  mode: HybridSearchMode;
  scope: HybridSearchScope;
  usedEngine: boolean;
  expansions: string[];
  total: number;
  items: HybridSearchResult[];
  summary: string;
}

export interface ApiFeedMetricWindow {
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface ApiFeedMetricDay {
  date: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface ApiFeedActionDay {
  date: string;
  likes: number;
  bookmarks: number;
}

export interface ApiFeedMetricsResponse {
  generatedAt: string;
  feedCollection: {
    windows: {
      last24h: ApiFeedMetricWindow;
      last7d: ApiFeedMetricWindow;
    };
    daily: ApiFeedMetricDay[];
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
    daily: ApiFeedActionDay[];
    latestLikeAt: string | null;
    latestBookmarkAt: string | null;
  };
}

export type { HybridSearchMode, HybridSearchResult, HybridSearchScope, HybridSearchSource };
