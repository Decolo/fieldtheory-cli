import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

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
