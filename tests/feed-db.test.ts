import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { buildFeedIndex, countFeed, getFeedById, listFeed, searchFeed } from '../src/feed-db.js';
import { openDb, saveDb } from '../src/db.js';
import { twitterArchiveIndexPath, twitterFeedIndexPath } from '../src/paths.js';

const FIXTURES = [
  {
    id: '2',
    tweetId: '2',
    url: 'https://x.com/alice/status/2',
    text: 'newer',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-12T12:00:00Z',
    postedAt: '2026-04-12T11:00:00Z',
    sortIndex: '2000',
    fetchPage: 1,
    fetchPosition: 0,
    links: ['https://example.com'],
    tags: [],
    ingestedVia: 'graphql',
  },
  {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/bob/status/1',
    text: 'older refreshed',
    authorHandle: 'bob',
    authorName: 'Bob',
    syncedAt: '2026-04-11T12:00:00Z',
    postedAt: '2026-04-11T11:00:00Z',
    sortIndex: '1000',
    fetchPage: 2,
    fetchPosition: 5,
    links: [],
    tags: [],
    ingestedVia: 'graphql',
  },
];

async function withFeedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-db-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeFile(path.join(dir, 'feed.jsonl'), FIXTURES.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildFeedIndex and listFeed preserve feed ordering', async () => {
  await withFeedDataDir(async () => {
    const idx = await buildFeedIndex();
    assert.equal(idx.recordCount, 2);

    const items = await listFeed({ limit: 10, offset: 0 });
    assert.deepEqual(items.map((item) => item.id), ['2', '1']);
  });
});

test('listFeed paginates with limit and offset', async () => {
  await withFeedDataDir(async () => {
    await buildFeedIndex();
    const first = await listFeed({ limit: 1, offset: 0 });
    const second = await listFeed({ limit: 1, offset: 1 });
    assert.equal(first.length, 1);
    assert.equal(second.length, 1);
    assert.notEqual(first[0].id, second[0].id);
  });
});

test('countFeed and getFeedById read from the indexed feed archive', async () => {
  await withFeedDataDir(async () => {
    await buildFeedIndex();
    assert.equal(await countFeed(), 2);
    const item = await getFeedById('2');
    assert.ok(item);
    assert.equal(item?.authorHandle, 'alice');
    assert.equal(item?.sortIndex, '2000');
  });
});

test('searchFeed returns matching feed items through FTS', async () => {
  await withFeedDataDir(async () => {
    await buildFeedIndex();
    const results = await searchFeed('refreshed', 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, '1');
    assert.equal(results[0].tweetId, '1');
  });
});

test('searchFeed rejects malformed FTS queries with a user-facing error', async () => {
  await withFeedDataDir(async () => {
    await buildFeedIndex();
    await assert.rejects(
      () => searchFeed('claude OR OR code', 5),
      /Invalid search query/,
    );
  });
});

test('searchFeed lazily rebuilds feed FTS for older indexes that lack feed_fts', async () => {
  await withFeedDataDir(async () => {
    await buildFeedIndex();
    const dbPath = twitterFeedIndexPath();
    const db = await openDb(dbPath);
    try {
      db.run('DROP TABLE IF EXISTS feed_fts');
      saveDb(db, dbPath);
    } finally {
      db.close();
    }

    const results = await searchFeed('newer', 5);
    assert.equal(results.length, 1);
    assert.equal(results[0].id, '2');
  });
});

test('feed projections return only feed attachments for shared archive items', async () => {
  await withFeedDataDir(async (dir) => {
    await writeFile(
      path.join(dir, 'likes.jsonl'),
      `${JSON.stringify({
        id: 'like-shared',
        tweetId: '2',
        url: 'https://x.com/alice/status/2',
        text: 'newer',
        authorHandle: 'alice',
        authorName: 'Alice',
        syncedAt: '2026-04-12T13:00:00Z',
        likedAt: '2026-04-12T13:05:00Z',
        postedAt: '2026-04-12T11:00:00Z',
        ingestedVia: 'browser',
      })}\n`,
    );
    await writeFile(
      path.join(dir, 'bookmarks.jsonl'),
      `${JSON.stringify({
        id: 'bookmark-only',
        tweetId: '91',
        url: 'https://x.com/bookmark/status/91',
        text: 'bookmark only',
        authorHandle: 'bookmarker',
        authorName: 'Book Marker',
        syncedAt: '2026-04-12T10:00:00Z',
        bookmarkedAt: '2026-04-12T10:01:00Z',
        ingestedVia: 'graphql',
      })}\n`,
    );

    await buildFeedIndex({ force: true });

    const items = await listFeed({ limit: 10, offset: 0 });
    assert.equal(items.some((item) => item.tweetId === '91'), false);
    assert.equal(items.find((item) => item.tweetId === '2')?.id, '2');
  });
});

test('feed reads fall back to the legacy source index when archive.db is missing', async () => {
  await withFeedDataDir(async () => {
    await buildFeedIndex({ force: true });
    await rm(twitterArchiveIndexPath(), { force: true });

    const items = await listFeed({ limit: 10, offset: 0 });
    const item = await getFeedById('2');
    const results = await searchFeed('newer', 5);

    assert.deepEqual(items.map((entry) => entry.id), ['2', '1']);
    assert.equal(item?.id, '2');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '2');
  });
});
