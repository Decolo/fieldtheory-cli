import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { readJsonLines } from './fs.js';
import { twitterAccountTimelineCachePath, twitterAccountTimelineIndexPath } from './paths.js';
import type { AccountTimelineRecord } from './types.js';

export interface AccountTimelineItem {
  id: string;
  tweetId: string;
  targetUserId: string;
  targetHandle: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  syncedAt: string;
  links: string[];
  mediaCount: number;
  linkCount: number;
}

export interface AccountTimelineFilters {
  limit?: number;
  offset?: number;
}

export interface AccountTimelineSearchOptions {
  query: string;
  limit?: number;
  after?: string;
  before?: string;
}

export interface AccountTimelineSearchResult extends AccountTimelineItem {
  score: number;
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

function chronologyClause(): string {
  return `
    ORDER BY
      COALESCE(NULLIF(t.posted_at, ''), NULLIF(t.synced_at, ''), '') DESC,
      CAST(t.tweet_id AS INTEGER) DESC
  `;
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS timeline (
    id TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL,
    target_user_id TEXT NOT NULL,
    target_handle TEXT NOT NULL,
    url TEXT NOT NULL,
    text TEXT NOT NULL,
    author_handle TEXT,
    author_name TEXT,
    posted_at TEXT,
    synced_at TEXT NOT NULL,
    media_count INTEGER DEFAULT 0,
    link_count INTEGER DEFAULT 0,
    links_json TEXT,
    ingested_via TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_timeline_posted ON timeline(posted_at)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_timeline_synced ON timeline(synced_at)`);
  ensureTimelineFts(db);
}

function ensureTimelineFts(db: Database): boolean {
  const existing = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='timeline_fts'");
  const hadFts = Boolean(existing[0]?.values?.length);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS timeline_fts USING fts5(
    text,
    author_handle,
    author_name,
    content=timeline,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);
  if (!hadFts) db.run(`INSERT INTO timeline_fts(timeline_fts) VALUES('rebuild')`);
  return !hadFts;
}

function insertRecord(db: Database, record: AccountTimelineRecord): void {
  db.run(
    `INSERT OR REPLACE INTO timeline VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      record.id,
      record.tweetId,
      record.targetUserId,
      record.targetHandle,
      record.url,
      record.text,
      record.authorHandle ?? null,
      record.authorName ?? null,
      record.postedAt ?? null,
      record.syncedAt,
      record.media?.length ?? 0,
      record.links?.length ?? 0,
      record.links?.length ? JSON.stringify(record.links) : null,
      record.ingestedVia ?? null,
    ],
  );
}

function mapRow(row: unknown[]): AccountTimelineItem {
  return {
    id: row[0] as string,
    tweetId: row[1] as string,
    targetUserId: row[2] as string,
    targetHandle: row[3] as string,
    url: row[4] as string,
    text: row[5] as string,
    authorHandle: (row[6] as string) ?? undefined,
    authorName: (row[7] as string) ?? undefined,
    postedAt: (row[8] as string) ?? null,
    syncedAt: row[9] as string,
    mediaCount: Number(row[10] ?? 0),
    linkCount: Number(row[11] ?? 0),
    links: parseJsonArray(row[12]),
  };
}

