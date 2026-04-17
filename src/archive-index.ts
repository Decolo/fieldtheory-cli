import type { Database } from 'sql.js';
import { openDb, runInTransaction, saveDb } from './db.js';
import { twitterArchiveCachePath, twitterArchiveIndexPath } from './paths.js';
import { readJsonLines } from './fs.js';
import type { ArchiveItem, ArchiveSourceKind } from './types.js';

const SCHEMA_VERSION = 1;

export interface ArchiveIndexBuildResult {
  dbPath: string;
  recordCount: number;
  newRecords: number;
}

export interface ArchiveIndexedItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  normalizedText?: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  syncedAt: string;
  sourceCount: number;
  sources: ArchiveSourceKind[];
}

export interface ArchiveIndexedSourceAttachment {
  itemId: string;
  tweetId: string;
  source: ArchiveSourceKind;
  sourceTimestamp?: string | null;
  orderingKey?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
  syncedAt: string;
  ingestedVia?: string | null;
  metadata?: Record<string, unknown>;
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

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)`);
  db.run(`CREATE TABLE IF NOT EXISTS archive_items (
    id TEXT PRIMARY KEY,
    tweet_id TEXT NOT NULL UNIQUE,
    url TEXT NOT NULL,
    text TEXT NOT NULL,
    normalized_text TEXT,
    author_handle TEXT,
    author_name TEXT,
    author_profile_image_url TEXT,
    posted_at TEXT,
    synced_at TEXT NOT NULL,
    source_count INTEGER NOT NULL,
    sources_json TEXT NOT NULL,
    media_count INTEGER DEFAULT 0,
    link_count INTEGER DEFAULT 0,
    links_json TEXT,
    like_count INTEGER,
    repost_count INTEGER,
    reply_count INTEGER,
    quote_count INTEGER,
    bookmark_count INTEGER,
    view_count INTEGER
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_archive_items_tweet_id ON archive_items(tweet_id)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_archive_items_synced_at ON archive_items(synced_at)`);
  db.run(`CREATE TABLE IF NOT EXISTS archive_sources (
    item_id TEXT NOT NULL,
    tweet_id TEXT NOT NULL,
    source TEXT NOT NULL,
    source_timestamp TEXT,
    ordering_key TEXT,
    fetch_page INTEGER,
    fetch_position INTEGER,
    synced_at TEXT NOT NULL,
    ingested_via TEXT,
    metadata_json TEXT,
    PRIMARY KEY (tweet_id, source)
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_archive_sources_source ON archive_sources(source)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_archive_sources_item_id ON archive_sources(item_id)`);
  db.run(`CREATE VIRTUAL TABLE IF NOT EXISTS archive_items_fts USING fts5(
    text,
    normalized_text,
    author_handle,
    author_name,
    content=archive_items,
    content_rowid=rowid,
    tokenize='porter unicode61'
  )`);
  db.run(`REPLACE INTO meta VALUES ('schema_version', '${SCHEMA_VERSION}')`);
}

function sourceKinds(item: ArchiveItem): ArchiveSourceKind[] {
  const kinds: ArchiveSourceKind[] = [];
  if (item.sourceAttachments.bookmark) kinds.push('bookmark');
  if (item.sourceAttachments.like) kinds.push('like');
  if (item.sourceAttachments.feed) kinds.push('feed');
  return kinds;
}

function mediaCount(item: ArchiveItem): number {
  return Math.max(item.media?.length ?? 0, item.mediaObjects?.length ?? 0);
}

function insertArchiveItem(db: Database, item: ArchiveItem): void {
  const sources = sourceKinds(item);
  db.run(
    `INSERT OR REPLACE INTO archive_items VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      item.id,
      item.tweetId,
      item.url,
      item.text,
      item.normalizedText ?? null,
      item.authorHandle ?? null,
      item.authorName ?? null,
      item.authorProfileImageUrl ?? null,
      item.postedAt ?? null,
      item.syncedAt,
      sources.length,
      JSON.stringify(sources),
      mediaCount(item),
      item.links?.length ?? 0,
      item.links?.length ? JSON.stringify(item.links) : null,
      item.engagement?.likeCount ?? null,
      item.engagement?.repostCount ?? null,
      item.engagement?.replyCount ?? null,
      item.engagement?.quoteCount ?? null,
      item.engagement?.bookmarkCount ?? null,
      item.engagement?.viewCount ?? null,
    ],
  );
}

