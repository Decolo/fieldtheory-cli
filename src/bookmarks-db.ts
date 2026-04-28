import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { parseTimestampMs, toIsoDate } from './date-utils.js';
import { readJsonLines } from './fs.js';
import { twitterBookmarksCachePath, twitterBookmarksIndexPath } from './paths.js';
import type { BookmarkRecord, QuotedTweetSnapshot } from './types.js';
import {
  countBookmarkProjections,
  getBookmarkProjectionById,
  listBookmarkProjections,
  searchBookmarkProjections,
} from './archive-projections.js';
import { rebuildArchiveStoreFromCaches } from './archive-store.js';

const SCHEMA_VERSION = 5;

export interface SearchResult {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  score: number;
}

export interface SearchOptions {
  query: string;
  author?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export interface BookmarkTimelineItem {
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

export interface BookmarkTimelineFilters {
  query?: string;
  author?: string;
  after?: string;
  before?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
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

function chronologicalDateRange(values: unknown[]): { earliest: string | null; latest: string | null } {
  let earliestMs = Number.POSITIVE_INFINITY;
  let latestMs = Number.NEGATIVE_INFINITY;
  let earliest: string | null = null;
  let latest: string | null = null;

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const ms = parseTimestampMs(value);
    if (ms == null) continue;
    const isoDate = toIsoDate(value);
    if (!isoDate) continue;
    if (ms < earliestMs) {
      earliestMs = ms;
      earliest = isoDate;
    }
    if (ms > latestMs) {
      latestMs = ms;
      latest = isoDate;
    }
  }

  return { earliest, latest };
}

function mapTimelineRow(row: unknown[]): BookmarkTimelineItem {
  return {
    id: row[0] as string,
    tweetId: row[1] as string,
    url: row[2] as string,
    text: row[3] as string,
    authorHandle: (row[4] as string) ?? undefined,
    authorName: (row[5] as string) ?? undefined,
    authorProfileImageUrl: (row[6] as string) ?? undefined,
    postedAt: (row[7] as string) ?? null,
    bookmarkedAt: (row[8] as string) ?? null,
    githubUrls: parseJsonArray(row[9]),
    links: parseJsonArray(row[10]),
    mediaCount: Number(row[11] ?? 0),
    linkCount: Number(row[12] ?? 0),
    likeCount: row[13] as number | null,
    repostCount: row[14] as number | null,
    replyCount: row[15] as number | null,
    quoteCount: row[16] as number | null,
    bookmarkCount: row[17] as number | null,
    viewCount: row[18] as number | null,
  };
}

function buildBookmarkWhereClause(filters: BookmarkTimelineFilters): {
  where: string;
  params: Array<string | number>;
} {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filters.query) {
    conditions.push(`b.rowid IN (SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?)`);
    params.push(filters.query);
  }
  if (filters.author) {
    conditions.push(`b.author_handle = ? COLLATE NOCASE`);
    params.push(filters.author);
  }
  if (filters.after) {
    conditions.push(`${bookmarkDateFilterExpression('b')} >= ?`);
    params.push(filters.after);
  }
  if (filters.before) {
    conditions.push(`${bookmarkDateFilterExpression('b')} <= ?`);
    params.push(filters.before);
  }
  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function bookmarkDateFilterExpression(alias: string): string {
  return `COALESCE(${alias}.posted_at, ${alias}.bookmarked_at)`;
}

function bookmarkSortClause(direction: 'asc' | 'desc' = 'desc'): string {
  const normalized = direction === 'asc' ? 'ASC' : 'DESC';
  return `
    ORDER BY
      CASE
        WHEN b.bookmarked_at GLOB '____-__-__*' THEN b.bookmarked_at
        WHEN b.posted_at GLOB '____-__-__*' THEN b.posted_at
        ELSE ''
      END ${normalized},
      CAST(b.tweet_id AS INTEGER) ${normalized}
  `;
}

function isMissingBookmarkIndexError(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return message.includes('no such table') || message.includes('no such column');
}

function createBookmarksTable(db: Database, tableName: string): void {
  db.run(`CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL,
    url TEXT NOT NULL,
    text TEXT NOT NULL,
    author_handle TEXT,
    author_name TEXT,
    author_profile_image_url TEXT,
    posted_at TEXT,
    bookmarked_at TEXT,
    synced_at TEXT NOT NULL,
    conversation_id TEXT,
    in_reply_to_status_id TEXT,
    quoted_status_id TEXT,
    language TEXT,
    like_count INTEGER,
    repost_count INTEGER,
    reply_count INTEGER,
    quote_count INTEGER,
    bookmark_count INTEGER,
    view_count INTEGER,
    media_count INTEGER DEFAULT 0,
    link_count INTEGER DEFAULT 0,
    links_json TEXT,
    tags_json TEXT,
    ingested_via TEXT,
    github_urls TEXT,
    quoted_tweet_json TEXT
  )`);
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  createBookmarksTable(db, 'bookmarks');

  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_author ON bookmarks(author_handle)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_posted ON bookmarks(posted_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_bookmarks_language ON bookmarks(language)`);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS bookmarks_fts USING fts5(
    text,
    author_handle,
    author_name,
    content=bookmarks,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);

  db.run(`REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`);
}

function tableExists(db: Database, tableName: string): boolean {
  const rows = db.exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName],
  );
  return Boolean(rows[0]?.values.length);
}

function tableColumns(db: Database, tableName: string): Set<string> {
  const rows = db.exec(`PRAGMA table_info(${tableName})`);
  return new Set((rows[0]?.values ?? []).map((row) => String(row[1])));
}

function selectColumnOrNull(columns: Set<string>, columnName: string): string {
  return columns.has(columnName) ? columnName : `NULL AS ${columnName}`;
}

function migrateBookmarksSchemaV5(db: Database): void {
  const columns = tableColumns(db, 'bookmarks');
  const targetColumns = [
    'id',
    'tweet_id',
    'url',
    'text',
    'author_handle',
    'author_name',
    'author_profile_image_url',
    'posted_at',
    'bookmarked_at',
    'synced_at',
    'conversation_id',
    'in_reply_to_status_id',
    'quoted_status_id',
    'language',
    'like_count',
    'repost_count',
    'reply_count',
    'quote_count',
    'bookmark_count',
    'view_count',
    'media_count',
    'link_count',
    'links_json',
    'tags_json',
    'ingested_via',
    'github_urls',
    'quoted_tweet_json',
  ];
  const selectColumns = targetColumns.map((columnName) => selectColumnOrNull(columns, columnName));

  db.run('DROP TABLE IF EXISTS bookmarks_fts');
  db.run('DROP TABLE IF EXISTS bookmarks_v5');
  createBookmarksTable(db, 'bookmarks_v5');
  db.run(
    `INSERT INTO bookmarks_v5 (${targetColumns.join(', ')})
     SELECT ${selectColumns.join(', ')} FROM bookmarks`,
  );
  db.run('DROP TABLE bookmarks');
  db.run('ALTER TABLE bookmarks_v5 RENAME TO bookmarks');
}

function ensureMigrations(db: Database): void {
  db.run('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)');
  const rows = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
  const version = rows.length ? Number(rows[0].values[0]?.[0] ?? 0) : 0;
  const hasBookmarks = tableExists(db, 'bookmarks');
  const hasLegacyColumns = hasBookmarks
    ? ['categories', 'primary_category', 'domains', 'primary_domain'].some((column) => tableColumns(db, 'bookmarks').has(column))
    : false;

  if (hasBookmarks && (version < 5 || hasLegacyColumns)) {
    migrateBookmarksSchemaV5(db);
    initSchema(db);
    db.run(`INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild')`);
    saveDb(db, twitterBookmarksIndexPath());
  }

  if (version < SCHEMA_VERSION || hasLegacyColumns) {
    db.run(`REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`);
  }
}

interface PreservedBookmarkFields {
  githubUrls: string | null;
  quotedTweetJson: string | null;
}

function insertRecord(db: Database, r: BookmarkRecord, preserved?: PreservedBookmarkFields): void {
  // Extract GitHub URLs (kept inline — no LLM needed for URL parsing)
  const text = r.text ?? '';
  const githubMatches = text.match(/github\.com\/[\w.-]+\/[\w.-]+/gi) ?? [];
  const githubFromLinks = (r.links ?? []).filter((l) => /github\.com/i.test(l));
  const githubUrls = [...new Set([...githubMatches.map((m) => `https://${m}`), ...githubFromLinks])];

  db.run(
    `INSERT OR REPLACE INTO bookmarks (
      id, tweet_id, url, text, author_handle, author_name, author_profile_image_url,
      posted_at, bookmarked_at, synced_at, conversation_id, in_reply_to_status_id,
      quoted_status_id, language, like_count, repost_count, reply_count, quote_count,
      bookmark_count, view_count, media_count, link_count, links_json, tags_json,
      ingested_via, github_urls, quoted_tweet_json
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      r.id,
      r.tweetId,
      r.url,
      r.text,
      r.authorHandle ?? null,
      r.authorName ?? null,
      r.authorProfileImageUrl ?? null,
      r.postedAt ?? null,
      r.bookmarkedAt ?? null,
      r.syncedAt,
      r.conversationId ?? null,
      r.inReplyToStatusId ?? null,
      r.quotedStatusId ?? null,
      r.language ?? null,
      r.engagement?.likeCount ?? null,
      r.engagement?.repostCount ?? null,
      r.engagement?.replyCount ?? null,
      r.engagement?.quoteCount ?? null,
      r.engagement?.bookmarkCount ?? null,
      r.engagement?.viewCount ?? null,
      r.media?.length ?? 0,
      r.links?.length ?? 0,
      r.links?.length ? JSON.stringify(r.links) : null,
      r.tags?.length ? JSON.stringify(r.tags) : null,
      r.ingestedVia ?? null,
      preserved?.githubUrls ?? (githubUrls.length ? JSON.stringify(githubUrls) : null),
      r.quotedTweet ? JSON.stringify(r.quotedTweet) : (preserved?.quotedTweetJson ?? null),
    ]
  );
}

export async function buildIndex(options?: { force?: boolean }): Promise<{ dbPath: string; recordCount: number; newRecords: number }> {
  const cachePath = twitterBookmarksCachePath();
  const dbPath = twitterBookmarksIndexPath();
  const records = await readJsonLines<BookmarkRecord>(cachePath);

  const db = await openDb(dbPath);
  try {
    if (options?.force) {
      db.run('DROP TABLE IF EXISTS bookmarks_fts');
      db.run('DROP TABLE IF EXISTS bookmarks');
      db.run('DROP TABLE IF EXISTS meta');
    }

    initSchema(db);
    ensureMigrations(db);

    // Preserve local enrichment fields when refreshing existing rows.
    const existingRows = new Map<string, PreservedBookmarkFields>();
    try {
      const rows = db.exec(
        `SELECT id, github_urls, quoted_tweet_json
         FROM bookmarks`
      );
      for (const r of (rows[0]?.values ?? [])) {
        existingRows.set(r[0] as string, {
          githubUrls: (r[1] as string) ?? null,
          quotedTweetJson: (r[2] as string) ?? null,
        });
      }
    } catch { /* table may be empty */ }

    const newRecords: BookmarkRecord[] = records.filter(r => !existingRows.has(r.id));

    if (records.length > 0) {
      db.run('BEGIN TRANSACTION');
      try {
        for (const record of records) {
          insertRecord(db, record, existingRows.get(record.id));
        }
        db.run('COMMIT');
      } catch (err) {
        db.run('ROLLBACK');
        throw err;
      }
    }

    // Rebuild FTS index from content table
    db.run(`INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild')`);

    saveDb(db, dbPath);
    const totalRows = db.exec('SELECT COUNT(*) FROM bookmarks')[0]?.values[0]?.[0] as number;
    await rebuildArchiveStoreFromCaches({ buildIndex: true, forceIndex: options?.force ?? false });
    return { dbPath, recordCount: totalRows, newRecords: newRecords.length };
  } finally {
    db.close();
  }
}

export async function searchBookmarks(options: SearchOptions): Promise<SearchResult[]> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    ensureMigrations(db);
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    const limit = options.limit ?? 20;

    if (options.query) {
      conditions.push(`b.rowid IN (SELECT rowid FROM bookmarks_fts WHERE bookmarks_fts MATCH ?)`);
      params.push(options.query);
    }
    if (options.author) {
      conditions.push(`b.author_handle = ? COLLATE NOCASE`);
      params.push(options.author);
    }
    if (options.after) {
      conditions.push(`${bookmarkDateFilterExpression('b')} >= ?`);
      params.push(options.after);
    }
    if (options.before) {
      conditions.push(`${bookmarkDateFilterExpression('b')} <= ?`);
      params.push(options.before);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let rows;
    try {
      rows = db.exec(
        `
          SELECT
            b.id,
            b.url,
            b.text,
            b.author_handle,
            b.author_name,
            b.posted_at,
            ${options.query ? 'bm25(bookmarks_fts, 5.0, 1.0, 1.0)' : '0'} as score
          FROM bookmarks b
          ${options.query ? 'JOIN bookmarks_fts ON bookmarks_fts.rowid = b.rowid' : ''}
          ${where}
          ${options.query
            ? 'ORDER BY bm25(bookmarks_fts, 5.0, 1.0, 1.0) ASC'
            : bookmarkSortClause('desc')}
          LIMIT ?
        `,
        [...params, limit],
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
        throw new Error(`Invalid search query: "${options.query}". Try simpler terms or wrap phrases in double quotes.`);
      }
      if (isMissingBookmarkIndexError(error)) {
        throw error;
      }
      throw error;
    }

    return (rows[0]?.values ?? []).map((row) => ({
      id: String(row[0]),
      url: String(row[1]),
      text: String(row[2] ?? ''),
      authorHandle: (row[3] as string) ?? undefined,
      authorName: (row[4] as string) ?? undefined,
      postedAt: (row[5] as string) ?? null,
      score: Number(row[6] ?? 0),
    }));
  } catch (error) {
    if (!isMissingBookmarkIndexError(error)) throw error;
    const rows = await searchBookmarkProjections(options);
    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      text: row.text,
      authorHandle: row.authorHandle,
      authorName: row.authorName,
      postedAt: row.postedAt ?? null,
      score: row.score,
    }));
  } finally {
    db.close();
  }
}

