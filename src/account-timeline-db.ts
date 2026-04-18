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
    if (options?.force) db.run('DROP TABLE IF EXISTS timeline');
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
