import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { readJsonLines, writeJsonLines } from '../src/fs.js';
import { countArchiveItems, getArchiveItemByTweetId, listArchiveSources } from '../src/archive-index.js';
import { loadArchiveStore, rebuildArchiveStoreFromCaches, removeArchiveSourceAttachment } from '../src/archive-store.js';
import type { BookmarkRecord, FeedRecord, LikeRecord } from '../src/types.js';

const NOW = '2026-04-17T10:00:00.000Z';

function makeBookmarkRecord(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: 'tweet-bookmark',
    tweetId: 'tweet-bookmark',
    url: 'https://x.com/alice/status/tweet-bookmark',
    text: 'Bookmark record',
    authorHandle: 'alice',
    authorName: 'Alice',
    bookmarkedAt: '2026-04-16T00:00:00.000Z',
    syncedAt: NOW,
    links: ['https://example.com/bookmark'],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeLikeRecord(overrides: Partial<LikeRecord> = {}): LikeRecord {
  return {
    id: 'tweet-like',
    tweetId: 'tweet-like',
    url: 'https://x.com/bob/status/tweet-like',
    text: 'Like record',
    authorHandle: 'bob',
    authorName: 'Bob',
    likedAt: '2026-04-15T00:00:00.000Z',
    syncedAt: NOW,
    links: [],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeFeedRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  return {
    id: 'tweet-feed',
    tweetId: 'tweet-feed',
    url: 'https://x.com/carol/status/tweet-feed',
    text: 'Feed record',
    authorHandle: 'carol',
    authorName: 'Carol',
    syncedAt: NOW,
    sortIndex: '10',
    fetchPage: 1,
    fetchPosition: 2,
    links: [],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

async function withArchiveCaches(
  setup: (helpers: {
    dir: string;
    writeBookmarks(records: BookmarkRecord[]): Promise<void>;
    writeLikes(records: LikeRecord[]): Promise<void>;
    writeFeed(records: FeedRecord[]): Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-archive-store-'));
  process.env.FT_DATA_DIR = dir;

  try {
    await setup({
      dir,
      writeBookmarks: (records) => writeJsonLines(path.join(dir, 'bookmarks.jsonl'), records),
      writeLikes: (records) => writeJsonLines(path.join(dir, 'likes.jsonl'), records),
      writeFeed: (records) => writeJsonLines(path.join(dir, 'feed.jsonl'), records),
    });
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('rebuildArchiveStoreFromCaches merges bookmark, like, and feed caches into one canonical store', async () => {
  await withArchiveCaches(async ({ writeBookmarks, writeLikes, writeFeed }) => {
    await writeBookmarks([
      makeBookmarkRecord({ id: 'bookmark-row-1', tweetId: 'tweet-shared', text: 'Shared tweet from bookmark' }),
    ]);
    await writeLikes([
      makeLikeRecord({ id: 'like-row-1', tweetId: 'tweet-shared', text: 'Shared tweet from bookmark' }),
    ]);
    await writeFeed([
      makeFeedRecord({ id: 'feed-row-1', tweetId: 'tweet-feed-only' }),
    ]);

    const result = await rebuildArchiveStoreFromCaches({ forceIndex: true });
    const items = await loadArchiveStore();

    assert.equal(result.totalItems, 2);
    assert.deepEqual(result.sourceCounts, { bookmark: 1, like: 1, feed: 1 });

    const shared = items.find((item) => item.tweetId === 'tweet-shared');
    assert.ok(shared);
    assert.equal(shared?.id, 'tweet-shared');
    assert.deepEqual(Object.keys(shared?.sourceAttachments ?? {}).sort(), ['bookmark', 'like']);
    assert.equal(shared?.sourceAttachments.bookmark?.metadata?.sourceRecordId, 'bookmark-row-1');
    assert.equal(shared?.sourceAttachments.like?.metadata?.sourceRecordId, 'like-row-1');
  });
});

test('rebuildArchiveStoreFromCaches is idempotent across repeated runs', async () => {
  await withArchiveCaches(async ({ writeBookmarks, writeLikes, writeFeed }) => {
    await writeBookmarks([makeBookmarkRecord({ id: 'bookmark-row-1', tweetId: 'tweet-shared' })]);
    await writeLikes([makeLikeRecord({ id: 'like-row-1', tweetId: 'tweet-shared' })]);
    await writeFeed([makeFeedRecord({ id: 'feed-row-1', tweetId: 'tweet-feed-only' })]);

    const first = await rebuildArchiveStoreFromCaches({ forceIndex: true });
    const firstItems = await loadArchiveStore();
    const second = await rebuildArchiveStoreFromCaches({ forceIndex: true });
    const secondItems = await loadArchiveStore();

    assert.deepEqual(second, first);
    assert.deepEqual(secondItems, firstItems);
  });
});

test('rebuildArchiveStoreFromCaches honors buildIndex=false', async () => {
  await withArchiveCaches(async ({ writeBookmarks, writeLikes, writeFeed }) => {
    await writeBookmarks([makeBookmarkRecord({ id: 'bookmark-row-1', tweetId: 'tweet-shared' })]);
    await writeLikes([makeLikeRecord({ id: 'like-row-1', tweetId: 'tweet-shared' })]);
    await writeFeed([makeFeedRecord({ id: 'feed-row-1', tweetId: 'tweet-feed-only' })]);

    const result = await rebuildArchiveStoreFromCaches({ buildIndex: false, forceIndex: true });

    assert.equal(result.totalItems, 2);
    await assert.rejects(
      access(result.indexPath, fsConstants.F_OK),
    );
  });
});

test('rebuildArchiveStoreFromCaches treats missing sibling caches as empty on first run', async () => {
  await withArchiveCaches(async ({ writeLikes }) => {
    await writeLikes([makeLikeRecord({ id: 'like-row-1', tweetId: 'tweet-like-only' })]);

    const result = await rebuildArchiveStoreFromCaches({ forceIndex: true });
    const items = await loadArchiveStore();

    assert.equal(result.totalItems, 1);
    assert.deepEqual(result.sourceCounts, { bookmark: 0, like: 1, feed: 0 });
    assert.equal(items[0]?.tweetId, 'tweet-like-only');
  });
});

test('rebuildArchiveStoreFromCaches fails closed when a sibling cache is malformed', async () => {
  await withArchiveCaches(async ({ dir, writeLikes, writeFeed }) => {
    await writeLikes([makeLikeRecord({ id: 'like-row-1', tweetId: 'tweet-like-only' })]);
    await writeFeed([makeFeedRecord({ id: 'feed-row-1', tweetId: 'tweet-feed-only' })]);
    await writeFile(path.join(dir, 'bookmarks.jsonl'), '{"id":"broken"\n', 'utf8');

    await assert.rejects(
      rebuildArchiveStoreFromCaches({ forceIndex: true }),
      /Failed to rebuild archive from cache .*bookmarks\.jsonl/,
    );

    await assert.rejects(access(path.join(dir, 'archive.jsonl'), fsConstants.F_OK));
  });
});

test('removeArchiveSourceAttachment rebuilds the archive index after removing one source from a canonical item', async () => {
  await withArchiveCaches(async ({ dir, writeBookmarks, writeLikes }) => {
    await writeBookmarks([
      makeBookmarkRecord({ id: 'bookmark-row-1', tweetId: 'tweet-shared', text: 'Shared tweet' }),
    ]);
    await writeLikes([
      makeLikeRecord({ id: 'like-row-1', tweetId: 'tweet-shared', text: 'Shared tweet' }),
    ]);

    await rebuildArchiveStoreFromCaches({ forceIndex: true });

    const result = await removeArchiveSourceAttachment('tweet-shared', 'bookmark');
    await rebuildArchiveStoreFromCaches({ forceIndex: true });
    const bookmarkCache = await readJsonLines<BookmarkRecord>(path.join(dir, 'bookmarks.jsonl'));
    const archive = await loadArchiveStore();
    const indexed = await getArchiveItemByTweetId('tweet-shared');
    const sources = await listArchiveSources('tweet-shared');

    assert.equal(result.removed, true);
    assert.equal(bookmarkCache.length, 0);
    assert.equal(archive.length, 1);
    assert.equal(archive[0]?.sourceAttachments.bookmark, undefined);
    assert.ok(archive[0]?.sourceAttachments.like);
    assert.equal(await countArchiveItems(), 1);
    assert.ok(indexed);
    assert.equal(indexed?.sourceCount, 1);
    assert.deepEqual(indexed?.sources, ['like']);
    assert.deepEqual(sources.map((entry) => entry.source), ['like']);
  });
});
