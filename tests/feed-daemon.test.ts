import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { formatFeedDaemonStatus, getFeedDaemonState } from '../src/feed-daemon.js';
import { readJson, writeJson } from '../src/fs.js';
import { twitterFeedDaemonStatePath } from '../src/paths.js';
import type { FeedDaemonState } from '../src/types.js';

test('formatFeedDaemonStatus renders structured last-tick summaries', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-daemon-status-'));
  process.env.FT_DATA_DIR = tmpDir;

  const state: FeedDaemonState = {
    schemaVersion: 2,
    pid: 999999,
    intervalMs: 1_200_000,
    startedAt: '2026-04-15T10:52:25.759Z',
    lastTickStartedAt: '2026-04-15T10:52:25.763Z',
    lastTickFinishedAt: '2026-04-15T10:55:36.951Z',
    lastFetchAdded: 2,
    lastFetchTotalItems: 20,
    lastTick: {
      tickId: 'tick-1',
      startedAt: '2026-04-15T10:52:25.763Z',
      finishedAt: '2026-04-15T10:55:36.951Z',
      stage: 'tick',
      outcome: 'success',
      summary: 'Feed daemon tick completed successfully.',
      durationMs: 1234,
      fetchAdded: 2,
      fetchTotalItems: 20,
    },
  };

  try {
    await writeJson(twitterFeedDaemonStatePath(), state);
    const status = await formatFeedDaemonStatus();

    assert.match(status, /Feed Daemon/);
    assert.match(status, /last stage: tick/);
    assert.match(status, /last outcome: success/);
    assert.match(status, /last error kind: none/);
    assert.match(status, /last summary: Feed daemon tick completed successfully\./);
    assert.match(status, /last duration: 1234ms/);
    assert.doesNotMatch(status, /last indexed items/);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('formatFeedDaemonStatus redacts legacy raw lastError content', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-daemon-status-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeJson(twitterFeedDaemonStatePath(), {
      schemaVersion: 2,
      lastError: 'Command failed: curl -H cookie: ct0=csrf-secret; auth_token=auth-secret -H authorization: Bearer secret-token',
    });
    const status = await formatFeedDaemonStatus();

    assert.doesNotMatch(status, /csrf-secret|auth-secret|secret-token/);
    assert.match(status, /last summary:/);
    assert.match(status, /ct0=\[REDACTED\]/);
    assert.match(status, /auth_token=\[REDACTED\]/);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('getFeedDaemonState rewrites legacy action-era state to the collection-only schema', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-daemon-status-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeJson(twitterFeedDaemonStatePath(), {
      schemaVersion: 1,
      pid: 999999,
      lastFetchAdded: 3,
      lastConsumed: 2,
      lastLiked: 1,
      lastBookmarked: 1,
      lastFailed: 0,
      lastTick: {
        tickId: 'legacy-tick',
        startedAt: '2026-04-15T10:52:25.763Z',
        finishedAt: '2026-04-15T10:55:36.951Z',
        stage: 'consume',
        outcome: 'success',
        summary: 'Legacy feed daemon tick completed successfully.',
        durationMs: 1234,
        fetchAdded: 3,
        fetchTotalItems: 20,
        consumed: 2,
        liked: 1,
        bookmarked: 1,
        failed: 0,
      },
    } as unknown as FeedDaemonState);
    const state = await getFeedDaemonState();
    const persisted = await readJson<FeedDaemonState>(twitterFeedDaemonStatePath());

    assert.equal(state.schemaVersion, 2);
    assert.equal(state.lastTick?.stage, 'tick');
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.lastTick?.stage, 'tick');

    const status = await formatFeedDaemonStatus();

    assert.match(status, /last fetch added: 3/);
    assert.doesNotMatch(status, /last indexed items/);
    assert.match(status, /last stage: tick/);
    assert.match(status, /Legacy feed daemon tick completed successfully\./);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