export async function listBookmarks(
  filters: BookmarkTimelineFilters = {},
): Promise<BookmarkTimelineItem[]> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    ensureMigrations(db);
    const { where, params } = buildBookmarkWhereClause(filters);
    const rows = db.exec(
      `
        SELECT
          b.id,
          b.tweet_id,
          b.url,
          b.text,
          b.author_handle,
          b.author_name,
          b.author_profile_image_url,
          b.posted_at,
          b.bookmarked_at,
          b.github_urls,
          b.links_json,
          b.media_count,
          b.link_count,
          b.like_count,
          b.repost_count,
          b.reply_count,
          b.quote_count,
          b.bookmark_count,
          b.view_count
        FROM bookmarks b
        ${where}
        ${bookmarkSortClause(filters.sort)}
        LIMIT ?
        OFFSET ?
      `,
      [...params, filters.limit ?? 30, filters.offset ?? 0],
    );
    return (rows[0]?.values ?? []).map((row) => mapTimelineRow(row));
  } catch (error) {
    if (!isMissingBookmarkIndexError(error)) throw error;
    return listBookmarkProjections(filters);
  } finally {
    db.close();
  }
}

export async function countBookmarks(
  filters: BookmarkTimelineFilters = {},
): Promise<number> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    ensureMigrations(db);
    const { where, params } = buildBookmarkWhereClause(filters);
    const rows = db.exec(
      `SELECT COUNT(*) FROM bookmarks b ${where}`,
      params,
    );
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } catch (error) {
    if (!isMissingBookmarkIndexError(error)) throw error;
    return countBookmarkProjections(filters);
  } finally {
    db.close();
  }
}

