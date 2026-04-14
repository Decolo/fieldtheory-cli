import { searchBookmarks } from './bookmarks-db.js';
import { searchLikes } from './likes-db.js';
import { searchFeed } from './feed-db.js';
import type {
  HybridSearchMode,
  HybridSearchResponse,
  HybridSearchResult,
  HybridSearchScope,
  HybridSearchSource,
} from './search-types.js';

interface HybridSearchOptions {
  query: string;
  mode?: HybridSearchMode;
  scope?: HybridSearchScope;
  limit?: number;
  summary?: boolean;
}

interface CandidateAccumulator {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  sources: Set<HybridSearchSource>;
  sourceDates: Partial<Record<HybridSearchSource, string | null>>;
  matchedQueries: Set<string>;
  lexicalScore: number;
}

const SOURCE_PRIORITY: HybridSearchSource[] = ['bookmarks', 'likes', 'feed'];

function tokenizeQuery(query: string): string[] {
  return Array.from(new Set(
    query
      .toLowerCase()
      .split(/[^a-z0-9_]+/i)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  ));
}

function buildLocalProbes(query: string): string[] {
  const tokens = tokenizeQuery(query);
  if (tokens.length === 0) return [];

  const probes = new Set<string>();
  probes.add(tokens.slice(0, 6).join(' '));
  if (tokens.length >= 2) probes.add(tokens.slice(0, 6).join(' OR '));
  if (tokens.length >= 3) {
    for (let index = 0; index < Math.min(tokens.length - 1, 3); index += 1) {
      probes.add(tokens.slice(index, index + 2).join(' '));
    }
  }

  return Array.from(probes).filter(Boolean);
}

function registerCandidate(
  accumulator: Map<string, CandidateAccumulator>,
  input: {
    id: string;
    tweetId?: string;
    url: string;
    text: string;
    authorHandle?: string;
    authorName?: string;
    postedAt?: string | null;
    source: HybridSearchSource;
    probe: string;
    rank: number;
  },
): void {
  const key = input.tweetId ?? input.id;
  const existing = accumulator.get(key);
  const lexicalContribution = 1 / (input.rank + 1);

  if (!existing) {
    accumulator.set(key, {
      id: input.id,
      tweetId: input.tweetId ?? input.id,
      url: input.url,
      text: input.text,
      authorHandle: input.authorHandle,
      authorName: input.authorName,
      postedAt: input.postedAt ?? null,
      sources: new Set([input.source]),
      sourceDates: { [input.source]: input.postedAt ?? null },
      matchedQueries: new Set([input.probe]),
      lexicalScore: lexicalContribution,
    });
    return;
  }

  existing.sources.add(input.source);
  existing.sourceDates[input.source] = input.postedAt ?? null;
  existing.matchedQueries.add(input.probe);
  existing.lexicalScore += lexicalContribution;

  if (!existing.authorHandle && input.authorHandle) existing.authorHandle = input.authorHandle;
  if (!existing.authorName && input.authorName) existing.authorName = input.authorName;
  if (!existing.postedAt && input.postedAt) existing.postedAt = input.postedAt;
}

function choosePrimarySource(sources: Set<HybridSearchSource>): HybridSearchSource {
  for (const source of SOURCE_PRIORITY) {
    if (sources.has(source)) return source;
  }
  return 'feed';
}

