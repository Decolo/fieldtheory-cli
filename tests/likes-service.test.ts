import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeJson } from '../src/fs.js';
import { formatLikesStatus, getLikesStatusView } from '../src/likes-service.js';
import { buildLikesIndex } from '../src/likes-db.js';

test('formatLikesStatus produces human-readable summary', () => {
  const text = formatLikesStatus({
    likeCount: 42,
    lastUpdated: '2026-03-28T17:23:00Z',
    mode: 'Full archive sync via browser session',
    cachePath: '/tmp/x-likes.jsonl',
  });

  assert.match(text, /^Likes/);
  assert.match(text, /likes: 42/);
  assert.match(text, /last updated: 2026-03-28T17:23:00Z/);
  assert.match(text, /sync mode: Full archive sync via browser session/);
  assert.match(text, /cache: \/tmp\/x-likes\.jsonl/);
});

test('getLikesStatusView uses the most recent sync timestamp', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-likes-status-view-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeJson(path.join(tmpDir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastIncrementalSyncAt: '2026-04-05T10:00:00Z',
      lastFullSyncAt: '2026-04-05T12:34:56Z',
      totalLikes: 3,
    });

    const view = await getLikesStatusView();

    assert.equal(view.likeCount, 3);
    assert.equal(view.lastUpdated, '2026-04-05T12:34:56Z');
    assert.equal(view.mode, 'Full archive sync via browser session');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('getLikesStatusView prefers archive-backed like counts when available', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-likes-status-view-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeFile(
      path.join(tmpDir, 'likes.jsonl'),
      `${JSON.stringify({
        id: 'like-1',
        tweetId: '200',
        url: 'https://x.com/test/status/200',
        text: 'Like count from archive',
        authorHandle: 'tester',
        authorName: 'Tester',
        syncedAt: '2026-04-05T12:34:56Z',
        likedAt: '2026-04-05T12:34:56Z',
        ingestedVia: 'browser',
      })}\n`,
    );
    await writeJson(path.join(tmpDir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastFullSyncAt: '2026-04-05T12:34:56Z',
      totalLikes: 999,
    });

    await buildLikesIndex({ force: true });
    const view = await getLikesStatusView();

    assert.equal(view.likeCount, 1);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
