import type {
  ArchiveFilter,
  ArchiveItem,
  ArchiveListResponse,
  BookmarkItem,
  FeedMetricsResponse,
  HybridSearchMode,
  HybridSearchResponse,
  HybridSearchScope,
  HybridSummaryResponse,
  LegacyArchiveSource,
  LikeItem,
  ListResponse,
  StatusResponse,
} from './types';

async function requestJson<T>(input: string): Promise<T> {
  const response = await fetch(input);
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchStatus(): Promise<StatusResponse> {
  return requestJson<StatusResponse>('/api/status');
}

export async function fetchFeedMetrics(): Promise<FeedMetricsResponse> {
  return requestJson<FeedMetricsResponse>('/api/feed/metrics');
}

export async function fetchArchiveList(
  source: LegacyArchiveSource,
  options: { query?: string; limit?: number; offset?: number } = {},
): Promise<ListResponse<BookmarkItem> | ListResponse<LikeItem>> {
  const params = new URLSearchParams();
  if (options.query) params.set('query', options.query);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const suffix = params.toString();
  return requestJson(`/api/${source}${suffix ? `?${suffix}` : ''}`);
}

export async function fetchArchiveItem(source: LegacyArchiveSource, id: string): Promise<BookmarkItem | LikeItem> {
  return requestJson(`/api/${source}/${id}`);
}

export async function fetchUnifiedArchive(
  options: { source?: ArchiveFilter; query?: string; limit?: number; offset?: number } = {},
): Promise<ArchiveListResponse> {
  const params = new URLSearchParams();
  if (options.source) params.set('source', options.source);
  if (options.query) params.set('query', options.query);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));
  const suffix = params.toString();
  return requestJson(`/api/archive${suffix ? `?${suffix}` : ''}`);
}

export async function fetchUnifiedArchiveItem(id: string): Promise<ArchiveItem> {
  return requestJson(`/api/archive/${id}`);
}

export async function fetchHybridSearch(
  query: string,
  options: { mode?: HybridSearchMode; scope?: HybridSearchScope; limit?: number } = {},
): Promise<HybridSearchResponse> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (options.mode) params.set('mode', options.mode);
  if (options.scope) params.set('scope', options.scope);
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString();
  return requestJson(`/api/search${suffix ? `?${suffix}` : ''}`);
}

export async function fetchHybridSummary(
  query: string,
  options: { mode?: HybridSearchMode; scope?: HybridSearchScope; limit?: number } = {},
): Promise<HybridSummaryResponse> {
  const params = new URLSearchParams();
  if (query) params.set('query', query);
  if (options.mode) params.set('mode', options.mode);
  if (options.scope) params.set('scope', options.scope);
  if (options.limit) params.set('limit', String(options.limit));
  const suffix = params.toString();
  return requestJson(`/api/search/summary${suffix ? `?${suffix}` : ''}`);
}