export async function exportBookmarksForSyncSeed(): Promise<BookmarkRecord[]> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  ensureMigrations(db);

  try {
    const sql = `
      SELECT
        b.id,
        b.tweet_id,
        b.url,
        b.text,
        b.author_handle,
        b.author_name,
        b.author_profile_image_url,
        b.posted_at,
        b.bookmarked_at,
        b.synced_at,
        b.conversation_id,
        b.in_reply_to_status_id,
        b.quoted_status_id,
        b.language,
        b.like_count,
        b.repost_count,
        b.reply_count,
        b.quote_count,
        b.bookmark_count,
        b.view_count,
        b.links_json
      FROM bookmarks b
      ${bookmarkSortClause('desc')}
    `;
    const rows = db.exec(sql);
    if (!rows.length) return [];

    return rows[0].values.map((row) => ({
      id: String(row[0]),
      tweetId: String(row[1]),
      url: String(row[2]),
      text: String(row[3] ?? ''),
      authorHandle: (row[4] as string) ?? undefined,
      authorName: (row[5] as string) ?? undefined,
      authorProfileImageUrl: (row[6] as string) ?? undefined,
      postedAt: (row[7] as string) ?? null,
      bookmarkedAt: (row[8] as string) ?? null,
      syncedAt: String(row[9] ?? row[8] ?? row[7] ?? new Date(0).toISOString()),
      conversationId: (row[10] as string) ?? undefined,
      inReplyToStatusId: (row[11] as string) ?? undefined,
      quotedStatusId: (row[12] as string) ?? undefined,
      language: (row[13] as string) ?? undefined,
      engagement: {
        likeCount: row[14] as number | undefined,
        repostCount: row[15] as number | undefined,
        replyCount: row[16] as number | undefined,
        quoteCount: row[17] as number | undefined,
        bookmarkCount: row[18] as number | undefined,
        viewCount: row[19] as number | undefined,
      },
      links: parseJsonArray(row[20]),
      tags: [],
      ingestedVia: 'graphql',
    }));
  } finally {
    db.close();
  }
}

