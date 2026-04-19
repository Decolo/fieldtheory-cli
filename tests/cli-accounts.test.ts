import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCli } from '../src/cli.js';
import { rememberAccountHandle } from '../src/account-registry.js';
import { buildAccountTimelineIndex } from '../src/account-timeline-db.js';
import { writeJson } from '../src/fs.js';

const execFileAsync = promisify(execFile);

const FIXTURES = [
  {
    id: '1',
    tweetId: '1',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    url: 'https://x.com/elonmusk/status/1',
    text: 'launching something soon',
    authorHandle: 'elonmusk',
    authorName: 'Elon Musk',
    syncedAt: '2026-04-19T08:00:00Z',
    postedAt: '2026-04-19T07:00:00Z',
    links: [],
    tags: [],
    ingestedVia: 'graphql',
  },
];

async function withAccountDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-accounts-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await rememberAccountHandle({ userId: '44196397', handle: '@elonmusk', name: 'Elon Musk' });
    await mkdir(path.join(dir, 'accounts', '44196397'), { recursive: true });
    await writeFile(path.join(dir, 'accounts', '44196397', 'timeline.jsonl'), FIXTURES.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeJson(path.join(dir, 'accounts', '44196397', 'timeline-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      targetUserId: '44196397',
      targetHandle: 'elonmusk',
      targetName: 'Elon Musk',
      lastSyncAt: '2026-04-19T08:00:00Z',
      retention: '90d',
      totalItems: 1,
      latestTweetId: '1',
      latestTweetPostedAt: '2026-04-19T07:00:00Z',
      latestChanged: true,
    });
    await buildAccountTimelineIndex('44196397');
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCli(args: string[], dir: string): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  try {
    const result = await execFileAsync(tsx, ['src/cli.ts', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });
    return { stdout: result.stdout, stderr: result.stderr, code: 0 };
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string; code?: number | null };
    return {
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
      code: failure.code ?? null,
    };
  }
}

test('buildCli help includes accounts command group', () => {
  const help = buildCli().helpInformation();
  assert.match(help, /\baccounts\b/);
});

test('ft accounts status prints account-specific summary', async () => {
  await withAccountDataDir(async (dir) => {
    const { stdout } = await runCli(['accounts', 'status', '@elonmusk'], dir);

    assert.match(stdout, /Account timeline/);
    assert.match(stdout, /@elonmusk/);
    assert.match(stdout, /total items: 1/);
  });
});

test('ft accounts list prints cached account timeline rows', async () => {
  await withAccountDataDir(async (dir) => {
    const { stdout } = await runCli(['accounts', 'list', '@elonmusk', '--limit', '1'], dir);

    assert.match(stdout, /@elonmusk/);
    assert.match(stdout, /https:\/\/x\.com\/elonmusk\/status\/1/);
  });
});

test('ft accounts show prints one cached tracked-account tweet', async () => {
  await withAccountDataDir(async (dir) => {
    const { stdout } = await runCli(['accounts', 'show', '@elonmusk', '1'], dir);

    assert.match(stdout, /Elon Musk/);
    assert.match(stdout, /launching something soon/);
  });
});

test('ft accounts status works from local metadata even when the SQLite index is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-accounts-status-no-index-'));
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
      totalItems: 1,
      latestTweetId: '1',
      latestTweetPostedAt: '2026-04-19T07:00:00Z',
      latestChanged: true,
    });
    await writeJson(path.join(dir, 'accounts', '44196397', 'timeline-state.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      targetUserId: '44196397',
      targetHandle: 'elonmusk',
      lastRunAt: '2026-04-19T08:00:00Z',
      totalRuns: 1,
      totalFetched: 1,
      totalStored: 1,
      totalAdded: 1,
      lastAdded: 1,
      lastPruned: 0,
      latestTweetId: '1',
      latestTweetPostedAt: '2026-04-19T07:00:00Z',
      latestChanged: true,
      lastSeenIds: ['1'],
      stopReason: 'end of timeline',
    });

    const { stdout, code } = await runCli(['accounts', 'status', '@elonmusk'], dir);
    assert.equal(code, 0);
    assert.match(stdout, /Account timeline/);
    assert.doesNotMatch(stdout, /Account index not built yet/);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('ft accounts list exits non-zero for an unknown local account', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-accounts-unknown-'));
  try {
    const { stdout, code } = await runCli(['accounts', 'list', '@unknown'], dir);
    assert.equal(code, 1);
    assert.match(stdout, /No local archive found/);
    assert.match(stdout, /ft accounts sync @unknown/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('ft accounts list exits non-zero when the account index is missing', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-accounts-missing-index-'));
  process.env.FT_DATA_DIR = dir;

  try {
    await rememberAccountHandle({ userId: '44196397', handle: '@elonmusk', name: 'Elon Musk' });
    const { stdout, code } = await runCli(['accounts', 'list', '@elonmusk'], dir);
    assert.equal(code, 1);
    assert.match(stdout, /Account index not built yet/);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('ft accounts show exits non-zero when the tweet id is not in the local archive', async () => {
  await withAccountDataDir(async (dir) => {
    const { stdout, code } = await runCli(['accounts', 'show', '@elonmusk', '999'], dir);
    assert.equal(code, 1);
    assert.match(stdout, /Account timeline item not found: 999/);
  });
});

test('ft accounts export prints JSON from the local archive', async () => {
  await withAccountDataDir(async (dir) => {
    const { stdout, code } = await runCli(
      ['accounts', 'export', '@elonmusk', '--after', '2026-04-01', '--before', '2026-04-30'],
      dir,
    );
    assert.equal(code, 0);
    const payload = JSON.parse(stdout);
    assert.equal(payload.account.handle, 'elonmusk');
    assert.equal(payload.count, 1);
    assert.equal(payload.items[0]?.tweetId, '1');
  });
});

test('ft accounts export writes JSON to a file with --out', async () => {
  await withAccountDataDir(async (dir) => {
    const outputPath = path.join(dir, 'exports', 'elonmusk.json');
    const { stdout, code } = await runCli(
      ['accounts', 'export', '@elonmusk', '--out', outputPath],
      dir,
    );
    assert.equal(code, 0);
    assert.match(stdout, /Exported 1 tweets for @elonmusk/);
    const payload = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(payload.account.userId, '44196397');
    assert.equal(payload.count, 1);
  });
});
