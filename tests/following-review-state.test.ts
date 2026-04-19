import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  getFollowingReviewCache,
  readFollowingReviewState,
  resolveFollowedAccountFromCache,
  setFollowingLabel,
  writeFollowingReviewResults,
  writeFollowingSnapshot,
} from '../src/following-review-state.js';

async function withDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-following-state-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('following review state returns empty defaults on first run', async () => {
  await withDataDir(async () => {
    const cache = await getFollowingReviewCache();
    assert.deepEqual(cache.snapshot, []);
    assert.deepEqual(cache.labels, {});
    assert.deepEqual(cache.results, []);
    assert.equal(cache.state.followingSnapshotComplete, false);
    assert.equal(cache.state.totalFollowing, 0);
    assert.equal(cache.state.candidateCount, 0);
  });
});

test('writeFollowingSnapshot plus labels and review results persists review cache', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: '@Alice',
        name: 'Alice',
        state: 'active',
        followersCount: 100,
        followingCount: 50,
        statusesCount: 10,
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
    ], {
      sourceUserId: 'self-1',
      lastSyncedAt: '2026-04-19T09:00:00Z',
    });

    await setFollowingLabel({
      targetUserId: '1',
      handle: '@alice',
      value: 'valuable',
      updatedAt: '2026-04-19T09:05:00Z',
    });

    await writeFollowingReviewResults([
      {
        targetUserId: '1',
        handle: 'alice',
        name: 'Alice',
        stage: 'stage1',
        disposition: 'healthy',
        primaryReason: 'uncertain',
        score: 0.1,
        evidence: { label: 'valuable' },
        lastEvaluatedAt: '2026-04-19T09:06:00Z',
      },
    ], {
      reviewedAt: '2026-04-19T09:06:00Z',
      deepScannedUserIds: [],
    });

    const cache = await getFollowingReviewCache();
    assert.equal(cache.snapshot.length, 1);
    assert.equal(cache.snapshot[0].handle, 'alice');
    assert.equal(cache.labels['1'].value, 'valuable');
    assert.equal(cache.results[0].handle, 'alice');
    assert.equal(cache.state.sourceUserId, 'self-1');
    assert.equal(cache.state.followingSnapshotComplete, true);
    assert.equal(cache.state.totalFollowing, 1);
  });
});

test('writeFollowingSnapshot keeps labels resolvable across handle changes', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: '@oldname',
        state: 'active',
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
    ]);
    await setFollowingLabel({
      targetUserId: '1',
      handle: '@oldname',
      value: 'not-valuable',
      updatedAt: '2026-04-19T09:05:00Z',
    });

    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: '@newname',
        state: 'active',
        lastSyncedAt: '2026-04-20T09:00:00Z',
      },
    ]);

    const resolved = await resolveFollowedAccountFromCache('@newname');
    const cache = await getFollowingReviewCache();
    assert.equal(resolved?.userId, '1');
    assert.equal(cache.labels['1'].targetUserId, '1');
    assert.equal(cache.labels['1'].value, 'not-valuable');
  });
});

test('readFollowingReviewState preserves explicit deep scanned ids', async () => {
  await withDataDir(async () => {
    await writeFollowingReviewResults([], {
      reviewedAt: '2026-04-19T09:06:00Z',
      deepScannedUserIds: ['1', '1', '2'],
    });
    const state = await readFollowingReviewState();
    assert.deepEqual(state.deepScannedUserIds, ['1', '2']);
  });
});

test('partial writeFollowingSnapshot preserves the last authoritative total while marking state incomplete', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: 'alice',
        state: 'active',
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
      {
        userId: '2',
        handle: 'bob',
        state: 'active',
        lastSyncedAt: '2026-04-19T09:00:00Z',
      },
    ]);

    await writeFollowingSnapshot([
      {
        userId: '1',
        handle: 'alice',
        state: 'active',
        lastSyncedAt: '2026-04-20T09:00:00Z',
      },
    ], {
      complete: false,
      lastCursor: 'cursor-2',
    });

    const cache = await getFollowingReviewCache();
    assert.equal(cache.snapshot.length, 1);
    assert.equal(cache.state.followingSnapshotComplete, false);
    assert.equal(cache.state.totalFollowing, 2);
    assert.equal(cache.state.lastCursor, 'cursor-2');
  });
});
