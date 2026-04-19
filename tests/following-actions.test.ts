import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { buildFollowingReviewIndex, getFollowingReviewItemByHandle } from '../src/following-review-db.js';
import { reconcileUnfollowedAccount } from '../src/following-actions.js';
import { readFollowingReviewResults, writeFollowingReviewResults, writeFollowingSnapshot } from '../src/following-review-state.js';

async function withDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-following-actions-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('reconcileUnfollowedAccount removes the account from snapshot and review results', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      { userId: '1', handle: 'alice', state: 'active', lastSyncedAt: '2026-04-19T00:00:00Z' },
      { userId: '2', handle: 'bob', state: 'active', lastSyncedAt: '2026-04-19T00:00:00Z' },
    ]);
    await writeFollowingReviewResults([
      {
        targetUserId: '1',
        handle: 'alice',
        stage: 'stage2',
        disposition: 'candidate',
        primaryReason: 'inactive',
        score: 0.9,
        evidence: {},
        lastEvaluatedAt: '2026-04-19T00:00:00Z',
      },
      {
        targetUserId: '2',
        handle: 'bob',
        stage: 'stage1',
        disposition: 'healthy',
        primaryReason: 'uncertain',
        score: 0.1,
        evidence: {},
        lastEvaluatedAt: '2026-04-19T00:00:00Z',
      },
    ]);
    await buildFollowingReviewIndex({ force: true });

    const result = await reconcileUnfollowedAccount('1');
    assert.equal(result.removedFromSnapshot, true);
    assert.equal(result.totalFollowing, 1);

    const row = await getFollowingReviewItemByHandle('@alice');
    assert.equal(row, null);
  });
});

test('reconcileUnfollowedAccount preserves review history as unfollowed', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      { userId: '1', handle: 'alice', state: 'active', lastSyncedAt: '2026-04-19T00:00:00Z' },
    ]);
    await writeFollowingReviewResults([
      {
        targetUserId: '1',
        handle: 'alice',
        stage: 'stage2',
        disposition: 'candidate',
        primaryReason: 'inactive',
        score: 0.9,
        evidence: {},
        lastEvaluatedAt: '2026-04-19T00:00:00Z',
      },
    ]);

    const result = await reconcileUnfollowedAccount('1');
    assert.equal(result.updatedResults, true);

    const rows = await readFollowingReviewResults();
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.disposition, 'unfollowed');
  });
});
