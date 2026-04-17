import { readFile } from 'node:fs/promises';
import {
  archiveItemFromBookmarkRecord,
  archiveItemFromFeedRecord,
  archiveItemFromLikeRecord,
  normalizeArchiveText,
} from './archive-core.js';
import { buildArchiveIndex } from './archive-index.js';
import { pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from './fs.js';
import {
  twitterArchiveCachePath,
  twitterArchiveIndexPath,
  twitterBookmarksCachePath,
  twitterBookmarksMetaPath,
  twitterFeedCachePath,
  twitterFeedMetaPath,
  twitterLikesCachePath,
  twitterLikesMetaPath,
} from './paths.js';
import type {
  ArchiveItem,
  ArchiveSourceAttachment,
  ArchiveSourceKind,
  BookmarkCacheMeta,
  BookmarkRecord,
  FeedCacheMeta,
  FeedRecord,
  LikeRecord,
  LikesCacheMeta,
} from './types.js';

export interface ArchiveStoreSummary {
  cachePath: string;
  totalItems: number;
  sourceCounts: Record<ArchiveSourceKind, number>;
}

export interface ArchiveStoreRebuildResult extends ArchiveStoreSummary {
  indexPath: string;
}

export interface ArchiveSourceRemovalResult extends ArchiveStoreSummary {
  removed: boolean;
  tweetId: string;
  source: ArchiveSourceKind;
}

function sourceCounts(items: ArchiveItem[]): Record<ArchiveSourceKind, number> {
  return items.reduce<Record<ArchiveSourceKind, number>>(
    (counts, item) => {
      if (item.sourceAttachments.bookmark) counts.bookmark += 1;
      if (item.sourceAttachments.like) counts.like += 1;
      if (item.sourceAttachments.feed) counts.feed += 1;
      return counts;
    },
    { bookmark: 0, like: 0, feed: 0 },
  );
}

function mergeDefined<T extends object>(base: T, incoming: Partial<T>): T {
  const merged = { ...base } as Record<string, unknown>;
  for (const [key, value] of Object.entries(incoming)) {
    if (value !== undefined) merged[key] = value;
  }
  return merged as T;
}

function mergeAttachment(
  existing: ArchiveSourceAttachment | undefined,
  incoming: ArchiveSourceAttachment | undefined,
): ArchiveSourceAttachment | undefined {
  if (!existing) return incoming;
  if (!incoming) return existing;
  return {
    ...existing,
    ...incoming,
    metadata: {
      ...(existing.metadata ?? {}),
      ...(incoming.metadata ?? {}),
    },
  };
}

function preferredId(existing: ArchiveItem | undefined, incoming: ArchiveItem): string {
  return existing?.id ?? incoming.tweetId ?? incoming.id;
}

function latestTimestamp(...values: Array<string | null | undefined>): string | undefined {
  return values
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
}

function mergeArchiveItems(existing: ArchiveItem | undefined, incoming: ArchiveItem): ArchiveItem {
  if (!existing) {
    return {
      ...incoming,
      id: incoming.tweetId ?? incoming.id,
      normalizedText: incoming.normalizedText ?? normalizeArchiveText(incoming.text),
    };
  }

  const merged = mergeDefined(existing, incoming);

  return {
    ...merged,
    id: preferredId(existing, incoming),
    tweetId: existing.tweetId || incoming.tweetId,
    normalizedText: incoming.normalizedText
      ?? existing.normalizedText
      ?? normalizeArchiveText(incoming.text || existing.text),
    syncedAt: latestTimestamp(existing.syncedAt, incoming.syncedAt) ?? existing.syncedAt,
    sourceAttachments: {
      bookmark: mergeAttachment(existing.sourceAttachments.bookmark, incoming.sourceAttachments.bookmark),
      like: mergeAttachment(existing.sourceAttachments.like, incoming.sourceAttachments.like),
      feed: mergeAttachment(existing.sourceAttachments.feed, incoming.sourceAttachments.feed),
    },
  };
}

function withSourceRecordMetadata<T extends ArchiveItem>(
  item: T,
  source: ArchiveSourceKind,
  recordId: string,
): T {
  const attachment = item.sourceAttachments[source];
  if (!attachment) return item;

  return {
    ...item,
    id: item.tweetId || item.id,
    sourceAttachments: {
      ...item.sourceAttachments,
      [source]: {
        ...attachment,
        metadata: {
          ...(attachment.metadata ?? {}),
          sourceRecordId: recordId,
        },
      },
    },
  };
}

function canonicalItemFromBookmarkRecord(record: BookmarkRecord): ArchiveItem {
  return withSourceRecordMetadata(archiveItemFromBookmarkRecord(record), 'bookmark', record.id);
}

function canonicalItemFromLikeRecord(record: LikeRecord): ArchiveItem {
  return withSourceRecordMetadata(archiveItemFromLikeRecord(record), 'like', record.id);
}

function canonicalItemFromFeedRecord(record: FeedRecord): ArchiveItem {
  return withSourceRecordMetadata(archiveItemFromFeedRecord(record), 'feed', record.id);
}

function summarize(items: ArchiveItem[]): ArchiveStoreSummary {
  return {
    cachePath: twitterArchiveCachePath(),
    totalItems: items.length,
    sourceCounts: sourceCounts(items),
  };
}

async function readArchiveSourceCache<T>(cachePath: string): Promise<T[]> {
  try {
    const raw = await readFile(cachePath, 'utf8');
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as T);
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code === 'ENOENT') return [];
    throw new Error(`Failed to rebuild archive from cache ${cachePath}: ${(error as Error).message}`, {
      cause: error,
    });
  }
}