export async function getBookmarkById(id: string): Promise<BookmarkTimelineItem | null> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    ensureMigrations(db);
    const rows = db.exec(
      `
        SELECT
          b.id,
          b.tweet_id,
          b.url,
          b.text,
          b.author_handle,
          b.author_name,
          b.author_profile_image_url,
          b.posted_at,
          b.bookmarked_at,
          b.github_urls,
          b.links_json,
          b.media_count,
          b.link_count,
          b.like_count,
          b.repost_count,
          b.reply_count,
          b.quote_count,
          b.bookmark_count,
          b.view_count
        FROM bookmarks b
        WHERE b.id = ? OR b.tweet_id = ?
        LIMIT 1
      `,
      [id, id],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapTimelineRow(row) : null;
  } catch (error) {
    if (!isMissingBookmarkIndexError(error)) throw error;
    return getBookmarkProjectionById(id);
  } finally {
    db.close();
  }
}

export async function getStats(): Promise<{
  totalBookmarks: number;
  uniqueAuthors: number;
  dateRange: { earliest: string | null; latest: string | null };
  topAuthors: { handle: string; count: number }[];
  languageBreakdown: { language: string; count: number }[];
}> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);

  try {
    const total = db.exec('SELECT COUNT(*) FROM bookmarks')[0]?.values[0]?.[0] as number;
    const authors = db.exec('SELECT COUNT(DISTINCT author_handle) FROM bookmarks')[0]?.values[0]?.[0] as number;
    const postedAtRows = db.exec('SELECT posted_at FROM bookmarks WHERE posted_at IS NOT NULL');
    const range = chronologicalDateRange(
      (postedAtRows[0]?.values ?? []).map((row) => row[0])
    );

    const topAuthorsRows = db.exec(
      `SELECT author_handle, COUNT(*) as c FROM bookmarks
       WHERE author_handle IS NOT NULL
       GROUP BY author_handle ORDER BY c DESC LIMIT 15`
    );
    const topAuthors = (topAuthorsRows[0]?.values ?? []).map((r) => ({
      handle: r[0] as string,
      count: r[1] as number,
    }));

    const langRows = db.exec(
      `SELECT language, COUNT(*) as c FROM bookmarks
       WHERE language IS NOT NULL
       GROUP BY language ORDER BY c DESC LIMIT 10`
    );
    const languageBreakdown = (langRows[0]?.values ?? []).map((r) => ({
      language: r[0] as string,
      count: r[1] as number,
    }));

    return {
      totalBookmarks: total,
      uniqueAuthors: authors,
      dateRange: range,
      topAuthors,
      languageBreakdown,
    };
  } finally {
    db.close();
  }
}

