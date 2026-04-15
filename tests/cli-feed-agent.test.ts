import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildFeedIndex } from '../src/feed-db.js';
import { buildIndex } from '../src/bookmarks-db.js';
import { buildLikesIndex } from '../src/likes-db.js';
import { buildCli, parseIntervalMs } from '../src/cli.js';
import { writeJson } from '../src/fs.js';

const execFileAsync = promisify(execFile);

async function withCliAgentData(fn: (dir: string, origin: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-feed-agent-'));
  process.env.FT_DATA_DIR = dir;

  const server = http.createServer(async (req, res) => {
    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => resolve(data));
    });
    const parsed = body ? JSON.parse(body) : {};

    if (req.url === '/embeddings') {
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      const encode = (text: string): number[] => {
        const value = String(text).toLowerCase();
        if (value.includes('agent') || value.includes('code review')) return [1, 0, 0];
        return [0, 1, 0];
      };
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: inputs.map((text: string, index: number) => ({
          index,
          embedding: encode(text),
        })),
      }));
      return;
    }

    if (req.url?.includes('/FavoriteTweet') || req.url?.includes('/CreateBookmark')) {
      assert.equal(parsed.variables?.tweet_id, 'fd-1');
      const key = req.url.includes('/FavoriteTweet') ? 'favorite_tweet' : 'tweet_bookmark_put';
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { [key]: 'Done' } }));
      return;
    }

    res.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock agent server.');

  try {
    const bookmarks = [{
      id: 'bm-1',
      tweetId: 'bm-1',
      url: 'https://x.com/alice/status/bm-1',
      text: 'AI agents for code review and code search',
      authorHandle: 'alice',
      authorName: 'Alice',
      postedAt: '2026-04-01T00:00:00Z',
      bookmarkedAt: '2026-04-02T00:00:00Z',
      syncedAt: '2026-04-02T00:00:00Z',
      links: ['https://blog.example.com/agents'],
      mediaObjects: [],
      tags: [],
      ingestedVia: 'graphql',
    }];
    const likes = [{
      id: 'lk-1',
      tweetId: 'lk-1',
      url: 'https://x.com/alice/status/lk-1',
      text: 'Practical AI agents for code review',
      authorHandle: 'alice',
      authorName: 'Alice',
      postedAt: '2026-04-03T00:00:00Z',
      likedAt: '2026-04-04T00:00:00Z',
      syncedAt: '2026-04-04T00:00:00Z',
      links: ['https://blog.example.com/practical-agents'],
      mediaObjects: [],
      tags: [],
      ingestedVia: 'graphql',
    }];
    const feed = [{
      id: 'fd-1',
      tweetId: 'fd-1',
      url: 'https://x.com/alice/status/fd-1',
      text: 'AI agents for code review and code search are getting much better',
      authorHandle: 'alice',
      authorName: 'Alice',
      postedAt: '2026-04-12T00:00:00Z',
      syncedAt: '2026-04-12T00:00:00Z',
      sortIndex: '200',
      fetchPage: 1,
      fetchPosition: 0,
      links: ['https://blog.example.com/agents'],
      tags: [],
      ingestedVia: 'graphql',
      engagement: { likeCount: 120, bookmarkCount: 40 },
    }];

    await writeFile(path.join(dir, 'bookmarks.jsonl'), bookmarks.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(dir, 'likes.jsonl'), likes.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(dir, 'feed.jsonl'), feed.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeJson(path.join(dir, 'bookmarks-meta.json'), { provider: 'twitter', schemaVersion: 1, totalBookmarks: 1 });
    await writeJson(path.join(dir, 'likes-meta.json'), { provider: 'twitter', schemaVersion: 1, totalLikes: 1 });
    await writeJson(path.join(dir, 'feed-meta.json'), { provider: 'twitter', schemaVersion: 1, totalItems: 1, totalSkippedEntries: 0 });
    await buildIndex({ force: true });
    await buildLikesIndex({ force: true });
    await buildFeedIndex({ force: true });
    await fn(dir, `http://127.0.0.1:${address.port}`);
  } finally {
    delete process.env.FT_DATA_DIR;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildCli help includes feed agent commands', () => {
  const cli = buildCli();
  const feed = cli.commands.find((command) => command.name() === 'feed');
  assert.ok(feed);
  const agent = feed.commands.find((command) => command.name() === 'agent');
  assert.ok(agent);
  const help = agent.helpInformation();
  assert.match(help, /\bagent\b/);
  assert.match(help, /\brun\b/);
});

