import { buildIndex } from './bookmarks-db.js';
import { rebuildArchiveStoreFromCaches } from './archive-store.js';
import { readJson, readJsonLines, writeJson, writeJsonLines, pathExists } from './fs.js';
import { buildLikesIndex } from './likes-db.js';
import {
  twitterBookmarksCachePath,
  twitterBookmarksMetaPath,
  twitterLikesCachePath,
  twitterLikesMetaPath,
} from './paths.js';
import type { BookmarkCacheMeta, BookmarkRecord, LikeRecord, LikesCacheMeta } from './types.js';

export interface ArchiveRemovalResult {
  removed: boolean;
  tweetId: string;
  removedRecordId?: string;
  totalRemaining: number;
  cachePath: string;
  dbPath: string;
}

export interface ArchiveBulkRemovalResult {
  removedIds: string[];
  missingIds: string[];
  totalRemaining: number;
  cachePath: string;
  dbPath: string;
}

export interface ArchiveUpsertResult {
  inserted: boolean;
  tweetId: string;
  totalRecords: number;
  cachePath: string;
  dbPath: string;
}

export interface ArchiveBulkUpsertResult {
  insertedCount: number;
  updatedCount: number;
  totalRecords: number;
  cachePath: string;
  dbPath: string;
}

async function rebuildDerivedArchives(source: 'bookmark' | 'like'): Promise<string> {
  const index = source === 'bookmark'
    ? await buildIndex({ force: true })
    : await buildLikesIndex({ force: true });
  await rebuildArchiveStoreFromCaches({ forceIndex: true });
  return index.dbPath;
}

async function rewriteSourceMeta(totalRecords: number, source: 'bookmark' | 'like'): Promise<void> {
  if (source === 'bookmark') {
    const metaPath = twitterBookmarksMetaPath();
    const existing: BookmarkCacheMeta = await pathExists(metaPath)
      ? await readJson<BookmarkCacheMeta>(metaPath)
      : { provider: 'twitter', schemaVersion: 1, totalBookmarks: totalRecords };
    await writeJson(metaPath, {
      ...existing,
      totalBookmarks: totalRecords,
    } satisfies BookmarkCacheMeta);
    return;
  }

  const metaPath = twitterLikesMetaPath();
  const existing: LikesCacheMeta = await pathExists(metaPath)
    ? await readJson<LikesCacheMeta>(metaPath)
    : { provider: 'twitter', schemaVersion: 1, totalLikes: totalRecords };
  await writeJson(metaPath, {
    ...existing,
    totalLikes: totalRecords,
  } satisfies LikesCacheMeta);
}

async function rewriteBookmarkMeta(totalBookmarks: number): Promise<void> {
  await rewriteSourceMeta(totalBookmarks, 'bookmark');
}

async function rewriteLikesMeta(totalLikes: number): Promise<void> {
  await rewriteSourceMeta(totalLikes, 'like');
}

async function rewriteSourceCache<T extends { id: string; tweetId: string }>(
  source: 'bookmark' | 'like',
  rows: T[],
): Promise<{ cachePath: string; dbPath: string }> {
  const cachePath = source === 'bookmark' ? twitterBookmarksCachePath() : twitterLikesCachePath();
  await writeJsonLines(cachePath, rows);
  await rewriteSourceMeta(rows.length, source);
  return {
    cachePath,
    dbPath: await rebuildDerivedArchives(source),
  };
}

export async function removeBookmarkFromArchive(tweetId: string): Promise<ArchiveRemovalResult> {
  const cachePath = twitterBookmarksCachePath();
  const existing = await readJsonLines<BookmarkRecord>(cachePath);
  const removedRecord = existing.find((record) => record.id === tweetId || record.tweetId === tweetId);
  const next = existing.filter((record) => record.id !== tweetId && record.tweetId !== tweetId);

  const rewritten = await rewriteSourceCache('bookmark', next);

  return {
    removed: Boolean(removedRecord),
    tweetId,
    removedRecordId: removedRecord?.id,
    totalRemaining: next.length,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
  };
}

