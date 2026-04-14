import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { buildIndex } from '../src/bookmarks-db.js';
import { buildLikesIndex } from '../src/likes-db.js';
import { buildFeedIndex } from '../src/feed-db.js';
import { buildCli } from '../src/cli.js';

const execFileAsync = promisify(execFile);

async function withHybridArchiveData(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-hybrid-'));
  process.env.FT_DATA_DIR = dir;

  try {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), [{
      id: 'bm-1',
      tweetId: 'bm-1',
      url: 'https://x.com/alice/status/bm-1',
      text: 'Claude Code best practices for local agent workflows.',
      authorHandle: 'alice',
      authorName: 'Alice',
      syncedAt: '2026-04-01T00:00:00Z',
      postedAt: '2026-03-31T12:00:00Z',
      bookmarkedAt: '2026-04-01T00:00:00Z',
      links: [],
      tags: [],
      media: [],
      ingestedVia: 'browser',
    }]);
    await writeJsonLines(path.join(dir, 'likes.jsonl'), [{
      id: 'lk-1',
      tweetId: 'lk-1',
      url: 'https://x.com/bob/status/lk-1',
      text: 'Codex and Claude Code both matter for agents.',
      authorHandle: 'bob',
      authorName: 'Bob',
      syncedAt: '2026-04-02T00:00:00Z',
      postedAt: '2026-04-01T12:00:00Z',
      likedAt: '2026-04-02T00:00:00Z',
      links: [],
      tags: [],
      media: [],
      ingestedVia: 'browser',
    }]);
    await writeJsonLines(path.join(dir, 'feed.jsonl'), [{
      id: 'fd-1',
      tweetId: 'fd-1',
      url: 'https://x.com/carla/status/fd-1',
      text: 'Local agents improve when Claude Code is in the workflow.',
      authorHandle: 'carla',
      authorName: 'Carla',
      syncedAt: '2026-04-03T00:00:00Z',
      postedAt: '2026-04-03T00:00:00Z',
      sortIndex: '100',
      fetchPage: 1,
      fetchPosition: 0,
      links: [],
      tags: [],
      media: [],
      ingestedVia: 'graphql',
    }]);
    await writeJson(path.join(dir, 'bookmarks-meta.json'), { provider: 'twitter', schemaVersion: 1, totalBookmarks: 1 });
    await writeJson(path.join(dir, 'likes-meta.json'), { provider: 'twitter', schemaVersion: 1, totalLikes: 1 });
    await writeJson(path.join(dir, 'feed-meta.json'), { provider: 'twitter', schemaVersion: 1, totalItems: 1, totalSkippedEntries: 0 });
    await buildIndex();
    await buildLikesIndex();
    await buildFeedIndex();
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildCli help includes search-all command', () => {
  const help = buildCli().helpInformation();
  assert.match(help, /\bsearch-all\b/);
});

test('ft search-all prints mixed-source hybrid results', async () => {
  await withHybridArchiveData(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'search-all', 'claude code', '--limit', '5'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /\[bookmarks\]|\[bookmarks\+likes\]/);
    assert.match(stdout, /Claude Code/);
  });
});

test('ft search-all rejects invalid mode', async () => {
  await withHybridArchiveData(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    await assert.rejects(
      () => execFileAsync(tsx, ['src/cli.ts', 'search-all', 'claude code', '--mode', 'wrong'], {
        cwd: process.cwd(),
        env: { ...process.env, FT_DATA_DIR: dir },
      }),
      /Invalid search mode/,
    );
  });
});
