import type { HybridSearchMode, HybridSearchResult, HybridSearchScope, HybridSearchSource } from './search-types.js';

export type ArchiveSource = 'bookmarks' | 'likes';

export interface ApiStatusBucket {
  total: number;
  hasCache: boolean;
  hasIndex: boolean;
}

export interface ApiStatusResponse {
  dataDir: string;
  bookmarks: ApiStatusBucket;
  likes: ApiStatusBucket;
  feed: ApiStatusBucket;
}

export interface ApiListResponse<T> {
  source: ArchiveSource;
  total: number;
  limit: number;
  offset: number;
  items: T[];
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