function insertArchiveAttachments(db: Database, item: ArchiveItem): void {
  for (const source of sourceKinds(item)) {
    const attachment = item.sourceAttachments[source];
    if (!attachment) continue;
    db.run(
      `INSERT OR REPLACE INTO archive_sources VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [
        item.id,
        item.tweetId,
        source,
        attachment.sourceTimestamp ?? null,
        attachment.orderingKey ?? null,
        attachment.fetchPage ?? null,
        attachment.fetchPosition ?? null,
        attachment.syncedAt,
        attachment.ingestedVia ?? null,
        attachment.metadata ? JSON.stringify(attachment.metadata) : null,
      ],
    );
  }
}

export async function buildArchiveIndex(options?: { force?: boolean }): Promise<ArchiveIndexBuildResult> {
  const dbPath = twitterArchiveIndexPath();
  const items = await readJsonLines<ArchiveItem>(twitterArchiveCachePath());
  const db = await openDb(dbPath);

  try {
    if (options?.force) {
      db.run('DROP TABLE IF EXISTS archive_items_fts');
      db.run('DROP TABLE IF EXISTS archive_sources');
      db.run('DROP TABLE IF EXISTS archive_items');
      db.run('DROP TABLE IF EXISTS meta');
    }

    initSchema(db);

    const existingTweetIds = new Set<string>();
    try {
      const rows = db.exec('SELECT tweet_id FROM archive_items');
      for (const row of (rows[0]?.values ?? [])) existingTweetIds.add(String(row[0]));
    } catch {}

    runInTransaction(db, () => {
      db.run('DELETE FROM archive_sources');
      db.run('DELETE FROM archive_items');
      for (const item of items) {
        insertArchiveItem(db, item);
        insertArchiveAttachments(db, item);
      }
    });

    db.run(`INSERT INTO archive_items_fts(archive_items_fts) VALUES('rebuild')`);
    saveDb(db, dbPath);

    return {
      dbPath,
      recordCount: Number(db.exec('SELECT COUNT(*) FROM archive_items')[0]?.values?.[0]?.[0] ?? 0),
      newRecords: items.filter((item) => !existingTweetIds.has(item.tweetId)).length,
    };
  } finally {
    db.close();
  }
}

export async function countArchiveItems(): Promise<number> {
  const db = await openDb(twitterArchiveIndexPath());
  try {
    return Number(db.exec('SELECT COUNT(*) FROM archive_items')[0]?.values?.[0]?.[0] ?? 0);
  } finally {
    db.close();
  }
}

export async function getArchiveItemByTweetId(tweetId: string): Promise<ArchiveIndexedItem | null> {
  const db = await openDb(twitterArchiveIndexPath());
  try {
    const rows = db.exec(
      `SELECT
        id,
        tweet_id,
        url,
        text,
        normalized_text,
        author_handle,
        author_name,
        posted_at,
        synced_at,
        source_count,
        sources_json
      FROM archive_items
      WHERE tweet_id = ?
      LIMIT 1`,
      [tweetId],
    );
    const row = rows[0]?.values?.[0];
    if (!row) return null;
    return {
      id: String(row[0]),
      tweetId: String(row[1]),
      url: String(row[2]),
      text: String(row[3]),
      normalizedText: (row[4] as string) ?? undefined,
      authorHandle: (row[5] as string) ?? undefined,
      authorName: (row[6] as string) ?? undefined,
      postedAt: (row[7] as string) ?? null,
      syncedAt: String(row[8]),
      sourceCount: Number(row[9] ?? 0),
      sources: parseJsonArray(row[10]) as ArchiveSourceKind[],
    };
  } finally {
    db.close();
  }
}

export async function listArchiveSources(tweetId: string): Promise<ArchiveIndexedSourceAttachment[]> {
  const db = await openDb(twitterArchiveIndexPath());
  try {
    const rows = db.exec(
      `SELECT
        item_id,
        tweet_id,
        source,
        source_timestamp,
        ordering_key,
        fetch_page,
        fetch_position,
        synced_at,
        ingested_via,
        metadata_json
      FROM archive_sources
      WHERE tweet_id = ?
      ORDER BY source ASC`,
      [tweetId],
    );

    return (rows[0]?.values ?? []).map((row) => ({
      itemId: String(row[0]),
      tweetId: String(row[1]),
      source: row[2] as ArchiveSourceKind,
      sourceTimestamp: (row[3] as string) ?? null,
      orderingKey: (row[4] as string) ?? null,
      fetchPage: row[5] as number | null,
      fetchPosition: row[6] as number | null,
      syncedAt: String(row[7]),
      ingestedVia: (row[8] as string) ?? null,
      metadata: parseMetadata(row[9]),
    }));
  } finally {
    db.close();
  }
}
