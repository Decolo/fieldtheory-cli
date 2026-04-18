import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { writeJson } from '../src/fs.js';
import { rememberAccountHandle } from '../src/account-registry.js';
import { formatAccountTimelineStatus, getAccountTimelineStatusView } from '../src/account-timeline-service.js';

test('formatAccountTimelineStatus produces a human-readable summary', () => {
  const text = formatAccountTimelineStatus({
    userId: '44196397',
    handle: 'elonmusk',
    name: 'Elon Musk',
    totalItems: 12,
    retention: '90d',
    lastUpdated: '2026-04-19T08:00:00Z',
    latestTweetId: '2',
    latestChanged: true,
    cachePath: '/tmp/timeline.jsonl',
  });

  assert.match(text, /^Account timeline/);
  assert.match(text, /@elonmusk/);
  assert.match(text, /total items: 12/);
  assert.match(text, /retention: 90d/);
});

test('getAccountTimelineStatusView reads local metadata through the registry', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-status-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await rememberAccountHandle({ userId: '44196397', handle: '@elonmusk', name: 'Elon Musk' });
    await mkdir(path.join(dir, 'accounts', '44196397'), { recursive: true });
    await writeJson(path.join(dir, 'accounts', '44196397', 'timeline-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      targetUserId: '44196397',
      targetHandle: 'elonmusk',
      targetName: 'Elon Musk',
      lastSyncAt: '2026-04-19T08:00:00Z',
      retention: '90d',
      totalItems: 12,
      latestTweetId: '2',
      latestTweetPostedAt: '2026-04-19T07:00:00Z',
      latestChanged: true,
    });

    const view = await getAccountTimelineStatusView('@elonmusk');
    assert.equal(view.userId, '44196397');
    assert.equal(view.totalItems, 12);
    assert.equal(view.handle, 'elonmusk');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
