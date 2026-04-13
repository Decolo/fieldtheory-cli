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

export type { HybridSearchMode, HybridSearchResult, HybridSearchScope, HybridSearchSource };