export interface BookmarkSample {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  githubUrls?: string;
  links?: string;
}

export async function sampleByAuthor(
  authorHandle: string,
  limit: number,
  existingDb?: Database,
): Promise<BookmarkSample[]> {
  const db = existingDb ?? await openDb(twitterBookmarksIndexPath());
  if (!existingDb) ensureMigrations(db);
  try {
    const rows = db.exec(
      `SELECT id, url, text, author_handle, github_urls, links_json
       FROM bookmarks
       WHERE author_handle = ? COLLATE NOCASE
       ORDER BY COALESCE(posted_at, bookmarked_at) DESC
       LIMIT ?`,
      [authorHandle, limit]
    );
    if (!rows.length) return [];
    return rows[0].values.map((r: any) => ({
      id: r[0] as string,
      url: r[1] as string,
      text: r[2] as string,
      authorHandle: (r[3] as string) ?? undefined,
      githubUrls: (r[4] as string) ?? undefined,
      links: (r[5] as string) ?? undefined,
    }));
  } finally {
    if (!existingDb) db.close();
  }
}

export async function getTopAuthorHandles(
  minCount: number,
  existingDb?: Database,
): Promise<{ handle: string; count: number }[]> {
  const db = existingDb ?? await openDb(twitterBookmarksIndexPath());
  if (!existingDb) ensureMigrations(db);
  try {
    const rows = db.exec(
      `SELECT author_handle, COUNT(*) as c FROM bookmarks
       WHERE author_handle IS NOT NULL
       GROUP BY author_handle
       HAVING c >= ?
       ORDER BY c DESC`,
      [minCount]
    );
    return (rows[0]?.values ?? []).map((r: any) => ({
      handle: r[0] as string,
      count: r[1] as number,
    }));
  } finally {
    if (!existingDb) db.close();
  }
}

