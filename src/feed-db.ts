import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { readJsonLines } from './fs.js';
import { twitterFeedCachePath, twitterFeedIndexPath } from './paths.js';
import type { FeedRecord } from './types.js';

export interface FeedTimelineItem {
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

export interface FeedTimelineFilters {
  limit?: number;
  offset?: number;
}

export interface FeedSearchResult {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  syncedAt: string;
  score: number;
}

const SCHEMA_VERSION = 2;

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

function mapTimelineRow(row: unknown[]): FeedTimelineItem {
  return {
    id: row[0] as string,
    tweetId: row[1] as string,
    url: row[2] as string,
    text: row[3] as string,
    authorHandle: (row[4] as string) ?? undefined,
    authorName: (row[5] as string) ?? undefined,
    authorProfileImageUrl: (row[6] as string) ?? undefined,
    postedAt: (row[7] as string) ?? null,
    syncedAt: row[8] as string,
    sortIndex: (row[9] as string) ?? null,
    fetchPage: row[10] as number | null,
    fetchPosition: row[11] as number | null,
    links: parseJsonArray(row[12]),
    mediaCount: Number(row[13] ?? 0),
    linkCount: Number(row[14] ?? 0),
    likeCount: row[15] as number | null,
    repostCount: row[16] as number | null,
    replyCount: row[17] as number | null,
    quoteCount: row[18] as number | null,
    bookmarkCount: row[19] as number | null,
    viewCount: row[20] as number | null,
  };
}

function feedSortClause(): string {
  return `
    ORDER BY
      COALESCE(NULLIF(f.synced_at, ''), '') DESC,
      CASE
        WHEN f.sort_index GLOB '[0-9]*' THEN CAST(f.sort_index AS INTEGER)
        ELSE -1
      END DESC,
      COALESCE(f.fetch_page, 2147483647) ASC,
      COALESCE(f.fetch_position, 2147483647) ASC,
      CAST(f.tweet_id AS INTEGER) DESC
  `;
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS feed (
    id TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL,
    url TEXT NOT NULL,
    text TEXT NOT NULL,
    author_handle TEXT,
    author_name TEXT,
    author_profile_image_url TEXT,
    posted_at TEXT,
    synced_at TEXT NOT NULL,
    sort_index TEXT,
    fetch_page INTEGER,
    fetch_position INTEGER,
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
  db.run(`CREATE INDEX IF NOT EXISTS idx_feed_synced ON feed(synced_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_feed_sort_index ON feed(sort_index)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_feed_author ON feed(author_handle)`);
  ensureFeedFts(db);
  db.run(`REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`);
}

function ensureFeedFts(db: Database): boolean {
  const existing = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='feed_fts'");
  const hadFts = Boolean(existing[0]?.values?.length);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS feed_fts USING fts5(
    text,
    author_handle,
    author_name,
    content=feed,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);
  if (!hadFts) {
    db.run(`INSERT INTO feed_fts(feed_fts) VALUES('rebuild')`);
  }
  return !hadFts;
}

function insertRecord(db: Database, record: FeedRecord): void {
  db.run(
    `INSERT OR REPLACE INTO feed VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      record.id,
      record.tweetId,
      record.url,
      record.text,
      record.authorHandle ?? null,
      record.authorName ?? null,
      record.authorProfileImageUrl ?? null,
      record.postedAt ?? null,
      record.syncedAt,
      record.sortIndex ?? null,
      record.fetchPage ?? null,
      record.fetchPosition ?? null,
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

export async function buildFeedIndex(options?: { force?: boolean }): Promise<{ dbPath: string; recordCount: number; newRecords: number }> {
  const cachePath = twitterFeedCachePath();
  const dbPath = twitterFeedIndexPath();
  const records = await readJsonLines<FeedRecord>(cachePath);
  const db = await openDb(dbPath);

  try {
    if (options?.force) {
      db.run('DROP TABLE IF EXISTS feed_fts');
      db.run('DROP TABLE IF EXISTS feed');
      db.run('DROP TABLE IF EXISTS meta');
    }

    initSchema(db);

    const existingIds = new Set<string>();
    try {
      const rows = db.exec('SELECT id FROM feed');
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

    db.run(`INSERT INTO feed_fts(feed_fts) VALUES('rebuild')`);
    saveDb(db, dbPath);
    const totalRows = db.exec('SELECT COUNT(*) FROM feed')[0]?.values[0]?.[0] as number;
    return { dbPath, recordCount: totalRows, newRecords: newRecords.length };
  } finally {
    db.close();
  }
}

export async function searchFeed(query: string, limit = 20): Promise<FeedSearchResult[]> {
  const dbPath = twitterFeedIndexPath();
  const db = await openDb(dbPath);

  try {
    if (ensureFeedFts(db)) {
      saveDb(db, dbPath);
    }
    let rows;
    try {
      rows = db.exec(
        `
          SELECT
            f.id,
            f.tweet_id,
            f.url,
            f.text,
            f.author_handle,
            f.author_name,
            f.posted_at,
            f.synced_at,
            bm25(feed_fts, 5.0, 1.0, 1.0) as score
          FROM feed f
          JOIN feed_fts ON feed_fts.rowid = f.rowid
          WHERE f.rowid IN (SELECT rowid FROM feed_fts WHERE feed_fts MATCH ?)
          ORDER BY bm25(feed_fts, 5.0, 1.0, 1.0) ASC
          LIMIT ?
        `,
        [query, limit],
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
        throw new Error(`Invalid search query: "${query}". Try simpler terms or wrap phrases in double quotes.`);
      }
      throw error;
    }

    if (!rows.length) return [];
    return rows[0].values.map((row) => ({
      id: row[0] as string,
      tweetId: row[1] as string,
      url: row[2] as string,
      text: row[3] as string,
      authorHandle: row[4] as string | undefined,
      authorName: row[5] as string | undefined,
      postedAt: row[6] as string | null,
      syncedAt: row[7] as string,
      score: row[8] as number,
    }));
  } finally {
    db.close();
  }
}

export async function listFeed(filters: FeedTimelineFilters = {}): Promise<FeedTimelineItem[]> {
  const db = await openDb(twitterFeedIndexPath());
  const limit = filters.limit ?? 30;
  const offset = filters.offset ?? 0;

  try {
    const rows = db.exec(
      `
        SELECT
          f.id,
          f.tweet_id,
          f.url,
          f.text,
          f.author_handle,
          f.author_name,
          f.author_profile_image_url,
          f.posted_at,
          f.synced_at,
          f.sort_index,
          f.fetch_page,
          f.fetch_position,
          f.links_json,
          f.media_count,
          f.link_count,
          f.like_count,
          f.repost_count,
          f.reply_count,
          f.quote_count,
          f.bookmark_count,
          f.view_count
        FROM feed f
        ${feedSortClause()}
        LIMIT ?
        OFFSET ?
      `,
      [limit, offset],
    );
    if (!rows.length) return [];
    return rows[0].values.map((row) => mapTimelineRow(row));
  } finally {
    db.close();
  }
}

export async function countFeed(): Promise<number> {
  const db = await openDb(twitterFeedIndexPath());
  try {
    const rows = db.exec('SELECT COUNT(*) FROM feed');
    return Number(rows[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}

export async function getFeedById(id: string): Promise<FeedTimelineItem | null> {
  const db = await openDb(twitterFeedIndexPath());
  try {
    const rows = db.exec(
      `SELECT
        f.id,
        f.tweet_id,
        f.url,
        f.text,
        f.author_handle,
        f.author_name,
        f.author_profile_image_url,
        f.posted_at,
        f.synced_at,
        f.sort_index,
        f.fetch_page,
        f.fetch_position,
        f.links_json,
        f.media_count,
        f.link_count,
        f.like_count,
        f.repost_count,
        f.reply_count,
        f.quote_count,
        f.bookmark_count,
        f.view_count
      FROM feed f
      WHERE f.id = ?
      LIMIT 1`,
      [id],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapTimelineRow(row) : null;
  } finally {
    db.close();
  }
}
