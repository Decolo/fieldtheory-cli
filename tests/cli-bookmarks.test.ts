import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildIndex } from '../src/bookmarks-db.js';
import { writeJson } from '../src/fs.js';
import { buildCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

const FIXTURES = [
  {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    text: 'LLM evaluation patterns for production systems',
    authorHandle: 'alice',
    authorName: 'Alice Smith',
    syncedAt: '2026-04-01T00:00:00Z',
    postedAt: '2026-03-15T12:00:00Z',
    bookmarkedAt: '2026-04-02T12:00:00Z',
    links: ['https://example.com/evals', 'https://github.com/example/evals'],
    tags: [],
    githubUrls: ['https://github.com/example/evals'],
    ingestedVia: 'graphql',
  },
];

async function withBookmarkDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-bookmarks-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeFile(path.join(dir, 'bookmarks.jsonl'), '');
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

async function withIndexedBookmarkDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-bookmarks-indexed-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeFile(path.join(dir, 'bookmarks.jsonl'), FIXTURES.map((r) => JSON.stringify(r)).join('\n') + '\n');
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      lastIncrementalSyncAt: '2026-04-02T12:00:00Z',
      totalBookmarks: 1,
    });
    await buildIndex();
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('bookmarks help exposes the real bookmark namespace', () => {
  const bookmarks = buildCli().commands.find((command) => command.name() === 'bookmarks');
  assert.ok(bookmarks);

  const help = bookmarks.helpInformation();

  assert.match(help, /sync, query, and manage your bookmarks archive/i);
  assert.match(help, /sync/);
  assert.match(help, /status/);
  assert.match(help, /search/);
  assert.match(help, /list/);
  assert.match(help, /show/);
  assert.match(help, /index/);
  assert.match(help, /repair/);
  assert.doesNotMatch(help, /alias/i);
});

test('bookmarks sync help shows the simplified GraphQL-only contract', () => {
  const bookmarks = buildCli().commands.find((command) => command.name() === 'bookmarks');
  assert.ok(bookmarks);
  const sync = bookmarks.commands.find((command) => command.name() === 'sync');
  assert.ok(sync);

  const help = sync.helpInformation();

  assert.match(help, /Sync bookmarks from X into your local archive/);
  assert.match(help, /--rebuild/);
  assert.doesNotMatch(help, /--api/);
  assert.doesNotMatch(help, /--continue/);
  assert.doesNotMatch(help, /--gaps/);
});

test('legacy top-level sync command is removed', () => {
  const names = buildCli().commands.map((command) => command.name());
  assert.ok(!names.includes('sync'));
});

test('legacy auth command is removed', () => {
  const names = buildCli().commands.map((command) => command.name());
  assert.ok(!names.includes('auth'));
});

test('ft bookmarks repair executes as a real bookmark subcommand', async () => {
  await withBookmarkDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'bookmarks', 'repair'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /No repair needed — bookmarks are already fully enriched/);
  });
});

test('ft bookmarks export prints canonical archive JSON', async () => {
  await withIndexedBookmarkDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'bookmarks', 'export', '--author', 'alice'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    const payload = JSON.parse(stdout);
    assert.equal(payload.resource, 'bookmarks');
    assert.equal(payload.meta.count, 1);
    assert.equal(payload.meta.filters.author, 'alice');
    assert.equal(payload.items[0].source, 'bookmark');
    assert.equal(payload.items[0].tweetId, '1');
    assert.equal(payload.items[0].collectedAt, '2026-04-02T12:00:00Z');
    assert.deepEqual(payload.items[0].sourceDetails.githubUrls, ['https://github.com/example/evals']);
    assert.equal('categories' in payload.items[0].sourceDetails, false);
  });
});

test('ft bookmarks export --out writes canonical JSON to a file', async () => {
  await withIndexedBookmarkDataDir(async (dir) => {
    const outputPath = path.join(dir, 'exports', 'bookmarks.json');
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'bookmarks', 'export', '--out', outputPath], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /Output:/);
    const payload = JSON.parse(await readFile(outputPath, 'utf8'));
    assert.equal(payload.resource, 'bookmarks');
    assert.equal(payload.items.length, 1);
  });
});
