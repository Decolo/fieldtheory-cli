import type { Database } from 'sql.js';
import { openDb } from './db.js';
import { twitterArchiveIndexPath, twitterBookmarksIndexPath } from './paths.js';
import type { ArchiveSourceKind } from './types.js';

export interface ProjectionSearchOptions {
  query?: string;
  author?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export interface BookmarkProjectionFilters extends ProjectionSearchOptions {
  sort?: 'asc' | 'desc';
  offset?: number;
}

export interface LikeProjectionFilters extends ProjectionSearchOptions {
  sort?: 'asc' | 'desc';
  offset?: number;
}

export interface FeedProjectionFilters extends ProjectionSearchOptions {
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

interface SourceProjectionRow {
  canonicalId: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  itemSyncedAt: string;
  sourceTimestamp?: string | null;
  orderingKey?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
  sourceSyncedAt: string;
  links: string[];
  mediaCount: number;
  linkCount: number;
  likeCount?: number | null;
  repostCount?: number | null;
  replyCount?: number | null;
  quoteCount?: number | null;
  bookmarkCount?: number | null;
  viewCount?: number | null;
  sourceRecordId?: string;
  score?: number;
}

export interface BookmarkProjectionItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  bookmarkedAt?: string | null;
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

export interface LikeProjectionItem {
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

export interface FeedProjectionItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  postedAt?: string | null;
  syncedAt: string;
  sortIndex?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
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

export interface ProjectionSearchResult {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  sourceTimestamp?: string | null;
  syncedAt: string;
  score: number;
}

interface BookmarkDbMetadata {
  githubUrls: string[];
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function parseMetadata(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    return undefined;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function bookmarkProjectionDateFilterExpression(): string {
  return `COALESCE(ai.posted_at, src.source_timestamp)`;
}

function sourceOrderClause(source: ArchiveSourceKind, direction: 'asc' | 'desc' = 'desc'): string {
  const normalized = direction === 'asc' ? 'ASC' : 'DESC';

  if (source === 'bookmark') {
    return `
      ORDER BY
        CASE
          WHEN src.source_timestamp GLOB '____-__-__*' THEN src.source_timestamp
          WHEN ai.posted_at GLOB '____-__-__*' THEN ai.posted_at
          ELSE ''
        END ${normalized},
        CAST(ai.tweet_id AS INTEGER) ${normalized}
    `;
  }

  if (source === 'like') {
    return `
      ORDER BY
        COALESCE(NULLIF(src.source_timestamp, ''), NULLIF(ai.posted_at, ''), '') ${normalized},
        CAST(ai.tweet_id AS INTEGER) ${normalized}
    `;
  }

  return `
    ORDER BY
      COALESCE(NULLIF(src.synced_at, ''), '') DESC,
      CASE
        WHEN src.ordering_key GLOB '[0-9]*' THEN CAST(src.ordering_key AS INTEGER)
        ELSE -1
      END DESC,
      COALESCE(src.fetch_page, 2147483647) ASC,
      COALESCE(src.fetch_position, 2147483647) ASC,
      CAST(ai.tweet_id AS INTEGER) DESC
  `;
}

function mapSourceRow(row: unknown[]): SourceProjectionRow {
  const metadata = parseMetadata(row[18]);
  const sourceRecordId = typeof metadata?.sourceRecordId === 'string' ? metadata.sourceRecordId : undefined;

  return {
    canonicalId: String(row[0]),
    tweetId: String(row[1]),
    url: String(row[2]),
    text: String(row[3] ?? ''),
    authorHandle: (row[4] as string) ?? undefined,
    authorName: (row[5] as string) ?? undefined,
    authorProfileImageUrl: (row[6] as string) ?? undefined,
    postedAt: (row[7] as string) ?? null,
    itemSyncedAt: String(row[8]),
    sourceTimestamp: (row[9] as string) ?? null,
    orderingKey: (row[10] as string) ?? null,
    fetchPage: row[11] as number | null,
    fetchPosition: row[12] as number | null,
    sourceSyncedAt: String(row[13]),
    links: parseJsonArray(row[14]),
    mediaCount: Number(row[15] ?? 0),
    linkCount: Number(row[16] ?? 0),
    likeCount: row[17] as number | null,
    repostCount: row[19] as number | null,
    replyCount: row[20] as number | null,
    quoteCount: row[21] as number | null,
    bookmarkCount: row[22] as number | null,
    viewCount: row[23] as number | null,
    sourceRecordId,
    score: typeof row[24] === 'number' ? row[24] : undefined,
  };
}

async function queryArchiveRows(
  source: ArchiveSourceKind,
  options: {
    query?: string;
    author?: string;
    after?: string;
    before?: string;
    limit?: number;
    offset?: number;
    sort?: 'asc' | 'desc';
    id?: string;
  } = {},
): Promise<SourceProjectionRow[]> {
  const db = await openDb(twitterArchiveIndexPath());
  const conditions = ['src.source = ?'];
  const params: Array<string | number> = [source];

  if (options.query) {
    conditions.push(`ai.rowid IN (SELECT rowid FROM archive_items_fts WHERE archive_items_fts MATCH ?)`);
    params.push(options.query);
  }
  if (options.author) {
    conditions.push(`ai.author_handle = ? COLLATE NOCASE`);
    params.push(options.author);
  }
  if (options.after) {
    if (source === 'feed') {
      conditions.push(`COALESCE(ai.posted_at, src.synced_at) >= ?`);
    } else if (source === 'bookmark') {
      conditions.push(`${bookmarkProjectionDateFilterExpression()} >= ?`);
    } else {
      conditions.push(`COALESCE(src.source_timestamp, ai.posted_at) >= ?`);
    }
    params.push(options.after);
  }
  if (options.before) {
    if (source === 'feed') {
      conditions.push(`COALESCE(ai.posted_at, src.synced_at) <= ?`);
    } else if (source === 'bookmark') {
      conditions.push(`${bookmarkProjectionDateFilterExpression()} <= ?`);
    } else {
      conditions.push(`COALESCE(src.source_timestamp, ai.posted_at) <= ?`);
    }
    params.push(options.before);
  }
  if (options.id) {
    conditions.push(`(
      ai.id = ?
      OR ai.tweet_id = ?
      OR src.metadata_json LIKE ? ESCAPE '\\'
    )`);
    params.push(options.id, options.id, `%\"sourceRecordId\":\"${escapeLike(options.id)}\"%`);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const order = sourceOrderClause(source, options.sort);
  const limit = options.limit == null ? '' : 'LIMIT ?';
  const offset = options.offset == null ? '' : 'OFFSET ?';

  if (options.limit != null) params.push(options.limit);
  if (options.offset != null) params.push(options.offset);

  try {
    const rows = db.exec(
      `
        SELECT
          ai.id,
          ai.tweet_id,
          ai.url,
          ai.text,
          ai.author_handle,
          ai.author_name,
          ai.author_profile_image_url,
          ai.posted_at,
          ai.synced_at,
          src.source_timestamp,
          src.ordering_key,
          src.fetch_page,
          src.fetch_position,
          src.synced_at,
          ai.links_json,
          ai.media_count,
          ai.link_count,
          ai.like_count,
          src.metadata_json,
          ai.repost_count,
          ai.reply_count,
          ai.quote_count,
          ai.bookmark_count,
          ai.view_count,
          0 as score
        FROM archive_items ai
        JOIN archive_sources src
          ON src.tweet_id = ai.tweet_id
        ${where}
        ${order}
        ${limit}
        ${offset}
      `,
      params,
    );
    return (rows[0]?.values ?? []).map((row) => mapSourceRow(row));
  } finally {
    db.close();
  }
}

async function searchArchiveRows(
  source: ArchiveSourceKind,
  options: ProjectionSearchOptions,
): Promise<SourceProjectionRow[]> {
  const db = await openDb(twitterArchiveIndexPath());
  const limit = options.limit ?? 20;
  const conditions = ['src.source = ?'];
  const params: Array<string | number> = [source];

  if (options.query) {
    conditions.push(`ai.rowid IN (SELECT rowid FROM archive_items_fts WHERE archive_items_fts MATCH ?)`);
    params.push(options.query);
  }
  if (options.author) {
    conditions.push(`ai.author_handle = ? COLLATE NOCASE`);
    params.push(options.author);
  }
  if (options.after) {
    conditions.push(
      source === 'bookmark'
        ? `${bookmarkProjectionDateFilterExpression()} >= ?`
        : `COALESCE(src.source_timestamp, ai.posted_at) >= ?`,
    );
    params.push(options.after);
  }
  if (options.before) {
    conditions.push(
      source === 'bookmark'
        ? `${bookmarkProjectionDateFilterExpression()} <= ?`
        : `COALESCE(src.source_timestamp, ai.posted_at) <= ?`,
    );
    params.push(options.before);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

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
            ai.author_profile_image_url,
            ai.posted_at,
            ai.synced_at,
            src.source_timestamp,
            src.ordering_key,
            src.fetch_page,
            src.fetch_position,
            src.synced_at,
            ai.links_json,
            ai.media_count,
            ai.link_count,
            ai.like_count,
            src.metadata_json,
            ai.repost_count,
            ai.reply_count,
            ai.quote_count,
            ai.bookmark_count,
            ai.view_count,
            ${options.query ? 'bm25(archive_items_fts, 5.0, 2.0, 1.0, 1.0)' : '0'} as score
          FROM archive_items ai
          JOIN archive_sources src
            ON src.tweet_id = ai.tweet_id
          ${options.query ? 'JOIN archive_items_fts ON archive_items_fts.rowid = ai.rowid' : ''}
          ${where}
          ${options.query
            ? 'ORDER BY bm25(archive_items_fts, 5.0, 2.0, 1.0, 1.0) ASC'
            : sourceOrderClause(source)}
          LIMIT ?
        `,
        [...params, limit],
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
        throw new Error(`Invalid search query: "${options.query}". Try simpler terms or wrap phrases in double quotes.`);
      }
      throw error;
    }

    return (rows[0]?.values ?? []).map((row) => mapSourceRow(row));
  } finally {
    db.close();
  }
}

async function loadBookmarkMetadata(tweetIds: string[]): Promise<Map<string, BookmarkDbMetadata>> {
  if (tweetIds.length === 0) return new Map();

  const db = await openDb(twitterBookmarksIndexPath());
  try {
    const placeholders = tweetIds.map(() => '?').join(', ');
    const rows = db.exec(
      `
        SELECT tweet_id, github_urls
        FROM bookmarks
        WHERE tweet_id IN (${placeholders})
      `,
      tweetIds,
    );

    return new Map(
      (rows[0]?.values ?? []).map((row) => [
        String(row[0]),
        {
          githubUrls: parseJsonArray(row[1]),
        } satisfies BookmarkDbMetadata,
      ]),
    );
  } catch {
    return new Map();
  } finally {
    db.close();
  }
}

function mapBookmarkRow(row: SourceProjectionRow, metadata: BookmarkDbMetadata | undefined): BookmarkProjectionItem {
  return {
    id: row.sourceRecordId ?? row.canonicalId,
    tweetId: row.tweetId,
    url: row.url,
    text: row.text,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    authorProfileImageUrl: row.authorProfileImageUrl,
    postedAt: row.postedAt ?? null,
    bookmarkedAt: row.sourceTimestamp ?? null,
    githubUrls: metadata?.githubUrls ?? [],
    links: row.links,
    mediaCount: row.mediaCount,
    linkCount: row.linkCount,
    likeCount: row.likeCount,
    repostCount: row.repostCount,
    replyCount: row.replyCount,
    quoteCount: row.quoteCount,
    bookmarkCount: row.bookmarkCount,
    viewCount: row.viewCount,
  };
}

export async function searchBookmarkProjections(options: ProjectionSearchOptions): Promise<ProjectionSearchResult[]> {
  const rows = await searchArchiveRows('bookmark', options);
  return rows.map((row) => ({
    id: row.sourceRecordId ?? row.canonicalId,
    tweetId: row.tweetId,
    url: row.url,
    text: row.text,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    postedAt: row.postedAt ?? null,
    sourceTimestamp: row.sourceTimestamp ?? null,
    syncedAt: row.sourceSyncedAt,
    score: row.score ?? 0,
  }));
}

export async function listBookmarkProjections(filters: BookmarkProjectionFilters = {}): Promise<BookmarkProjectionItem[]> {
  const rows = await queryArchiveRows('bookmark', {
    query: filters.query,
    author: filters.author,
    after: filters.after,
    before: filters.before,
    sort: filters.sort,
  });
  const metadata = await loadBookmarkMetadata(rows.map((row) => row.tweetId));
  const offset = filters.offset ?? 0;
  const limit = filters.limit ?? rows.length;
  return rows.slice(offset, offset + limit).map((row) => mapBookmarkRow(row, metadata.get(row.tweetId)));
}

export async function countBookmarkProjections(filters: BookmarkProjectionFilters = {}): Promise<number> {
  const rows = await queryArchiveRows('bookmark', {
    query: filters.query,
    author: filters.author,
    after: filters.after,
    before: filters.before,
    sort: filters.sort,
  });
  return rows.length;
}

export async function getBookmarkProjectionById(id: string): Promise<BookmarkProjectionItem | null> {
  const rows = await queryArchiveRows('bookmark', { id });
  const match = rows.find((row) => row.sourceRecordId === id || row.canonicalId === id || row.tweetId === id);
  if (!match) return null;
  const metadata = await loadBookmarkMetadata([match.tweetId]);
  return mapBookmarkRow(match, metadata.get(match.tweetId));
}

export async function searchLikeProjections(options: ProjectionSearchOptions): Promise<ProjectionSearchResult[]> {
  const rows = await searchArchiveRows('like', options);
  return rows.map((row) => ({
    id: row.sourceRecordId ?? row.canonicalId,
    tweetId: row.tweetId,
    url: row.url,
    text: row.text,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    postedAt: row.postedAt ?? null,
    sourceTimestamp: row.sourceTimestamp ?? null,
    syncedAt: row.sourceSyncedAt,
    score: row.score ?? 0,
  }));
}

export async function listLikeProjections(filters: LikeProjectionFilters = {}): Promise<LikeProjectionItem[]> {
  const rows = await queryArchiveRows('like', {
    query: filters.query,
    author: filters.author,
    after: filters.after,
    before: filters.before,
    sort: filters.sort,
    limit: filters.limit,
    offset: filters.offset,
  });
  return rows.map((row) => ({
    id: row.sourceRecordId ?? row.canonicalId,
    tweetId: row.tweetId,
    url: row.url,
    text: row.text,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    authorProfileImageUrl: row.authorProfileImageUrl,
    postedAt: row.postedAt ?? null,
    likedAt: row.sourceTimestamp ?? null,
    links: row.links,
    mediaCount: row.mediaCount,
    linkCount: row.linkCount,
    likeCount: row.likeCount,
    repostCount: row.repostCount,
    replyCount: row.replyCount,
    quoteCount: row.quoteCount,
    bookmarkCount: row.bookmarkCount,
    viewCount: row.viewCount,
  }));
}

export async function countLikeProjections(filters: LikeProjectionFilters = {}): Promise<number> {
  const rows = await queryArchiveRows('like', {
    query: filters.query,
    author: filters.author,
    after: filters.after,
    before: filters.before,
    sort: filters.sort,
  });
  return rows.length;
}

export async function getLikeProjectionById(id: string): Promise<LikeProjectionItem | null> {
  const rows = await queryArchiveRows('like', { id });
  const match = rows.find((row) => row.sourceRecordId === id || row.canonicalId === id || row.tweetId === id);
  if (!match) return null;
  return {
    id: match.sourceRecordId ?? match.canonicalId,
    tweetId: match.tweetId,
    url: match.url,
    text: match.text,
    authorHandle: match.authorHandle,
    authorName: match.authorName,
    authorProfileImageUrl: match.authorProfileImageUrl,
    postedAt: match.postedAt ?? null,
    likedAt: match.sourceTimestamp ?? null,
    links: match.links,
    mediaCount: match.mediaCount,
    linkCount: match.linkCount,
    likeCount: match.likeCount,
    repostCount: match.repostCount,
    replyCount: match.replyCount,
    quoteCount: match.quoteCount,
    bookmarkCount: match.bookmarkCount,
    viewCount: match.viewCount,
  };
}

export async function searchFeedProjections(query: string, limit = 20): Promise<ProjectionSearchResult[]> {
  const rows = await searchArchiveRows('feed', { query, limit });
  return rows.map((row) => ({
    id: row.sourceRecordId ?? row.canonicalId,
    tweetId: row.tweetId,
    url: row.url,
    text: row.text,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    postedAt: row.postedAt ?? null,
    sourceTimestamp: row.sourceTimestamp ?? null,
    syncedAt: row.sourceSyncedAt,
    score: row.score ?? 0,
  }));
}

export async function listFeedProjections(filters: FeedProjectionFilters = {}): Promise<FeedProjectionItem[]> {
  const rows = await queryArchiveRows('feed', {
    query: filters.query,
    author: filters.author,
    after: filters.after,
    before: filters.before,
    sort: filters.sort,
    limit: filters.limit,
    offset: filters.offset,
  });
  return rows.map((row) => ({
    id: row.sourceRecordId ?? row.canonicalId,
    tweetId: row.tweetId,
    url: row.url,
    text: row.text,
    authorHandle: row.authorHandle,
    authorName: row.authorName,
    authorProfileImageUrl: row.authorProfileImageUrl,
    postedAt: row.postedAt ?? null,
    syncedAt: row.sourceSyncedAt,
    sortIndex: row.orderingKey ?? null,
    fetchPage: row.fetchPage ?? null,
    fetchPosition: row.fetchPosition ?? null,
    links: row.links,
    mediaCount: row.mediaCount,
    linkCount: row.linkCount,
    likeCount: row.likeCount,
    repostCount: row.repostCount,
    replyCount: row.replyCount,
    quoteCount: row.quoteCount,
    bookmarkCount: row.bookmarkCount,
    viewCount: row.viewCount,
  }));
}

export async function countFeedProjections(): Promise<number> {
  const rows = await queryArchiveRows('feed');
  return rows.length;
}

export async function getFeedProjectionById(id: string): Promise<FeedProjectionItem | null> {
  const rows = await queryArchiveRows('feed', { id });
  const match = rows.find((row) => row.sourceRecordId === id || row.canonicalId === id || row.tweetId === id);
  if (!match) return null;
  return {
    id: match.sourceRecordId ?? match.canonicalId,
    tweetId: match.tweetId,
    url: match.url,
    text: match.text,
    authorHandle: match.authorHandle,
    authorName: match.authorName,
    authorProfileImageUrl: match.authorProfileImageUrl,
    postedAt: match.postedAt ?? null,
    syncedAt: match.sourceSyncedAt,
    sortIndex: match.orderingKey ?? null,
    fetchPage: match.fetchPage ?? null,
    fetchPosition: match.fetchPosition ?? null,
    links: match.links,
    mediaCount: match.mediaCount,
    linkCount: match.linkCount,
    likeCount: match.likeCount,
    repostCount: match.repostCount,
    replyCount: match.replyCount,
    quoteCount: match.quoteCount,
    bookmarkCount: match.bookmarkCount,
    viewCount: match.viewCount,
  };
}

export async function countSourceAttachments(source: ArchiveSourceKind): Promise<number> {
  const db = await openDb(twitterArchiveIndexPath());
  try {
    const rows = db.exec('SELECT COUNT(*) FROM archive_sources WHERE source = ?', [source]);
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}