export async function buildAccountTimelineIndex(userId: string, options?: { force?: boolean }): Promise<{ dbPath: string; recordCount: number; newRecords: number }> {
  const cachePath = twitterAccountTimelineCachePath(userId);
  const dbPath = twitterAccountTimelineIndexPath(userId);
  const records = await readJsonLines<AccountTimelineRecord>(cachePath);
  const db = await openDb(dbPath);

  try {
    if (options?.force) {
      db.run('DROP TABLE IF EXISTS timeline_fts');
      db.run('DROP TABLE IF EXISTS timeline');
    }
    initSchema(db);

    const existingIds = new Set<string>();
    try {
      const rows = db.exec('SELECT id FROM timeline');
      for (const row of rows[0]?.values ?? []) existingIds.add(row[0] as string);
    } catch {}

    db.run('BEGIN TRANSACTION');
    try {
      for (const record of records) insertRecord(db, record);
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    db.run(`INSERT INTO timeline_fts(timeline_fts) VALUES('rebuild')`);
    saveDb(db, dbPath);
    return {
      dbPath,
      recordCount: Number(db.exec('SELECT COUNT(*) FROM timeline')[0]?.values?.[0]?.[0] ?? 0),
      newRecords: records.filter((record) => !existingIds.has(record.id)).length,
    };
  } finally {
    db.close();
  }
}

function isMissingAccountTimelineIndexError(error: unknown): boolean {
  const message = (error as Error).message ?? '';
  return message.includes('no such table') || message.includes('no such column');
}

function accountTimelineDateExpression(alias: string): string {
  return `COALESCE(${alias}.posted_at, ${alias}.synced_at)`;
}

export async function searchAccountTimeline(userId: string, options: AccountTimelineSearchOptions): Promise<AccountTimelineSearchResult[]> {
  const dbPath = twitterAccountTimelineIndexPath(userId);
  const db = await openDb(dbPath);
  const limit = Math.max(1, options.limit ?? 20);
  const conditions = [`t.rowid IN (SELECT rowid FROM timeline_fts WHERE timeline_fts MATCH ?)`];
  const params: Array<string | number> = [options.query];

  if (options.after) {
    conditions.push(`${accountTimelineDateExpression('t')} >= ?`);
    params.push(options.after);
  }
  if (options.before) {
    conditions.push(`${accountTimelineDateExpression('t')} <= ?`);
    params.push(options.before);
  }

  try {
    ensureTimelineFts(db);
    const rows = db.exec(
      `SELECT
        t.id,
        t.tweet_id,
        t.target_user_id,
        t.target_handle,
        t.url,
        t.text,
        t.author_handle,
        t.author_name,
        t.posted_at,
        t.synced_at,
        t.media_count,
        t.link_count,
        t.links_json,
        bm25(timeline_fts, 5.0, 1.0, 1.0) AS score
      FROM timeline t
      JOIN timeline_fts ON timeline_fts.rowid = t.rowid
      WHERE ${conditions.join(' AND ')}
      ORDER BY bm25(timeline_fts, 5.0, 1.0, 1.0) ASC,
        ${accountTimelineDateExpression('t')} DESC,
        CAST(t.tweet_id AS INTEGER) DESC
      LIMIT ?`,
      [...params, limit],
    );
    saveDb(db, dbPath);
    return (rows[0]?.values ?? []).map((row) => ({
      ...mapRow(row),
      score: Number(row[13] ?? 0),
    }));
  } catch (error) {
    const message = (error as Error).message ?? '';
    if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
      throw new Error(`Invalid search query: "${options.query}". Try simpler terms or wrap phrases in double quotes.`);
    }
    if (!isMissingAccountTimelineIndexError(error)) throw error;
    throw new Error(`Account index not built yet. Run: ft accounts sync @${userId}`);
  } finally {
    db.close();
  }
}

export async function listAccountTimeline(userId: string, filters: AccountTimelineFilters = {}): Promise<AccountTimelineItem[]> {
  const db = await openDb(twitterAccountTimelineIndexPath(userId));
  try {
    const rows = db.exec(
      `SELECT
        t.id,
        t.tweet_id,
        t.target_user_id,
        t.target_handle,
        t.url,
        t.text,
        t.author_handle,
        t.author_name,
        t.posted_at,
        t.synced_at,
        t.media_count,
        t.link_count,
        t.links_json
      FROM timeline t
      ${chronologyClause()}
      LIMIT ?
      OFFSET ?`,
      [filters.limit ?? 30, filters.offset ?? 0],
    );
    return (rows[0]?.values ?? []).map((row) => mapRow(row));
  } finally {
    db.close();
  }
}

export async function countAccountTimeline(userId: string): Promise<number> {
  const db = await openDb(twitterAccountTimelineIndexPath(userId));
  try {
    return Number(db.exec('SELECT COUNT(*) FROM timeline')[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}

export async function getAccountTimelineById(userId: string, id: string): Promise<AccountTimelineItem | null> {
  const db = await openDb(twitterAccountTimelineIndexPath(userId));
  try {
    const rows = db.exec(
      `SELECT
        t.id,
        t.tweet_id,
        t.target_user_id,
        t.target_handle,
        t.url,
        t.text,
        t.author_handle,
        t.author_name,
        t.posted_at,
        t.synced_at,
        t.media_count,
        t.link_count,
        t.links_json
      FROM timeline t
      WHERE t.id = ?
      LIMIT 1`,
      [id],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapRow(row) : null;
  } finally {
    db.close();
  }
}
