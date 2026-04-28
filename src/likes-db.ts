import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { parseTimestampMs, toIsoDate } from './date-utils.js';
import { readJsonLines } from './fs.js';
import { twitterLikesCachePath, twitterLikesIndexPath } from './paths.js';
import type { LikeRecord } from './types.js';
import {
  countLikeProjections,
  getLikeProjectionById,
  listLikeProjections,
  searchLikeProjections,
} from './archive-projections.js';
import { rebuildArchiveStoreFromCaches } from './archive-store.js';

export interface LikeSearchResult {
  id: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  likedAt?: string | null;
  postedAt?: string | null;
  score: number;
}

export interface LikeSearchOptions {
  query: string;
  author?: string;
  limit?: number;
  before?: string;
  after?: string;
}

export interface LikeTimelineItem {
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

export interface LikeTimelineFilters {
  query?: string;
  author?: string;
  after?: string;
  before?: string;
  sort?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

const SCHEMA_VERSION = 1;

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

function mapTimelineRow(row: unknown[]): LikeTimelineItem {
  return {
    id: row[0] as string,
    tweetId: row[1] as string,
    url: row[2] as string,
    text: row[3] as string,
    authorHandle: (row[4] as string) ?? undefined,
    authorName: (row[5] as string) ?? undefined,
    authorProfileImageUrl: (row[6] as string) ?? undefined,
    postedAt: (row[7] as string) ?? null,
    likedAt: (row[8] as string) ?? null,
    links: parseJsonArray(row[9]),
    mediaCount: Number(row[10] ?? 0),
    linkCount: Number(row[11] ?? 0),
    likeCount: row[12] as number | null,
    repostCount: row[13] as number | null,
    replyCount: row[14] as number | null,
    quoteCount: row[15] as number | null,
    bookmarkCount: row[16] as number | null,
    viewCount: row[17] as number | null,
  };
}

function buildLikeWhereClause(filters: LikeTimelineFilters): { where: string; params: Array<string | number> } {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (filters.query) {
    conditions.push(`l.rowid IN (SELECT rowid FROM likes_fts WHERE likes_fts MATCH ?)`);
    params.push(filters.query);
  }
  if (filters.author) {
    conditions.push(`l.author_handle = ? COLLATE NOCASE`);
    params.push(filters.author);
  }
  if (filters.after) {
    conditions.push(`COALESCE(l.liked_at, l.posted_at) >= ?`);
    params.push(filters.after);
  }
  if (filters.before) {
    conditions.push(`COALESCE(l.liked_at, l.posted_at) <= ?`);
    params.push(filters.before);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
  };
}

function likeSortClause(direction: 'asc' | 'desc' = 'desc'): string {
  const normalized = direction === 'asc' ? 'ASC' : 'DESC';
  return `
    ORDER BY
      COALESCE(NULLIF(l.liked_at, ''), NULLIF(l.posted_at, ''), '') ${normalized},
      CAST(l.tweet_id AS INTEGER) ${normalized}
  `;
}

function isMissingLikesIndexError(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return message.includes('no such table') || message.includes('no such column');
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS likes (
    id TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL,
    url TEXT NOT NULL,
    text TEXT NOT NULL,
    author_handle TEXT,
    author_name TEXT,
    author_profile_image_url TEXT,
    posted_at TEXT,
    liked_at TEXT,
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
    ingested_via TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_likes_author ON likes(author_handle)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_likes_posted ON likes(posted_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_likes_liked ON likes(liked_at)`);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS likes_fts USING fts5(
    text,
    author_handle,
    author_name,
    content=likes,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);
  db.run(`REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`);
}

function insertRecord(db: Database, record: LikeRecord): void {
  db.run(
    `INSERT OR REPLACE INTO likes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      record.id,
      record.tweetId,
      record.url,
      record.text,
      record.authorHandle ?? null,
      record.authorName ?? null,
      record.authorProfileImageUrl ?? null,
      record.postedAt ?? null,
      record.likedAt ?? null,
      record.syncedAt,
      record.conversationId ?? null,
      record.inReplyToStatusId ?? null,
      record.quotedStatusId ?? null,
      record.language ?? null,
      record.engagement?.likeCount ?? null,
      record.engagement?.repostCount ?? null,
      record.engagement?.replyCount ?? null,
      record.engagement?.quoteCount ?? null,
      record.engagement?.bookmarkCount ?? null,
      record.engagement?.viewCount ?? null,
      record.media?.length ?? 0,
      record.links?.length ?? 0,
      record.links?.length ? JSON.stringify(record.links) : null,
      record.tags?.length ? JSON.stringify(record.tags) : null,
      record.ingestedVia ?? null,
    ],
  );
}

export async function buildLikesIndex(options?: { force?: boolean }): Promise<{ dbPath: string; recordCount: number; newRecords: number }> {
  const cachePath = twitterLikesCachePath();
  const dbPath = twitterLikesIndexPath();
  const records = await readJsonLines<LikeRecord>(cachePath);
  const db = await openDb(dbPath);

  try {
    if (options?.force) {
      db.run('DROP TABLE IF EXISTS likes_fts');
      db.run('DROP TABLE IF EXISTS likes');
      db.run('DROP TABLE IF EXISTS meta');
    }

    initSchema(db);

    const existingIds = new Set<string>();
    try {
      const rows = db.exec('SELECT id FROM likes');
      for (const row of (rows[0]?.values ?? [])) existingIds.add(row[0] as string);
    } catch {}

    const newRecords = records.filter((record) => !existingIds.has(record.id));
    if (records.length > 0) {
      db.run('BEGIN TRANSACTION');
      try {
        for (const record of records) insertRecord(db, record);
        db.run('COMMIT');
      } catch (error) {
        db.run('ROLLBACK');
        throw error;
      }
    }

    db.run(`INSERT INTO likes_fts(likes_fts) VALUES('rebuild')`);
    saveDb(db, dbPath);
    const totalRows = db.exec('SELECT COUNT(*) FROM likes')[0]?.values[0]?.[0] as number;
    await rebuildArchiveStoreFromCaches({ buildIndex: true, forceIndex: options?.force ?? false });
    return { dbPath, recordCount: totalRows, newRecords: newRecords.length };
  } finally {
    db.close();
  }
}

export async function searchLikes(options: LikeSearchOptions): Promise<LikeSearchResult[]> {
  const dbPath = twitterLikesIndexPath();
  const db = await openDb(dbPath);

  try {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    const limit = options.limit ?? 20;

    if (options.query) {
      conditions.push(`l.rowid IN (SELECT rowid FROM likes_fts WHERE likes_fts MATCH ?)`);
      params.push(options.query);
    }
    if (options.author) {
      conditions.push(`l.author_handle = ? COLLATE NOCASE`);
      params.push(options.author);
    }
    if (options.after) {
      conditions.push(`COALESCE(l.liked_at, l.posted_at) >= ?`);
      params.push(options.after);
    }
    if (options.before) {
      conditions.push(`COALESCE(l.liked_at, l.posted_at) <= ?`);
      params.push(options.before);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let rows;
    try {
      rows = db.exec(
        `
          SELECT
            l.id,
            l.url,
            l.text,
            l.author_handle,
            l.author_name,
            l.liked_at,
            l.posted_at,
            ${options.query ? 'bm25(likes_fts, 5.0, 1.0, 1.0)' : '0'} as score
          FROM likes l
          ${options.query ? 'JOIN likes_fts ON likes_fts.rowid = l.rowid' : ''}
          ${where}
          ${options.query
            ? 'ORDER BY bm25(likes_fts, 5.0, 1.0, 1.0) ASC'
            : likeSortClause('desc')}
          LIMIT ?
        `,
        [...params, limit],
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
        throw new Error(`Invalid search query: "${options.query}". Try simpler terms or wrap phrases in double quotes.`);
      }
      if (isMissingLikesIndexError(error)) {
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
      likedAt: (row[5] as string) ?? null,
      postedAt: (row[6] as string) ?? null,
      score: Number(row[7] ?? 0),
    }));
  } catch (error) {
    if (!isMissingLikesIndexError(error)) throw error;
    const rows = await searchLikeProjections(options);
    return rows.map((row) => ({
      id: row.id,
      url: row.url,
      text: row.text,
      authorHandle: row.authorHandle,
      authorName: row.authorName,
      likedAt: row.sourceTimestamp ?? null,
      postedAt: row.postedAt ?? null,
      score: row.score,
    }));
  } finally {
    db.close();
  }
}

export async function listLikes(filters: LikeTimelineFilters = {}): Promise<LikeTimelineItem[]> {
  const dbPath = twitterLikesIndexPath();
  const db = await openDb(dbPath);

  try {
    const { where, params } = buildLikeWhereClause(filters);
    const rows = db.exec(
      `
        SELECT
          l.id,
          l.tweet_id,
          l.url,
          l.text,
          l.author_handle,
          l.author_name,
          l.author_profile_image_url,
          l.posted_at,
          l.liked_at,
          l.links_json,
          l.media_count,
          l.link_count,
          l.like_count,
          l.repost_count,
          l.reply_count,
          l.quote_count,
          l.bookmark_count,
          l.view_count
        FROM likes l
        ${where}
        ${likeSortClause(filters.sort)}
        LIMIT ?
        OFFSET ?
      `,
      [...params, filters.limit ?? 30, filters.offset ?? 0],
    );
    return (rows[0]?.values ?? []).map((row) => mapTimelineRow(row));
  } catch (error) {
    if (!isMissingLikesIndexError(error)) throw error;
    return listLikeProjections(filters);
  } finally {
    db.close();
  }
}

export async function countLikes(filters: LikeTimelineFilters = {}): Promise<number> {
  const dbPath = twitterLikesIndexPath();
  const db = await openDb(dbPath);

  try {
    const { where, params } = buildLikeWhereClause(filters);
    const rows = db.exec(
      `SELECT COUNT(*) FROM likes l ${where}`,
      params,
    );
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } catch (error) {
    if (!isMissingLikesIndexError(error)) throw error;
    return countLikeProjections(filters);
  } finally {
    db.close();
  }
}

export async function getLikeById(id: string): Promise<LikeTimelineItem | null> {
  const dbPath = twitterLikesIndexPath();
  const db = await openDb(dbPath);

  try {
    const rows = db.exec(
      `
        SELECT
          l.id,
          l.tweet_id,
          l.url,
          l.text,
          l.author_handle,
          l.author_name,
          l.author_profile_image_url,
          l.posted_at,
          l.liked_at,
          l.links_json,
          l.media_count,
          l.link_count,
          l.like_count,
          l.repost_count,
          l.reply_count,
          l.quote_count,
          l.bookmark_count,
          l.view_count
        FROM likes l
        WHERE l.id = ? OR l.tweet_id = ?
        LIMIT 1
      `,
      [id, id],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapTimelineRow(row) : null;
  } catch (error) {
    if (!isMissingLikesIndexError(error)) throw error;
    return getLikeProjectionById(id);
  } finally {
    db.close();
  }
}

export async function getLikeStats(): Promise<{
  totalLikes: number;
  uniqueAuthors: number;
  dateRange: { earliest: string | null; latest: string | null };
  topAuthors: { handle: string; count: number }[];
  languageBreakdown: { language: string; count: number }[];
}> {
  const dbPath = twitterLikesIndexPath();
  const db = await openDb(dbPath);

  try {
    const total = db.exec('SELECT COUNT(*) FROM likes')[0]?.values[0]?.[0] as number;
    const authors = db.exec('SELECT COUNT(DISTINCT author_handle) FROM likes')[0]?.values[0]?.[0] as number;
    const likedAtRows = db.exec('SELECT COALESCE(liked_at, posted_at) FROM likes WHERE liked_at IS NOT NULL OR posted_at IS NOT NULL');
    const range = chronologicalDateRange(
      (likedAtRows[0]?.values ?? []).map((row) => row[0]),
    );

    const topAuthorsRows = db.exec(
      `SELECT author_handle, COUNT(*) as c FROM likes
       WHERE author_handle IS NOT NULL
       GROUP BY author_handle ORDER BY c DESC LIMIT 15`,
    );
    const topAuthors = (topAuthorsRows[0]?.values ?? []).map((row) => ({
      handle: row[0] as string,
      count: row[1] as number,
    }));

    const langRows = db.exec(
      `SELECT language, COUNT(*) as c FROM likes
       WHERE language IS NOT NULL
       GROUP BY language ORDER BY c DESC LIMIT 10`,
    );
    const languageBreakdown = (langRows[0]?.values ?? []).map((row) => ({
      language: row[0] as string,
      count: row[1] as number,
    }));

    return {
      totalLikes: total,
      uniqueAuthors: authors,
      dateRange: range,
      topAuthors,
      languageBreakdown,
    };
  } finally {
    db.close();
  }
}

export function formatLikeSearchResults(results: LikeSearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((result, index) => {
      const author = result.authorHandle ? `@${result.authorHandle}` : 'unknown';
      const date = (result.likedAt ?? result.postedAt)?.slice(0, 10) ?? '?';
      const text = result.text.length > 140 ? result.text.slice(0, 140) + '...' : result.text;
      return `${index + 1}. [${date}] ${author}\n   ${text}\n   ${result.url}`;
    })
    .join('\n\n');
}
