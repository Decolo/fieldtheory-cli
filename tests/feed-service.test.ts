import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeJson } from '../src/fs.js';
import { formatFeedStatus, getFeedStatusView } from '../src/feed-service.js';

test('formatFeedStatus produces human-readable summary', () => {
  const text = formatFeedStatus({
    itemCount: 42,
    skippedEntries: 7,
    lastUpdated: '2026-04-12T14:00:00Z',
    mode: 'Read-only Home timeline sync via browser session',
    cachePath: '/tmp/feed.jsonl',
  });

  assert.match(text, /^Feed/);
  assert.match(text, /items: 42/);
  assert.match(text, /skipped entries: 7/);
  assert.match(text, /last updated: 2026-04-12T14:00:00Z/);
  assert.match(text, /cache: \/tmp\/feed\.jsonl/);
});

test('getFeedStatusView uses feed metadata', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-status-view-'));
  process.env.FT_DATA_DIR = tmpDir;
  try {
    await writeJson(path.join(tmpDir, 'feed-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastSyncAt: '2026-04-12T14:00:00Z',
      totalItems: 3,
      totalSkippedEntries: 5,
    });

    const view = await getFeedStatusView();
    assert.equal(view.itemCount, 3);
    assert.equal(view.skippedEntries, 5);
    assert.equal(view.lastUpdated, '2026-04-12T14:00:00Z');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