function buildFallbackSummary(results: HybridSearchResult[]): string {
  if (results.length === 0) return 'No matching results were found.';

  const sourceCounts = new Map<string, number>();
  const authorCounts = new Map<string, number>();

  for (const result of results.slice(0, 10)) {
    for (const source of result.sources) {
      sourceCounts.set(source, (sourceCounts.get(source) ?? 0) + 1);
    }
    if (result.authorHandle) {
      authorCounts.set(result.authorHandle, (authorCounts.get(result.authorHandle) ?? 0) + 1);
    }
  }

  const sources = Array.from(sourceCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source} ${count}`)
    .join(', ');
  const authors = Array.from(authorCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([author]) => `@${author}`)
    .join(', ');

  return `Top results cluster around ${sources || 'the local archive'}${authors ? `, with repeated authors like ${authors}` : ''}.`;
}

async function summarizeResults(
  _query: string,
  _mode: HybridSearchMode,
  results: HybridSearchResult[],
): Promise<string> {
  return buildFallbackSummary(results);
}

export async function runHybridSearch(options: HybridSearchOptions): Promise<HybridSearchResponse> {
  const query = options.query.trim();
  const mode = options.mode ?? 'topic';
  const scope = options.scope ?? 'all';
  const limit = options.limit ?? 20;
  const perProbeLimit = Math.max(limit, 8);

  if (!query) {
    return {
      query,
      mode,
      scope,
      usedEngine: false,
      expansions: [],
      results: [],
      summary: options.summary ? 'No matching results were found.' : undefined,
    };
  }

  const probes = buildLocalProbes(query).slice(0, 8);

  const candidateMap = new Map<string, CandidateAccumulator>();
  const allowSource = (source: HybridSearchSource): boolean => scope === 'all' || scope === source;

  for (const probe of probes) {
    if (!probe) continue;

    if (allowSource('bookmarks')) {
      const results = await searchBookmarks({ query: probe, limit: perProbeLimit });
      results.forEach((result, index) => registerCandidate(candidateMap, {
        ...result,
        tweetId: result.id,
        source: 'bookmarks',
        probe,
        rank: index,
      }));
    }

    if (allowSource('likes')) {
      const results = await searchLikes({ query: probe, limit: perProbeLimit });
      results.forEach((result, index) => registerCandidate(candidateMap, {
        ...result,
        tweetId: result.id,
        source: 'likes',
        probe,
        rank: index,
      }));
    }

    if (allowSource('feed')) {
      const results = await searchFeed(probe, perProbeLimit);
      results.forEach((result, index) => registerCandidate(candidateMap, {
        ...result,
        source: 'feed',
        probe,
        rank: index,
      }));
    }
  }

  const preferredAuthors = new Set<string>();
  for (const candidate of candidateMap.values()) {
    if ((candidate.sources.has('bookmarks') || candidate.sources.has('likes')) && candidate.authorHandle) {
      preferredAuthors.add(candidate.authorHandle);
    }
  }

  const ranked = Array.from(candidateMap.values()).map<HybridSearchResult>((candidate) => {
    const sources = Array.from(candidate.sources);
    const isBookmarked = candidate.sources.has('bookmarks');
    const isLiked = candidate.sources.has('likes');
    const isInFeed = candidate.sources.has('feed');
    const coverageBoost = candidate.matchedQueries.size * 0.18;
    const breadthBoost = Math.max(0, sources.length - 1) * 0.22;
    const authorBoost = candidate.authorHandle && preferredAuthors.has(candidate.authorHandle) && !isBookmarked && !isLiked
      ? 0.3
      : 0;

    const topicScore = candidate.lexicalScore + coverageBoost + breadthBoost;
    const actionScore = (topicScore * 0.45)
      + (isBookmarked ? 1.2 : 0)
      + (isLiked ? 0.95 : 0)
      + authorBoost
      + (isBookmarked && isLiked ? 0.25 : 0);

    return {
      id: candidate.id,
      tweetId: candidate.tweetId,
      url: candidate.url,
      text: candidate.text,
      authorHandle: candidate.authorHandle,
      authorName: candidate.authorName,
      postedAt: candidate.postedAt,
      source: choosePrimarySource(candidate.sources),
      sources,
      score: mode === 'action' ? actionScore : topicScore,
      topicScore,
      actionScore,
      matchedQueries: Array.from(candidate.matchedQueries),
      sourceDates: candidate.sourceDates,
      isBookmarked,
      isLiked,
      isInFeed,
    };
  });

  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return (right.postedAt ?? '').localeCompare(left.postedAt ?? '');
  });

  const results = ranked.slice(0, limit);
  const summary = options.summary ? await summarizeResults(query, mode, results) : undefined;

  return {
    query,
    mode,
    scope,
    usedEngine: false,
    expansions: [],
    results,
    summary,
  };
}
