import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { runAccountReview } from '../src/account-review.js';
import { readFollowingAccountCache, setFollowingLabel, writeFollowingSnapshot } from '../src/following-review-state.js';
import type { FollowedAccountSnapshot, FollowingAccountEvidenceCache } from '../src/types.js';

async function withDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-review-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

function snapshot(overrides: Partial<FollowedAccountSnapshot> = {}): FollowedAccountSnapshot {
  return {
    userId: '1',
    handle: 'alice',
    name: 'Alice',
    state: 'active',
    followersCount: 100,
    followingCount: 50,
    statusesCount: 30,
    lastSyncedAt: '2026-04-19T09:00:00Z',
    ...overrides,
  };
}

function evidence(overrides: Partial<FollowingAccountEvidenceCache> = {}): FollowingAccountEvidenceCache {
  return {
    targetUserId: '1',
    handle: 'alice',
    fetchedAt: '2026-04-19T09:00:00Z',
    recordCount: 10,
    lastPostedAt: '2026-01-01T00:00:00Z',
    avgLikeCount: 1,
    avgReplyCount: 0,
    avgViewCount: 20,
    ...overrides,
  };
}

test('inactive accounts become candidates with inactive as the primary reason', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([snapshot()]);
    const result = await runAccountReview({
      now: '2026-04-19T00:00:00Z',
      fetchEvidence: async () => evidence(),
    });
    assert.equal(result.candidateCount, 1);
    assert.equal(result.results[0].primaryReason, 'inactive');
    assert.equal(result.results[0].disposition, 'candidate');
  });
});

test('manual not-valuable labels strengthen a candidate case', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([snapshot()]);
    await setFollowingLabel({
      targetUserId: '1',
      handle: '@alice',
      value: 'not-valuable',
      updatedAt: '2026-04-19T09:05:00Z',
    });
    const result = await runAccountReview({
      now: '2026-04-19T00:00:00Z',
      fetchEvidence: async () => evidence(),
    });
    assert.equal(result.results[0].evidence.label, 'not-valuable');
    assert.equal(result.results[0].disposition, 'candidate');
  });
});

test('manual valuable labels suppress otherwise weak accounts', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([snapshot()]);
    await setFollowingLabel({
      targetUserId: '1',
      handle: '@alice',
      value: 'valuable',
      updatedAt: '2026-04-19T09:05:00Z',
    });
    const result = await runAccountReview({
      now: '2026-04-19T00:00:00Z',
      fetchEvidence: async () => evidence(),
    });
    assert.equal(result.results[0].disposition, 'healthy');
  });
});

test('accounts without enough evidence stay deferred instead of being marked inactive', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([snapshot({ followersCount: 10, statusesCount: 3 })]);
    const result = await runAccountReview({
      now: '2026-04-19T00:00:00Z',
      fetchEvidence: async () => null,
    });
    assert.equal(result.results[0].disposition, 'deferred');
    assert.equal(result.results[0].primaryReason, 'uncertain');
  });
});

test('cached deep-scan evidence is reused on later review runs', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([snapshot()]);
    await runAccountReview({
      now: '2026-04-19T00:00:00Z',
      fetchEvidence: async () => evidence(),
    });

    let called = false;
    const result = await runAccountReview({
      now: '2026-04-20T00:00:00Z',
      fetchEvidence: async () => {
        called = true;
        return evidence();
      },
    });

    assert.equal(called, false);
    const cache = await readFollowingAccountCache('1');
    assert.equal(cache?.recordCount, 10);
    assert.equal(result.results[0].stage, 'stage2');
  });
});

test('failed stage2 evidence fetch does not abort the whole review run', async () => {
  await withDataDir(async () => {
    await writeFollowingSnapshot([
      snapshot({ userId: '1', handle: 'alice' }),
      snapshot({ userId: '2', handle: 'bob' }),
    ]);
    const result = await runAccountReview({
      now: '2026-04-19T00:00:00Z',
      fetchEvidence: async (account) => {
        if (account.userId === '1') throw new Error('boom');
        return {
          ...evidence(),
          targetUserId: account.userId,
          handle: account.handle,
        };
      },
    });
    const alice = result.results.find((row) => row.targetUserId === '1');
    const bob = result.results.find((row) => row.targetUserId === '2');
    assert.equal(alice?.disposition, 'deferred');
    assert.equal(alice?.evidence.fetchStatus, 'failed');
    assert.equal(bob?.disposition, 'candidate');
  });
});
