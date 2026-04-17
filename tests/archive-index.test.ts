import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildArchiveIndex, countArchiveItems, getArchiveItemByTweetId, listArchiveSources } from '../src/archive-index.js';
import { openDb } from '../src/db.js';
import { rebuildArchiveStoreFromCaches } from '../src/archive-store.js';
import { writeJsonLines } from '../src/fs.js';
import { twitterArchiveIndexPath } from '../src/paths.js';
import type { BookmarkRecord, FeedRecord, LikeRecord } from '../src/types.js';

const NOW = '2026-04-17T11:00:00.000Z';

function makeBookmarkRecord(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: 'bookmark-row',
    tweetId: 'tweet-shared',
    url: 'https://x.com/alice/status/tweet-shared',
    text: 'Shared canonical item',
    authorHandle: 'alice',
    authorName: 'Alice',
    bookmarkedAt: '2026-04-15T00:00:00.000Z',
    syncedAt: NOW,
    links: ['https://example.com/shared'],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeLikeRecord(overrides: Partial<LikeRecord> = {}): LikeRecord {
  return {
    id: 'like-row',
    tweetId: 'tweet-shared',
    url: 'https://x.com/alice/status/tweet-shared',
    text: 'Shared canonical item',
    authorHandle: 'alice',
    authorName: 'Alice',
    likedAt: '2026-04-16T00:00:00.000Z',
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
    id: 'feed-row',
    tweetId: 'tweet-feed-only',
    url: 'https://x.com/carol/status/tweet-feed-only',
    text: 'Feed-only canonical item',
    authorHandle: 'carol',
    authorName: 'Carol',
    syncedAt: NOW,
    sortIndex: '77',
    fetchPage: 3,
    fetchPosition: 9,
    links: [],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

async function withArchiveIndexData(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-archive-index-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [makeBookmarkRecord()]);
    await writeJsonLines(path.join(dir, 'likes.jsonl'), [makeLikeRecord()]);
    await writeJsonLines(path.join(dir, 'feed.jsonl'), [makeFeedRecord()]);
    await rebuildArchiveStoreFromCaches({ forceIndex: true });
    await fn();
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildArchiveIndex indexes canonical items and source attachments', async () => {
  await withArchiveIndexData(async () => {
    const result = await buildArchiveIndex({ force: true });

    assert.equal(result.recordCount, 2);
    assert.equal(await countArchiveItems(), 2);

    const shared = await getArchiveItemByTweetId('tweet-shared');
    assert.ok(shared);
    assert.equal(shared?.sourceCount, 2);
    assert.deepEqual(shared?.sources, ['bookmark', 'like']);

    const sources = await listArchiveSources('tweet-shared');
    assert.equal(sources.length, 2);
    assert.deepEqual(sources.map((entry) => entry.source), ['bookmark', 'like']);
    assert.equal(sources[0]?.metadata?.sourceRecordId, 'bookmark-row');
    assert.equal(sources[1]?.metadata?.sourceRecordId, 'like-row');
  });
});

test('buildArchiveIndex uses mediaObjects when media is present but empty', async () => {
  await withArchiveIndexData(async () => {
    await writeJsonLines(path.join(process.env.FT_DATA_DIR!, 'feed.jsonl'), [
      makeFeedRecord({
        id: 'feed-media-row',
        tweetId: 'tweet-media',
        url: 'https://x.com/carol/status/tweet-media',
        text: 'Media fallback item',
        media: [],
        mediaObjects: [{ type: 'photo', mediaUrl: 'https://img.example.com/1.jpg' }],
      }),
    ]);

    await rebuildArchiveStoreFromCaches({ forceIndex: true });

    const db = await openDb(twitterArchiveIndexPath());
    try {
      const mediaCount = Number(
        db.exec('SELECT media_count FROM archive_items WHERE tweet_id = ?', ['tweet-media'])[0]?.values?.[0]?.[0] ?? 0,
      );
      assert.equal(mediaCount, 1);
    } finally {
      db.close();
    }
  });
});
