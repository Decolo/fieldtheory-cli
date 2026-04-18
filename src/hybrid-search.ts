import { openDb } from './db.js';
import { twitterArchiveIndexPath } from './paths.js';
import { rebuildArchiveStoreFromCaches } from './archive-store.js';
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

interface ArchiveCandidateRow {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  sources: HybridSearchSource[];
  score: number;
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

function parseSources(value: unknown): HybridSearchSource[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): HybridSearchSource[] => {
      if (entry === 'bookmark') return ['bookmarks'];
      if (entry === 'like') return ['likes'];
      if (entry === 'feed') return ['feed'];
      if (entry === 'bookmarks' || entry === 'likes') return [entry];
      return [];
    });
  } catch {
    return [];
  }
}

function singularSource(scope: Exclude<HybridSearchScope, 'all'>): 'bookmark' | 'like' | 'feed' {
  if (scope === 'bookmarks') return 'bookmark';
  if (scope === 'likes') return 'like';
  return 'feed';
}

async function ensureArchiveIndex(): Promise<void> {
  await rebuildArchiveStoreFromCaches({ buildIndex: true });
}

function normalizeSourceDates(row: unknown[]): Partial<Record<HybridSearchSource, string | null>> {
  return {
    bookmarks: (row[8] as string) ?? null,
    likes: (row[9] as string) ?? null,
    feed: (row[10] as string) ?? null,
  };
}

async function searchArchiveCandidates(
  probe: string,
  scope: HybridSearchScope,
  limit: number,
): Promise<Array<ArchiveCandidateRow & { sourceDates: Partial<Record<HybridSearchSource, string | null>> }>> {
  const db = await openDb(twitterArchiveIndexPath());
  const params: Array<string | number> = [probe];
  const conditions = ['ai.rowid IN (SELECT rowid FROM archive_items_fts WHERE archive_items_fts MATCH ?)'];

  if (scope !== 'all') {
    conditions.push(`EXISTS (
      SELECT 1
      FROM archive_sources src_filter
      WHERE src_filter.tweet_id = ai.tweet_id
        AND src_filter.source = ?
    )`);
    params.push(singularSource(scope));
  }

  try {
    let rows;
    try {
      rows = db.exec(
        `
          SELECT
            ai.id,
            ai.tweet_id,
            ai.url,
            ai.text,
            ai.author_handle,
            ai.author_name,
            ai.posted_at,
            ai.sources_json,
            (
              SELECT MAX(src_bookmark.source_timestamp)
              FROM archive_sources src_bookmark
              WHERE src_bookmark.tweet_id = ai.tweet_id
                AND src_bookmark.source = 'bookmark'
            ) AS bookmark_timestamp,
            (
              SELECT MAX(src_like.source_timestamp)
              FROM archive_sources src_like
              WHERE src_like.tweet_id = ai.tweet_id
                AND src_like.source = 'like'
            ) AS like_timestamp,
            (
              SELECT MAX(COALESCE(src_feed.source_timestamp, src_feed.synced_at))
              FROM archive_sources src_feed
              WHERE src_feed.tweet_id = ai.tweet_id
                AND src_feed.source = 'feed'
            ) AS feed_timestamp,
            bm25(archive_items_fts, 5.0, 2.0, 1.0, 1.0) AS score
          FROM archive_items ai
          JOIN archive_items_fts ON archive_items_fts.rowid = ai.rowid
          WHERE ${conditions.join(' AND ')}
          ORDER BY bm25(archive_items_fts, 5.0, 2.0, 1.0, 1.0) ASC
          LIMIT ?
        `,
        [...params, limit],
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
        throw new Error(`Invalid search query: "${probe}". Try simpler terms or wrap phrases in double quotes.`);
      }
      throw error;
    }

    return (rows[0]?.values ?? []).map((row) => ({
      id: String(row[0]),
      tweetId: String(row[1]),
      url: String(row[2]),
      text: String(row[3] ?? ''),
      authorHandle: (row[4] as string) ?? undefined,
      authorName: (row[5] as string) ?? undefined,
      postedAt: (row[6] as string) ?? null,
      sources: parseSources(row[7]),
      sourceDates: normalizeSourceDates(row),
      score: Number(row[11] ?? 0),
    }));
  } finally {
    db.close();
  }
}