test('buildCli help includes feed daemon and prefs commands', () => {
  const cli = buildCli();
  const feed = cli.commands.find((command) => command.name() === 'feed');
  assert.ok(feed);
  const daemon = feed.commands.find((command) => command.name() === 'daemon');
  const prefs = feed.commands.find((command) => command.name() === 'prefs');
  const semantic = feed.commands.find((command) => command.name() === 'semantic');
  assert.ok(daemon);
  assert.ok(prefs);
  assert.ok(semantic);
});

test('buildCli run help includes the --every scheduler option', () => {
  const cli = buildCli();
  const feed = cli.commands.find((command) => command.name() === 'feed');
  assert.ok(feed);
  const agent = feed.commands.find((command) => command.name() === 'agent');
  assert.ok(agent);
  const run = agent.commands.find((command) => command.name() === 'run');
  assert.ok(run);
  const help = run.helpInformation();
  assert.match(help, /--every <interval>/);
});

test('parseIntervalMs accepts seconds, minutes, and hours', () => {
  assert.equal(parseIntervalMs('30s'), 30_000);
  assert.equal(parseIntervalMs('5m'), 300_000);
  assert.equal(parseIntervalMs('2h'), 7_200_000);
});

test('parseIntervalMs rejects invalid intervals', () => {
  assert.throws(() => parseIntervalMs('30'), /Invalid interval/);
  assert.throws(() => parseIntervalMs('0m'), /greater than zero/);
  assert.throws(() => parseIntervalMs('1d'), /Invalid interval/);
});

test('ft feed agent run prints a concise summary', async () => {
  await withCliAgentData(async (dir, origin) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, [
      'src/cli.ts', 'feed', 'agent', 'run',
      '--max-pages', '0',
      '--cookies', 'ct0-token', 'auth',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FT_DATA_DIR: dir,
        FT_X_API_ORIGIN: origin,
        FT_EMBEDDING_API_KEY: 'test-key',
        FT_EMBEDDING_BASE_URL: origin,
      },
    });

    assert.match(stdout, /Feed agent run:/);
    assert.match(stdout, /auto-liked: 1/);
    assert.match(stdout, /auto-bookmarked: 1/);
  });
});

test('ft feed agent status and log expose persisted agent output', async () => {
  await withCliAgentData(async (dir, origin) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    await execFileAsync(tsx, [
      'src/cli.ts', 'feed', 'agent', 'run',
      '--max-pages', '0',
      '--cookies', 'ct0-token', 'auth',
    ], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FT_DATA_DIR: dir,
        FT_X_API_ORIGIN: origin,
        FT_EMBEDDING_API_KEY: 'test-key',
        FT_EMBEDDING_BASE_URL: origin,
      },
    });

    const { stdout: statusOut } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'agent', 'status'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });
    const { stdout: logOut } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'agent', 'log', '--limit', '5'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(statusOut, /Feed Agent/);
    assert.match(statusOut, /auto-liked: 1/);
    assert.match(logOut, /fd-1/);
    assert.match(logOut, /like\+bookmark|bookmark|like/);
  });
});

test('ft feed prefs commands persist explicit preferences', async () => {
  await withCliAgentData(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    await execFileAsync(tsx, ['src/cli.ts', 'feed', 'prefs', 'like', 'author', '@alice'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });
    await execFileAsync(tsx, ['src/cli.ts', 'feed', 'prefs', 'avoid-bookmark', 'domain', 'blog.example.com'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'prefs', 'show'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /author: @alice/);
    assert.match(stdout, /domain: blog\.example\.com/);
  });
});

test('ft feed daemon status prints daemon state even before start', async () => {
  await withCliAgentData(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'daemon', 'status'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /Feed Daemon/);
    assert.match(stdout, /running: no/);
  });
});

test('ft feed semantic status runs a real semantic health check', async () => {
  await withCliAgentData(async (dir, origin) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'semantic', 'status'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FT_DATA_DIR: dir,
        FT_EMBEDDING_API_KEY: 'test-key',
        FT_EMBEDDING_BASE_URL: origin,
      },
    });

    assert.match(stdout, /Feed Semantic/);
    assert.match(stdout, /configured: yes/);
    assert.match(stdout, /store ready: yes/);
    assert.match(stdout, /provider ready: yes/);
    assert.match(stdout, /provider: aliyun-bailian/);
  });
});

test('ft feed semantic rebuild rebuilds vectors and prints coverage', async () => {
  await withCliAgentData(async (dir, origin) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'semantic', 'rebuild'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        FT_DATA_DIR: dir,
        FT_EMBEDDING_API_KEY: 'test-key',
        FT_EMBEDDING_BASE_URL: origin,
      },
    });

    assert.match(stdout, /Feed Semantic/);
    assert.match(stdout, /documents: feed=1 likes=1 bookmarks=1/);
    assert.match(stdout, /Semantic rebuild complete/);
  });
});
