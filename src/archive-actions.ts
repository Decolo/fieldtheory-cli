import { buildIndex } from './bookmarks-db.js';
import { mergeBookmarkRecord } from './graphql-bookmarks.js';
import { rebuildArchiveStoreFromCaches } from './archive-store.js';
import { readJson, readJsonLines, writeJson, writeJsonLines, pathExists } from './fs.js';
import { buildLikesIndex } from './likes-db.js';
import { mergeLikeRecord } from './graphql-likes.js';
import { buildFeedIndex } from './feed-db.js';
import {
  twitterBookmarksCachePath,
  twitterBookmarksMetaPath,
  twitterLikesCachePath,
  twitterLikesMetaPath,
  twitterFeedCachePath,
  twitterFeedMetaPath,
} from './paths.js';
import type { BookmarkCacheMeta, BookmarkRecord, FeedCacheMeta, FeedRecord, LikeRecord, LikesCacheMeta } from './types.js';

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

type RewritableArchiveSource = 'bookmark' | 'like' | 'feed';

async function rebuildDerivedArchives(source: RewritableArchiveSource): Promise<string> {
  if (source === 'bookmark') {
    const index = await buildIndex({ force: true });
    await rebuildArchiveStoreFromCaches({ forceIndex: true });
    return index.dbPath;
  }

  if (source === 'like') {
    const index = await buildLikesIndex({ force: true });
    await rebuildArchiveStoreFromCaches({ forceIndex: true });
    return index.dbPath;
  }

  const index = await buildFeedIndex({ force: true });
  return index.dbPath;
}

async function rewriteSourceMeta(totalRecords: number, source: RewritableArchiveSource): Promise<void> {
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

  if (source === 'like') {
    const metaPath = twitterLikesMetaPath();
    const existing: LikesCacheMeta = await pathExists(metaPath)
      ? await readJson<LikesCacheMeta>(metaPath)
      : { provider: 'twitter', schemaVersion: 1, totalLikes: totalRecords };
    await writeJson(metaPath, {
      ...existing,
      totalLikes: totalRecords,
    } satisfies LikesCacheMeta);
    return;
  }

  const metaPath = twitterFeedMetaPath();
  const existing: FeedCacheMeta = await pathExists(metaPath)
    ? await readJson<FeedCacheMeta>(metaPath)
    : { provider: 'twitter', schemaVersion: 1, totalItems: totalRecords, totalSkippedEntries: 0 };
  await writeJson(metaPath, {
    ...existing,
    totalItems: totalRecords,
  } satisfies FeedCacheMeta);
}

async function rewriteBookmarkMeta(totalBookmarks: number): Promise<void> {
  await rewriteSourceMeta(totalBookmarks, 'bookmark');
}

async function rewriteLikesMeta(totalLikes: number): Promise<void> {
  await rewriteSourceMeta(totalLikes, 'like');
}

async function rewriteSourceCache<T extends { id: string; tweetId: string }>(
  source: RewritableArchiveSource,
  rows: T[],
): Promise<{ cachePath: string; dbPath: string }> {
  const cachePath = source === 'bookmark'
    ? twitterBookmarksCachePath()
    : source === 'like'
      ? twitterLikesCachePath()
      : twitterFeedCachePath();
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

export async function removeBookmarksFromArchive(tweetIds: string[]): Promise<ArchiveBulkRemovalResult> {
  const targets = new Set(tweetIds);
  const cachePath = twitterBookmarksCachePath();
  const existing = await readJsonLines<BookmarkRecord>(cachePath);
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

  const rewritten = await rewriteSourceCache('bookmark', next);

  return {
    removedIds,
    missingIds: tweetIds.filter((tweetId) => !matchedTargets.has(tweetId)),
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

export async function removeFeedItemsFromArchive(tweetIds: string[]): Promise<ArchiveBulkRemovalResult> {
  const targets = new Set(tweetIds);
  const cachePath = twitterFeedCachePath();
  const existing = await readJsonLines<FeedRecord>(cachePath);
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

  const rewritten = await rewriteSourceCache('feed', next);

  return {
    removedIds,
    missingIds: tweetIds.filter((tweetId) => !matchedTargets.has(tweetId)),
    totalRemaining: next.length,
    cachePath: rewritten.cachePath,
    dbPath: rewritten.dbPath,
  };
}

function upsertByTweetId<T extends { id: string; tweetId: string }>(
  existing: T[],
  nextRecord: T,
  mergeRecord: (existing: T | undefined, incoming: T) => T,
): { rows: T[]; inserted: boolean } {
  let inserted = true;
  const rows = existing.map((record) => {
    const matches = record.id === nextRecord.id
      || record.tweetId === nextRecord.tweetId
      || record.id === nextRecord.tweetId
      || record.tweetId === nextRecord.id;
    if (!matches) return record;
    inserted = false;
    return mergeRecord(record, nextRecord);
  });

  if (inserted) rows.unshift(mergeRecord(undefined, nextRecord));
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
    const next = upsertByTweetId(rows, record, mergeBookmarkRecord);
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
    const next = upsertByTweetId(rows, record, mergeLikeRecord);
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