function sourceCachePath(source: ArchiveSourceKind): string {
  if (source === 'bookmark') return twitterBookmarksCachePath();
  if (source === 'like') return twitterLikesCachePath();
  return twitterFeedCachePath();
}

function sourceMetaPath(source: ArchiveSourceKind): string {
  if (source === 'bookmark') return twitterBookmarksMetaPath();
  if (source === 'like') return twitterLikesMetaPath();
  return twitterFeedMetaPath();
}

async function rewriteSourceMeta(totalRecords: number, source: ArchiveSourceKind): Promise<void> {
  const metaPath = sourceMetaPath(source);

  if (source === 'bookmark') {
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
    const existing: LikesCacheMeta = await pathExists(metaPath)
      ? await readJson<LikesCacheMeta>(metaPath)
      : { provider: 'twitter', schemaVersion: 1, totalLikes: totalRecords };
    await writeJson(metaPath, {
      ...existing,
      totalLikes: totalRecords,
    } satisfies LikesCacheMeta);
    return;
  }

  const existing: FeedCacheMeta = await pathExists(metaPath)
    ? await readJson<FeedCacheMeta>(metaPath)
    : { provider: 'twitter', schemaVersion: 1, totalItems: totalRecords, totalSkippedEntries: 0 };
  await writeJson(metaPath, {
    ...existing,
    totalItems: totalRecords,
  } satisfies FeedCacheMeta);
}

async function removeSourceRecord(
  tweetId: string,
  source: ArchiveSourceKind,
  attachment: ArchiveSourceAttachment,
): Promise<boolean> {
  const cachePath = sourceCachePath(source);
  const sourceRecordId = typeof attachment.metadata?.sourceRecordId === 'string'
    ? attachment.metadata.sourceRecordId
    : undefined;

  if (source === 'bookmark') {
    const records = await readJsonLines<BookmarkRecord>(cachePath);
    const next = records.filter((record) => record.id !== sourceRecordId && record.tweetId !== tweetId);
    if (next.length === records.length) return false;
    await writeJsonLines(cachePath, next);
    await rewriteSourceMeta(next.length, source);
    return true;
  }

  if (source === 'like') {
    const records = await readJsonLines<LikeRecord>(cachePath);
    const next = records.filter((record) => record.id !== sourceRecordId && record.tweetId !== tweetId);
    if (next.length === records.length) return false;
    await writeJsonLines(cachePath, next);
    await rewriteSourceMeta(next.length, source);
    return true;
  }

  const records = await readJsonLines<FeedRecord>(cachePath);
  const next = records.filter((record) => record.id !== sourceRecordId && record.tweetId !== tweetId);
  if (next.length === records.length) return false;
  await writeJsonLines(cachePath, next);
  await rewriteSourceMeta(next.length, source);
  return true;
}

export async function loadArchiveStore(): Promise<ArchiveItem[]> {
  const items = await readJsonLines<ArchiveItem>(twitterArchiveCachePath());
  return items.sort((left, right) => left.tweetId.localeCompare(right.tweetId));
}

export async function saveArchiveStore(items: ArchiveItem[]): Promise<ArchiveStoreSummary> {
  const sorted = [...items].sort((left, right) => left.tweetId.localeCompare(right.tweetId));
  await writeJsonLines(twitterArchiveCachePath(), sorted);
  return summarize(sorted);
}

export async function rebuildArchiveStoreFromCaches(options?: {
  buildIndex?: boolean;
  forceIndex?: boolean;
}): Promise<ArchiveStoreRebuildResult> {
  const [bookmarkRecords, likeRecords, feedRecords] = await Promise.all([
    readArchiveSourceCache<BookmarkRecord>(twitterBookmarksCachePath()),
    readArchiveSourceCache<LikeRecord>(twitterLikesCachePath()),
    readArchiveSourceCache<FeedRecord>(twitterFeedCachePath()),
  ]);

  const byTweetId = new Map<string, ArchiveItem>();
  const mergeRecord = (item: ArchiveItem): void => {
    const key = item.tweetId || item.id;
    byTweetId.set(key, mergeArchiveItems(byTweetId.get(key), item));
  };

  for (const record of bookmarkRecords) mergeRecord(canonicalItemFromBookmarkRecord(record));
  for (const record of likeRecords) mergeRecord(canonicalItemFromLikeRecord(record));
  for (const record of feedRecords) mergeRecord(canonicalItemFromFeedRecord(record));

  const summary = await saveArchiveStore([...byTweetId.values()]);
  const shouldBuildIndex = options?.buildIndex ?? true;
  const indexPath = twitterArchiveIndexPath();

  if (shouldBuildIndex) {
    await buildArchiveIndex({ force: options?.forceIndex ?? false });
  }

  return {
    ...summary,
    indexPath,
  };
}

export async function removeArchiveSourceAttachment(
  tweetId: string,
  source: ArchiveSourceKind,
): Promise<ArchiveSourceRemovalResult> {
  const existing = await loadArchiveStore();
  const target = existing.find((item) => item.tweetId === tweetId || item.id === tweetId);
  const removed = target?.sourceAttachments[source]
    ? await removeSourceRecord(target.tweetId, source, target.sourceAttachments[source])
    : false;
  const summary = removed
    ? await rebuildArchiveStoreFromCaches({ forceIndex: true })
    : summarize(existing);

  return {
    ...summary,
    removed,
    tweetId,
    source,
  };
}
