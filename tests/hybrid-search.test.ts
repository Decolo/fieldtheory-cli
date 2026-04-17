import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { buildIndex } from '../src/bookmarks-db.js';
import { buildLikesIndex } from '../src/likes-db.js';
import { buildFeedIndex } from '../src/feed-db.js';
import { runHybridSearch } from '../src/hybrid-search.js';

const BOOKMARKS = [
  {
    id: 'shared-1',
    tweetId: 'shared-1',
    url: 'https://x.com/alice/status/shared-1',
    text: 'Claude Code best practices for local agent workflows.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-01T00:00:00Z',
    postedAt: '2026-03-31T12:00:00Z',
    bookmarkedAt: '2026-04-01T00:00:00Z',
    links: [],
    tags: [],
    media: [],
    ingestedVia: 'browser',
  },
  {
    id: 'bookmark-strong',
    tweetId: 'bookmark-strong',
    url: 'https://x.com/alice/status/bookmark-strong',
    text: 'Claude Code local agent workflow playbook with best practices and evaluation loops.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-04T00:00:00Z',
    postedAt: '2026-04-04T00:00:00Z',
    bookmarkedAt: '2026-04-04T00:00:00Z',
    links: [],
    tags: [],
    media: [],
    ingestedVia: 'browser',
  },
  {
    id: 'bookmark-weak',
    tweetId: 'bookmark-weak',
    url: 'https://x.com/alice/status/bookmark-weak',
    text: 'Claude notes.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-05T00:00:00Z',
    postedAt: '2026-04-05T00:00:00Z',
    bookmarkedAt: '2026-04-05T00:00:00Z',
    links: [],
    tags: [],
    media: [],
    ingestedVia: 'browser',
  },
];

const LIKES = [
  {
    id: 'shared-1',
    tweetId: 'shared-1',
    url: 'https://x.com/alice/status/shared-1',
    text: 'Claude Code best practices for local agent workflows.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-02T00:00:00Z',
    postedAt: '2026-03-31T12:00:00Z',
    likedAt: '2026-04-02T00:00:00Z',
    links: [],
    tags: [],
    media: [],
    ingestedVia: 'browser',
  },
];

const FEED = [
  {
    id: 'feed-1',
    tweetId: 'feed-1',
    url: 'https://x.com/alice/status/feed-1',
    text: 'Local agent workflows improve when Claude Code is part of the loop.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-03T00:00:00Z',
    postedAt: '2026-04-03T00:00:00Z',
    sortIndex: '3000',
    fetchPage: 1,
    fetchPosition: 0,
    links: [],
    tags: [],
    media: [],
    ingestedVia: 'graphql',
  },
];

async function withHybridArchiveData(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-hybrid-search-'));
  process.env.FT_DATA_DIR = dir;
  const previousDisable = process.env.FT_DISABLE_LLM_ASSIST;
  process.env.FT_DISABLE_LLM_ASSIST = '1';

  try {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), BOOKMARKS);
    await writeJsonLines(path.join(dir, 'likes.jsonl'), LIKES);
    await writeJsonLines(path.join(dir, 'feed.jsonl'), FEED);
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalBookmarks: BOOKMARKS.length,
    });
    await writeJson(path.join(dir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalLikes: LIKES.length,
    });
    await writeJson(path.join(dir, 'feed-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalItems: FEED.length,
      totalSkippedEntries: 0,
    });

    await buildIndex();
    await buildLikesIndex();
    await buildFeedIndex();
    await fn();
  } finally {
    delete process.env.FT_DATA_DIR;
    if (previousDisable == null) delete process.env.FT_DISABLE_LLM_ASSIST;
    else process.env.FT_DISABLE_LLM_ASSIST = previousDisable;
    await rm(dir, { recursive: true, force: true });
  }
}

test('runHybridSearch returns mixed-source topic results and dedupes shared tweets', async () => {
  await withHybridArchiveData(async () => {
    const result = await runHybridSearch({
      query: 'claude code',
      mode: 'topic',
      limit: 10,
    });

    assert.equal(result.results[0].id, 'shared-1');
    assert.deepEqual(result.results[0].sources, ['bookmarks', 'likes']);
    assert.equal(result.results[0].sourceCount, 2);
    assert.equal(result.results.filter((item) => item.tweetId === 'shared-1').length, 1);
    assert.ok(result.results.some((item) => item.source === 'feed'));
  });
});

test('runHybridSearch supports natural-language queries and action ranking', async () => {
  await withHybridArchiveData(async () => {
    const result = await runHybridSearch({
      query: 'best practices on claude code for local agents',
      mode: 'action',
      limit: 10,
      summary: true,
    });

    assert.equal(result.results[0].id, 'shared-1');
    assert.equal(result.results[0].isBookmarked, true);
    assert.equal(result.results[0].isLiked, true);
    assert.equal(result.results[0].sourceDates.bookmarks, '2026-04-01T00:00:00Z');
    assert.equal(result.results[0].sourceDates.likes, '2026-04-02T00:00:00Z');
    assert.match(result.summary ?? '', /Top results|Claude|local/i);
    assert.equal(result.usedEngine, false);
    assert.deepEqual(result.expansions, []);
  });
});

test('runHybridSearch applies archive source filters against canonical items', async () => {
  await withHybridArchiveData(async () => {
    const result = await runHybridSearch({
      query: 'claude code',
      scope: 'bookmarks',
      limit: 10,
    });

    const shared = result.results.find((item) => item.tweetId === 'shared-1');
    assert.ok(shared);
    assert.equal(shared.source, 'bookmarks');
    assert.deepEqual(shared.sources, ['bookmarks', 'likes']);
    assert.ok(result.results.every((item) => item.sources.includes('bookmarks')));
  });
});

test('runHybridSearch preserves lexical ordering and filtered primary source for multi-source items', async () => {
  await withHybridArchiveData(async () => {
    const ranked = await runHybridSearch({
      query: 'claude code local agent workflow',
      scope: 'bookmarks',
      limit: 10,
    });

    const strongIndex = ranked.results.findIndex((item) => item.tweetId === 'bookmark-strong');
    const weakIndex = ranked.results.findIndex((item) => item.tweetId === 'bookmark-weak');
    assert.notEqual(strongIndex, -1);
    assert.notEqual(weakIndex, -1);
    assert.ok(strongIndex < weakIndex);

    const likesScoped = await runHybridSearch({
      query: 'claude code',
      scope: 'likes',
      limit: 10,
    });

    assert.equal(likesScoped.results.length, 1);
    assert.equal(likesScoped.results[0].tweetId, 'shared-1');
    assert.equal(likesScoped.results[0].source, 'likes');
    assert.deepEqual(likesScoped.results[0].sources, ['bookmarks', 'likes']);
  });
});
