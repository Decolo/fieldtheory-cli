export type HybridSearchSource = 'bookmarks' | 'likes' | 'feed';
export type HybridSearchMode = 'topic' | 'action';
export type HybridSearchScope = HybridSearchSource | 'all';

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

export interface HybridSearchResponse {
  query: string;
  mode: HybridSearchMode;
  scope: HybridSearchScope;
  usedEngine: boolean;
  expansions: string[];
  results: HybridSearchResult[];
  summary?: string;
}
