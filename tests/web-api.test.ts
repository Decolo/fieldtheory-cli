import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { buildIndex } from '../src/bookmarks-db.js';
import { buildLikesIndex } from '../src/likes-db.js';
import { buildFeedIndex } from '../src/feed-db.js';
import { createWebApp } from '../src/web-server.js';

function daysAgo(days: number, hour = 0): string {
  const value = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  value.setUTCHours(hour, 0, 0, 0);
  return value.toISOString();
}

function utcDate(value: string): string {
  return value.slice(0, 10);
}

async function withArchiveData(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-web-api-'));
  process.env.FT_DATA_DIR = dir;
  const previousDisable = process.env.FT_DISABLE_LLM_ASSIST;
  process.env.FT_DISABLE_LLM_ASSIST = '1';

  const bookmarkOneAt = daysAgo(6, 8);
  const bookmarkTwoAt = daysAgo(1, 9);
  const likeOneAt = daysAgo(2, 10);
  const likeTwoAt = daysAgo(0, 11);
  const feedLogLines = [
    `${daysAgo(6, 1)} event=fetch_ok tick_id=tick-1 fetch_added=3 total_items=10`,
    `${daysAgo(3, 2)} event=fetch_error tick_id=tick-2 kind=network summary="timeout"`,
    `${daysAgo(1, 3)} event=fetch_ok tick_id=tick-3 fetch_added=2 total_items=12`,
    `${daysAgo(0, 4)} event=fetch_error tick_id=tick-4 kind=network summary="reset"`,
  ];

  try {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [
      {
        id: 'bm-1',
        tweetId: '101',
        url: 'https://x.com/alice/status/101',
        text: 'Claude Code makes CLI workflows much faster.',
        authorHandle: 'alice',
        authorName: 'Alice',
        syncedAt: bookmarkOneAt,
        postedAt: daysAgo(7, 12),
        bookmarkedAt: bookmarkOneAt,
        links: ['https://example.com/claude-code'],
        tags: [],
        media: [],
        ingestedVia: 'browser',
      },
      {
        id: 'bm-2',
        tweetId: '102',
        url: 'https://x.com/alice/status/102',
        text: 'Second bookmark for dashboard aggregation.',
        authorHandle: 'alice',
        authorName: 'Alice',
        syncedAt: bookmarkTwoAt,
        postedAt: daysAgo(1, 12),
        bookmarkedAt: bookmarkTwoAt,
        links: [],
        tags: [],
        media: [],
        ingestedVia: 'browser',
      },
    ]);
    await writeJsonLines(path.join(dir, 'likes.jsonl'), [
      {
        id: 'lk-1',
        tweetId: '202',
        url: 'https://x.com/bob/status/202',
        text: 'Claude Code and Codex both matter for local agent workflows.',
        authorHandle: 'bob',
        authorName: 'Bob',
        syncedAt: likeOneAt,
        postedAt: daysAgo(3, 11),
        likedAt: likeOneAt,
        links: ['https://example.com/agents'],
        tags: [],
        media: [],
        ingestedVia: 'browser',
      },
      {
        id: 'lk-2',
        tweetId: '203',
        url: 'https://x.com/bob/status/203',
        text: 'Another like for per-day stats.',
        authorHandle: 'bob',
        authorName: 'Bob',
        syncedAt: likeTwoAt,
        postedAt: daysAgo(0, 12),
        likedAt: likeTwoAt,
        links: [],
        tags: [],
        media: [],
        ingestedVia: 'browser',
      },
    ]);
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastIncrementalSyncAt: bookmarkTwoAt,
      totalBookmarks: 2,
    });
    await writeJson(path.join(dir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastFullSyncAt: likeTwoAt,
      totalLikes: 2,
    });
    await writeJsonLines(path.join(dir, 'feed.jsonl'), [
      {
        id: 'fd-1',
        tweetId: '303',
        url: 'https://x.com/carla/status/303',
        text: 'Best practices on Claude Code and local agents.',
        authorHandle: 'carla',
        authorName: 'Carla',
        syncedAt: daysAgo(0, 5),
        postedAt: daysAgo(0, 5),
        sortIndex: '3000',
        fetchPage: 1,
        fetchPosition: 0,
        links: [],
        tags: [],
        media: [],
        ingestedVia: 'graphql',
      },
    ]);
    await writeJson(path.join(dir, 'feed-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastSyncAt: daysAgo(0, 5),
      totalItems: 1,
      totalSkippedEntries: 0,
    });
    await writeFile(path.join(dir, 'feed-daemon.log'), `${feedLogLines.join('\n')}\n`, 'utf8');
    await buildIndex();
    await buildLikesIndex();
    await buildFeedIndex();
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    if (previousDisable == null) delete process.env.FT_DISABLE_LLM_ASSIST;
    else process.env.FT_DISABLE_LLM_ASSIST = previousDisable;
    await rm(dir, { recursive: true, force: true });
  }
}