/**
 * Open the bookmarks DB with migrations applied. Caller is responsible for
 * closing the handle.
 */
export async function openBookmarksDb(): Promise<Database> {
  const db = await openDb(twitterBookmarksIndexPath());
  ensureMigrations(db);
  return db;
}

export { type Database } from 'sql.js';

// ── Gap-fill helpers ────────────────────────────────────────────────────

export async function updateQuotedTweets(
  records: Array<{ id: string; quotedTweet: QuotedTweetSnapshot }>,
): Promise<void> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  ensureMigrations(db);

  try {
    const stmt = db.prepare('UPDATE bookmarks SET quoted_tweet_json = ? WHERE id = ?');
    for (const record of records) {
      stmt.run([JSON.stringify(record.quotedTweet), record.id]);
    }
    stmt.free();
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
}

export async function updateBookmarkText(
  records: Array<{ id: string; text: string }>,
): Promise<void> {
  const dbPath = twitterBookmarksIndexPath();
  const db = await openDb(dbPath);
  ensureMigrations(db);

  try {
    const stmt = db.prepare('UPDATE bookmarks SET text = ? WHERE id = ?');
    for (const record of records) {
      stmt.run([record.text, record.id]);
    }
    stmt.free();
    // Rebuild FTS to reflect updated text
    db.run("INSERT INTO bookmarks_fts(bookmarks_fts) VALUES('rebuild')");
    saveDb(db, dbPath);
  } finally {
    db.close();
  }
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((r, i) => {
      const author = r.authorHandle ? `@${r.authorHandle}` : 'unknown';
      const date = r.postedAt ? r.postedAt.slice(0, 10) : '?';
      const text = r.text.length > 140 ? r.text.slice(0, 140) + '...' : r.text;
      return `${i + 1}. [${date}] ${author}\n   ${text}\n   ${r.url}`;
    })
    .join('\n\n');
}
