import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { writeJson } from '../src/fs.js';
import { formatBookmarkStatus, formatBookmarkSummary, getBookmarkStatusView } from '../src/bookmarks-service.js';
import { buildIndex } from '../src/bookmarks-db.js';

test('formatBookmarkStatus produces human-readable summary', () => {
  const text = formatBookmarkStatus({
    connected: true,
    bookmarkCount: 99,
    lastUpdated: '2026-03-28T17:23:00Z',
    mode: 'Primary: browser-session GraphQL',
    cachePath: '/tmp/x-bookmarks.jsonl',
  });

  assert.match(text, /^Bookmarks/);
  assert.match(text, /bookmarks: 99/);
  assert.match(text, /last updated: 2026-03-28T17:23:00Z/);
  assert.match(text, /sync mode: Primary: browser-session GraphQL/);
  assert.match(text, /cache: \/tmp\/x-bookmarks\.jsonl/);
  assert.doesNotMatch(text, /dataset/);
});

test('formatBookmarkStatus shows never when no lastUpdated', () => {
  const text = formatBookmarkStatus({
    connected: false,
    bookmarkCount: 0,
    lastUpdated: null,
    mode: 'Primary: browser-session GraphQL',
    cachePath: '/tmp/x-bookmarks.jsonl',
  });

  assert.match(text, /last updated: never/);
});

test('formatBookmarkSummary produces concise operator-friendly output', () => {
  const text = formatBookmarkSummary({
    connected: true,
    bookmarkCount: 99,
    lastUpdated: '2026-03-28T17:23:00Z',
    mode: 'API sync',
    cachePath: '/tmp/x-bookmarks.jsonl',
  });

  assert.match(text, /bookmarks=99/);
  assert.match(text, /updated=2026-03-28T17:23:00Z/);
  assert.match(text, /mode="API sync"/);
});

test('getBookmarkStatusView uses the most recent sync timestamp', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-status-view-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeJson(path.join(tmpDir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastIncrementalSyncAt: '2026-04-05T10:00:00Z',
      lastFullSyncAt: '2026-04-05T12:34:56Z',
      totalBookmarks: 3,
    });

    const view = await getBookmarkStatusView();

    assert.equal(view.bookmarkCount, 3);
    assert.equal(view.lastUpdated, '2026-04-05T12:34:56Z');
    assert.equal(view.connected, true);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('getBookmarkStatusView prefers archive-backed bookmark counts when available', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-status-view-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeFile(
      path.join(tmpDir, 'bookmarks.jsonl'),
      `${JSON.stringify({
        id: 'bookmark-1',
        tweetId: '100',
        url: 'https://x.com/test/status/100',
        text: 'Count from archive',
        authorHandle: 'tester',
        authorName: 'Tester',
        syncedAt: '2026-04-05T12:34:56Z',
        bookmarkedAt: '2026-04-05T12:34:56Z',
        ingestedVia: 'graphql',
      })}\n`,
    );
    await writeJson(path.join(tmpDir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastFullSyncAt: '2026-04-05T12:34:56Z',
      totalBookmarks: 999,
    });

    await buildIndex({ force: true });
    const view = await getBookmarkStatusView();

    assert.equal(view.bookmarkCount, 1);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('getBookmarkStatusView reports the GraphQL-only bookmark mode', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-status-view-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeJson(path.join(tmpDir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastFullSyncAt: '2026-04-05T12:34:56Z',
      totalBookmarks: 3,
    });

    const view = await getBookmarkStatusView();

    assert.equal(view.connected, true);
    assert.equal(view.mode, 'Primary: browser-session GraphQL');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