export async function removeLikeFromArchive(tweetId: string): Promise<ArchiveRemovalResult> {
  const cachePath = twitterLikesCachePath();
  const existing = await readJsonLines<LikeRecord>(cachePath);
  const removedRecord = existing.find((record) => record.id === tweetId || record.tweetId === tweetId);
  const next = existing.filter((record) => record.id !== tweetId && record.tweetId !== tweetId);

  const rewritten = await rewriteSourceCache('like', next);

  return {
    removed: Boolean(removedRecord),
    tweetId,
    removedRecordId: removedRecord?.id,
    totalRemaining: next.length,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
  };
}

export async function removeLikesFromArchive(tweetIds: string[]): Promise<ArchiveBulkRemovalResult> {
  const targets = new Set(tweetIds);
  const cachePath = twitterLikesCachePath();
  const existing = await readJsonLines<LikeRecord>(cachePath);
  const matchedTargets = new Set<string>();
  const removedIds = existing
    .filter((record) => {
      const matched = targets.has(record.id) || targets.has(record.tweetId);
      if (matched) {
        matchedTargets.add(record.id);
        matchedTargets.add(record.tweetId);
      }
      return matched;
    })
    .map((record) => record.id);
  const next = existing.filter((record) => !targets.has(record.id) && !targets.has(record.tweetId));

  const rewritten = await rewriteSourceCache('like', next);

  return {
    removedIds,
    missingIds: tweetIds.filter((tweetId) => !matchedTargets.has(tweetId)),
    totalRemaining: next.length,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
  };
}

function upsertByTweetId<T extends { id: string; tweetId: string }>(existing: T[], nextRecord: T): { rows: T[]; inserted: boolean } {
  let inserted = true;
  const rows = existing.map((record) => {
    const matches = record.id === nextRecord.id
      || record.tweetId === nextRecord.tweetId
      || record.id === nextRecord.tweetId
      || record.tweetId === nextRecord.id;
    if (!matches) return record;
    inserted = false;
    return {
      ...record,
      ...nextRecord,
    };
  });

  if (inserted) rows.unshift(nextRecord);
  return { rows, inserted };
}

export async function upsertBookmarkInArchive(record: BookmarkRecord): Promise<ArchiveUpsertResult> {
  const result = await upsertBookmarksInArchive([record]);
  return {
    inserted: result.insertedCount === 1,
    tweetId: record.tweetId,
    totalRecords: result.totalRecords,
    cachePath: result.cachePath,
    dbPath: result.dbPath,
  };
}

export async function upsertBookmarksInArchive(records: BookmarkRecord[]): Promise<ArchiveBulkUpsertResult> {
  const cachePath = twitterBookmarksCachePath();
  const existing = await readJsonLines<BookmarkRecord>(cachePath);
  let rows = existing;
  let insertedCount = 0;
  let updatedCount = 0;

  for (const record of records) {
    const next = upsertByTweetId(rows, record);
    rows = next.rows;
    if (next.inserted) insertedCount += 1;
    else updatedCount += 1;
  }

  const rewritten = await rewriteSourceCache('bookmark', rows);

  return {
    insertedCount,
    updatedCount,
    totalRecords: rows.length,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
  };
}

export async function upsertLikeInArchive(record: LikeRecord): Promise<ArchiveUpsertResult> {
  const result = await upsertLikesInArchive([record]);
  return {
    inserted: result.insertedCount === 1,
    tweetId: record.tweetId,
    totalRecords: result.totalRecords,
    cachePath: result.cachePath,
    dbPath: result.dbPath,
  };
}

export async function upsertLikesInArchive(records: LikeRecord[]): Promise<ArchiveBulkUpsertResult> {
  const cachePath = twitterLikesCachePath();
  const existing = await readJsonLines<LikeRecord>(cachePath);
  let rows = existing;
  let insertedCount = 0;
  let updatedCount = 0;

  for (const record of records) {
    const next = upsertByTweetId(rows, record);
    rows = next.rows;
    if (next.inserted) insertedCount += 1;
    else updatedCount += 1;
  }

  const rewritten = await rewriteSourceCache('like', rows);

  return {
    insertedCount,
    updatedCount,
    totalRecords: rows.length,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
  };
}
