import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  buildLikesIndex,
  searchLikes,
  listLikes,
  getLikeById,
  formatLikeSearchResults,
} from '../src/likes-db.js';
import { twitterArchiveIndexPath } from '../src/paths.js';

const FIXTURES = [
  { id: '1', tweetId: '1', url: 'https://x.com/alice/status/1', text: 'Machine learning is transforming healthcare', authorHandle: 'alice', authorName: 'Alice Smith', syncedAt: '2026-01-01T00:00:00Z', postedAt: '2026-01-01T12:00:00Z', likedAt: '2026-03-05T12:00:00Z', engagement: { likeCount: 100, repostCount: 10 }, mediaObjects: [], links: ['https://example.com'], tags: [], ingestedVia: 'browser' },
  { id: '2', tweetId: '2', url: 'https://x.com/bob/status/2', text: 'Rust is a great systems programming language', authorHandle: 'bob', authorName: 'Bob Jones', syncedAt: '2026-02-01T00:00:00Z', postedAt: '2026-02-01T12:00:00Z', likedAt: null, engagement: { likeCount: 50 }, mediaObjects: [], links: [], tags: [], ingestedVia: 'browser' },
  { id: '3', tweetId: '3', url: 'https://x.com/alice/status/3', text: 'Deep learning models need massive compute', authorHandle: 'alice', authorName: 'Alice Smith', syncedAt: '2026-03-01T00:00:00Z', postedAt: '2026-03-01T12:00:00Z', likedAt: '2026-03-10T12:00:00Z', engagement: { likeCount: 200, repostCount: 30 }, mediaObjects: [{ type: 'photo', mediaUrl: 'https://img.com/1.jpg' }], links: [], tags: [], ingestedVia: 'browser' },
];

async function withIsolatedDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(tmpdir(), 'ft-likes-test-'));
  const jsonl = FIXTURES.map((r) => JSON.stringify(r)).join('\n') + '\n';
  await writeFile(path.join(dir, 'likes.jsonl'), jsonl);

  const saved = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    if (saved !== undefined) process.env.FT_DATA_DIR = saved;
    else delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildLikesIndex creates a searchable database', async () => {
  await withIsolatedDataDir(async () => {
    const result = await buildLikesIndex();
    assert.equal(result.recordCount, 3);
    assert.equal(result.newRecords, 3);
  });
});

test('searchLikes: full-text search returns matching results', async () => {
  await withIsolatedDataDir(async () => {
    await buildLikesIndex();
    const results = await searchLikes({ query: 'learning', limit: 10 });
    assert.equal(results.length, 2);
    assert.ok(results.some((result) => result.id === '1'));
    assert.ok(results.some((result) => result.id === '3'));
  });
});

test('searchLikes: author filter works', async () => {
  await withIsolatedDataDir(async () => {
    await buildLikesIndex();
    const results = await searchLikes({ query: '', author: 'alice', limit: 10 });
    assert.equal(results.length, 2);
    assert.ok(results.every((result) => result.authorHandle === 'alice'));
  });
});

test('listLikes sorts by likedAt fallback and getLikeById returns one item', async () => {
  await withIsolatedDataDir(async () => {
    await buildLikesIndex();
    const items = await listLikes({ limit: 10 });
    assert.equal(items[0].id, '3');
    assert.equal(items[1].id, '1');
    assert.equal(items[2].id, '2');

    const item = await getLikeById('2');
    assert.equal(item?.authorHandle, 'bob');
    assert.equal(item?.likedAt, null);
  });
});

test('buildLikesIndex with force rebuild does not duplicate rows', async () => {
  await withIsolatedDataDir(async () => {
    await buildLikesIndex();
    const result = await buildLikesIndex({ force: true });
    assert.equal(result.recordCount, 3);
  });
});

test('buildLikesIndex updates existing rows when cache content changes', async () => {
  await withIsolatedDataDir(async () => {
    await buildLikesIndex({ force: true });
    let item = await getLikeById('1');
    assert.equal(item?.text, 'Machine learning is transforming healthcare');

    const updated = {
      ...FIXTURES[0],
      text: 'Updated text with richer content',
      authorName: 'Alice Updated',
    };
    const jsonl = [updated, ...FIXTURES.slice(1)].map((r) => JSON.stringify(r)).join('\n') + '\n';
    await writeFile(path.join(process.env.FT_DATA_DIR!, 'likes.jsonl'), jsonl);

    await buildLikesIndex();
    item = await getLikeById('1');
    assert.equal(item?.text, 'Updated text with richer content');
    assert.equal(item?.authorName, 'Alice Updated');
  });
});

test('like projections exclude bookmark-only attachments for shared archive items', async () => {
  await withIsolatedDataDir(async () => {
    await writeFile(
      path.join(process.env.FT_DATA_DIR!, 'bookmarks.jsonl'),
      `${JSON.stringify({
        id: 'bookmark-only',
        tweetId: '77',
        url: 'https://x.com/example/status/77',
        text: 'Bookmark only tweet',
        authorHandle: 'keeper',
        authorName: 'Keeper',
        syncedAt: '2026-04-01T00:00:00Z',
        bookmarkedAt: '2026-04-01T01:00:00Z',
        ingestedVia: 'graphql',
      })}\n`,
    );

    await buildLikesIndex({ force: true });

    const items = await listLikes({ limit: 10 });
    assert.equal(items.some((item) => item.tweetId === '77'), false);
  });
});

test('like reads fall back to the legacy source index when archive.db is missing', async () => {
  await withIsolatedDataDir(async () => {
    await buildLikesIndex({ force: true });
    await rm(twitterArchiveIndexPath(), { force: true });

    const item = await getLikeById('1');
    const results = await searchLikes({ query: 'healthcare', limit: 10 });

    assert.ok(item);
    assert.equal(item?.id, '1');
    assert.equal(results.length, 1);
    assert.equal(results[0]?.id, '1');
  });
});

test('formatLikeSearchResults formats results with liked date when present', () => {
  const formatted = formatLikeSearchResults([
    {
      id: '1',
      url: 'https://x.com/test/status/1',
      text: 'Hello world',
      authorHandle: 'test',
      authorName: 'Test',
      likedAt: '2026-03-15T00:00:00Z',
      postedAt: '2026-01-15T00:00:00Z',
      score: -1.5,
    },
  ]);
  assert.ok(formatted.includes('[2026-03-15]'));
  assert.ok(formatted.includes('@test'));
  assert.ok(formatted.includes('Hello world'));
});