function registerCandidate(
  accumulator: Map<string, CandidateAccumulator>,
  input: ArchiveCandidateRow & {
    sourceDates: Partial<Record<HybridSearchSource, string | null>>;
    probe: string;
  },
): void {
  const existing = accumulator.get(input.tweetId);
  const lexicalContribution = input.score <= 0
    ? 1 + Math.abs(input.score)
    : 1 / (input.score + 1);

  if (!existing) {
    accumulator.set(input.tweetId, {
      id: input.id,
      tweetId: input.tweetId,
      url: input.url,
      text: input.text,
      authorHandle: input.authorHandle,
      authorName: input.authorName,
      postedAt: input.postedAt ?? null,
      sources: new Set(input.sources),
      sourceDates: { ...input.sourceDates },
      matchedQueries: new Set([input.probe]),
      lexicalScore: lexicalContribution,
    });
    return;
  }

  input.sources.forEach((source) => existing.sources.add(source));
  for (const source of SOURCE_PRIORITY) {
    if (input.sourceDates[source] !== undefined) {
      existing.sourceDates[source] = input.sourceDates[source];
    }
  }
  existing.matchedQueries.add(input.probe);
  existing.lexicalScore += lexicalContribution;

  if (!existing.authorHandle && input.authorHandle) existing.authorHandle = input.authorHandle;
  if (!existing.authorName && input.authorName) existing.authorName = input.authorName;
  if (!existing.postedAt && input.postedAt) existing.postedAt = input.postedAt;
}

function choosePrimarySource(
  sources: Iterable<HybridSearchSource>,
  preferred?: HybridSearchScope,
): HybridSearchSource {
  const available = new Set(sources);
  if (preferred && preferred !== 'all' && available.has(preferred)) return preferred;
  for (const source of SOURCE_PRIORITY) {
    if (available.has(source)) return source;
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

  await ensureArchiveIndex();
  const probes = buildLocalProbes(query).slice(0, 8);
  const candidateMap = new Map<string, CandidateAccumulator>();

  for (const probe of probes) {
    if (!probe) continue;
    const results = await searchArchiveCandidates(probe, scope, perProbeLimit);
    results.forEach((result) => registerCandidate(candidateMap, {
      ...result,
      probe,
    }));
  }

  const preferredAuthors = new Set<string>();
  for (const candidate of candidateMap.values()) {
    if ((candidate.sources.has('bookmarks') || candidate.sources.has('likes')) && candidate.authorHandle) {
      preferredAuthors.add(candidate.authorHandle);
    }
  }

  const ranked = Array.from(candidateMap.values()).map<HybridSearchResult>((candidate) => {
    const sources = SOURCE_PRIORITY.filter((source) => candidate.sources.has(source));
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
      postedAt: candidate.postedAt ?? null,
      source: choosePrimarySource(sources, scope),
      sources,
      score: mode === 'action' ? actionScore : topicScore,
      topicScore,
      actionScore,
      matchedQueries: Array.from(candidate.matchedQueries),
      sourceDates: candidate.sourceDates,
      isBookmarked,
      isLiked,
      isInFeed,
      sourceCount: sources.length,
    };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if ((b.postedAt ?? '') !== (a.postedAt ?? '')) return (b.postedAt ?? '').localeCompare(a.postedAt ?? '');
    return a.url.localeCompare(b.url);
  });

  const results = ranked.slice(0, limit);

  return {
    query,
    mode,
    scope,
    usedEngine: false,
    expansions: [],
    results,
    summary: options.summary ? await summarizeResults(query, mode, results) : undefined,
  };
}
