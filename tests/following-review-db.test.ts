import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildFollowingReviewIndex, getFollowingReviewItemByHandle, listFollowingReviewItems } from '../src/following-review-db.js';
import { setFollowingLabel, writeFollowingReviewResults, writeFollowingSnapshot } from '../src/following-review-state.js';

async function withDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-following-db-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildFollowingReviewIndex lists candidates ahead of healthy accounts', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: '@candidate',
        state: 'active',
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
      {
        userId: '2',
        handle: '@healthy',
        state: 'active',
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
    ]);
    await writeFollowingReviewResults([
      {
        targetUserId: '1',
        handle: 'candidate',
        stage: 'stage2',
        disposition: 'candidate',
        primaryReason: 'inactive',
        score: 0.92,
        evidence: { inactivityDays: 120 },
        lastEvaluatedAt: '2026-04-19T09:10:00Z',
      },
      {
        targetUserId: '2',
        handle: 'healthy',
        stage: 'stage1',
        disposition: 'healthy',
        primaryReason: 'uncertain',
        score: 0.1,
        evidence: {},
        lastEvaluatedAt: '2026-04-19T09:11:00Z',
      },
    ]);
    await setFollowingLabel({
      targetUserId: '1',
      handle: '@candidate',
      value: 'not-valuable',
      updatedAt: '2026-04-19T09:05:00Z',
    });

    const result = await buildFollowingReviewIndex();
    assert.equal(result.recordCount, 2);

    const rows = await listFollowingReviewItems();
    assert.deepEqual(rows.map((row) => row.handle), ['candidate', 'healthy']);
    assert.equal(rows[0].label, 'not-valuable');
  });
});

test('getFollowingReviewItemByHandle resolves the latest normalized handle', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: '@Alice',
        name: 'Alice',
        state: 'protected',
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
    ]);
    await buildFollowingReviewIndex();

    const row = await getFollowingReviewItemByHandle('@alice');
    assert.equal(row?.userId, '1');
    assert.equal(row?.state, 'protected');
  });
});