test('web api status returns bookmark and like summaries', { concurrency: false }, async () => {
  await withArchiveData(async () => {
    const app = await createWebApp();
    const response = await app.request('/api/status');
    assert.equal(response.status, 200);

    const data = await response.json() as any;
    assert.equal(data.bookmarks.total, 2);
    assert.equal(data.likes.total, 2);
    assert.equal(data.feed.total, 1);
  });
});

test('web api lists bookmarks and returns bookmark detail', { concurrency: false }, async () => {
  await withArchiveData(async () => {
    const app = await createWebApp();

    const listResponse = await app.request('/api/bookmarks?limit=2');
    assert.equal(listResponse.status, 200);
    const listData = await listResponse.json() as any;
    assert.equal(listData.total, 2);
    assert.equal(listData.items[0].id, 'bm-2');

    const detailResponse = await app.request('/api/bookmarks/bm-1');
    assert.equal(detailResponse.status, 200);
    const detailData = await detailResponse.json() as any;
    assert.equal(detailData.authorHandle, 'alice');
  });
});

test('web api lists likes with query filters and 404s missing ids', { concurrency: false }, async () => {
  await withArchiveData(async () => {
    const app = await createWebApp();

    const listResponse = await app.request('/api/likes?query=Claude&limit=10');
    assert.equal(listResponse.status, 200);
    const listData = await listResponse.json() as any;
    assert.equal(listData.total, 1);
    assert.equal(listData.items[0].id, 'lk-1');

    const notFound = await app.request('/api/likes/missing');
    assert.equal(notFound.status, 404);
  });
});

test('web api returns empty lists when indexes are missing', { concurrency: false }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-web-api-empty-'));
  process.env.FT_DATA_DIR = dir;

  try {
    const app = await createWebApp();
    const response = await app.request('/api/bookmarks?limit=5&offset=bad');
    assert.equal(response.status, 200);

    const data = await response.json() as any;
    assert.equal(data.total, 0);
    assert.deepEqual(data.items, []);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('web api returns hybrid search results and summaries', { concurrency: false }, async () => {
  await withArchiveData(async () => {
    const app = await createWebApp();

    const listResponse = await app.request('/api/search?query=claude%20code&mode=topic&limit=5');
    assert.equal(listResponse.status, 200);
    const listData = await listResponse.json() as any;
    assert.equal(listData.items.length >= 2, true);
    assert.equal(listData.items[0].sources.includes('bookmarks') || listData.items[0].sources.includes('feed'), true);

    const summaryResponse = await app.request('/api/search/summary?query=claude%20code&mode=action&limit=5');
    assert.equal(summaryResponse.status, 200);
    const summaryData = await summaryResponse.json() as any;
    assert.equal(typeof summaryData.summary, 'string');
    assert.equal(summaryData.summary.length > 0, true);
  });
});

test('web api rejects invalid hybrid search mode', { concurrency: false }, async () => {
  await withArchiveData(async () => {
    const app = await createWebApp();
    const response = await app.request('/api/search?query=claude&mode=wrong');
    assert.equal(response.status, 400);
  });
});

test('web api exposes feed metrics for collection success and daily actions', { concurrency: false }, async () => {
  await withArchiveData(async () => {
    const app = await createWebApp();
    const response = await app.request('/api/feed/metrics');
    assert.equal(response.status, 200);

    const data = await response.json() as any;
    const bookmarkDate = utcDate(daysAgo(1, 9));
    const likeDate = utcDate(daysAgo(0, 11));
    assert.equal(data.feedCollection.windows.last7d.attempts, 4);
    assert.equal(data.feedCollection.windows.last7d.successes, 2);
    assert.equal(data.feedCollection.windows.last7d.failures, 2);
    assert.equal(data.feedCollection.windows.last24h.attempts, 1);
    assert.equal(data.feedCollection.windows.last24h.failures, 1);
    assert.equal(data.actions.totals.likes, 2);
    assert.equal(data.actions.totals.bookmarks, 2);
    assert.equal(Array.isArray(data.feedCollection.daily), true);
    assert.equal(Array.isArray(data.actions.daily), true);

    const actionsByDate = new Map(data.actions.daily.map((row: any) => [row.date, row]));
    assert.equal(actionsByDate.get(bookmarkDate)?.bookmarks, 1);
    assert.equal(actionsByDate.get(likeDate)?.likes, 1);
  });
});
