import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildFeedIndex } from '../src/feed-db.js';
import { writeJson } from '../src/fs.js';
import { buildCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

const FIXTURES = [
  {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    text: 'Machine learning agents are getting better',
    authorHandle: 'alice',
    authorName: 'Alice Smith',
    syncedAt: '2026-04-12T14:00:00Z',
    postedAt: '2026-04-12T13:00:00Z',
    sortIndex: '2000',
    fetchPage: 1,
    fetchPosition: 0,
    links: ['https://example.com'],
    tags: [],
    ingestedVia: 'graphql',
  },
];

async function withFeedDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-feed-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeFile(path.join(dir, 'feed.jsonl'), FIXTURES.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await writeJson(path.join(dir, 'feed-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastSyncAt: '2026-04-12T14:00:00Z',
      totalItems: 1,
      totalSkippedEntries: 2,
    });
    await buildFeedIndex();
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildCli help includes feed command group', () => {
  const help = buildCli().helpInformation();
  assert.match(help, /\bfeed\b/);
});

test('ft feed status prints feed-specific summary', async () => {
  await withFeedDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'status'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /Feed/);
    assert.match(stdout, /items: 1/);
    assert.match(stdout, /skipped entries: 2/);
    assert.match(stdout, /cache: .*feed\.jsonl/);
  });
});

test('ft feed list lists cached feed items', async () => {
  await withFeedDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'list', '--limit', '1'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /@alice/);
    assert.match(stdout, /https:\/\/x\.com\/alice\/status\/1/);
  });
});

test('ft feed show prints details for one feed item', async () => {
  await withFeedDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'show', '1'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /Alice Smith/);
    assert.match(stdout, /Machine learning agents are getting better/);
  });
});
