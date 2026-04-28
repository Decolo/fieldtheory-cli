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
import { writeFeedConversationBundle } from '../src/feed-context-store.js';

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

test('buildCli feed group no longer exposes agent or prefs commands', () => {
  const cli = buildCli();
  const feed = cli.commands.find((command) => command.name() === 'feed');
  assert.ok(feed);
  assert.equal(feed.commands.some((command) => command.name() === 'agent'), false);
  assert.equal(feed.commands.some((command) => command.name() === 'prefs'), false);
  assert.equal(feed.commands.some((command) => command.name() === 'daemon'), true);
  assert.equal(feed.commands.some((command) => command.name() === 'context'), true);
  assert.equal(feed.commands.some((command) => command.name() === 'search'), true);
  assert.equal(feed.commands.some((command) => command.name() === 'index'), true);
  assert.equal(feed.commands.some((command) => command.name() === 'semantic'), false);
});

test('feed daemon help reflects collection-only behavior', () => {
  const cli = buildCli();
  const feed = cli.commands.find((command) => command.name() === 'feed');
  assert.ok(feed);
  const daemon = feed.commands.find((command) => command.name() === 'daemon');
  assert.ok(daemon);
  assert.match(daemon.helpInformation(), /collection/i);
  assert.doesNotMatch(daemon.helpInformation(), /consume/i);

  const start = daemon.commands.find((command) => command.name() === 'start');
  assert.ok(start);
  const help = start.helpInformation();
  assert.match(help, /--every <interval>/);
  assert.doesNotMatch(help, /like threshold|bookmark threshold|dry-run|candidate-limit/i);
});

test('removed feed agent and prefs commands fail as unknown commands', async () => {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');

  await assert.rejects(
    execFileAsync(tsx, ['src/cli.ts', 'feed', 'agent', 'run'], {
      cwd: process.cwd(),
      env: process.env,
    }),
    /unknown command ['"]agent['"]/i,
  );

  await assert.rejects(
    execFileAsync(tsx, ['src/cli.ts', 'feed', 'prefs', 'show'], {
      cwd: process.cwd(),
      env: process.env,
    }),
    /unknown command ['"]prefs['"]/i,
  );
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

test('ft feed search returns ranked cached feed items', async () => {
  await withFeedDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'search', 'machine learning'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /\[2026-04-12\]/);
    assert.match(stdout, /@alice/);
    assert.match(stdout, /Machine learning agents are getting better/);
    assert.match(stdout, /https:\/\/x\.com\/alice\/status\/1/);
  });
});

test('ft feed export prints canonical archive JSON', async () => {
  await withFeedDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'export', '--author', 'alice', '--after', '2026-04-01'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    const payload = JSON.parse(stdout);
    assert.equal(payload.resource, 'feed');
    assert.equal(payload.meta.count, 1);
    assert.equal(payload.meta.filters.author, 'alice');
    assert.equal(payload.meta.filters.after, '2026-04-01');
    assert.equal(payload.items[0].source, 'feed');
    assert.equal(payload.items[0].tweetId, '1');
    assert.equal(payload.items[0].collectedAt, '2026-04-12T14:00:00Z');
    assert.equal(payload.items[0].sourceDetails.sortIndex, '2000');
  });
});

test('ft feed show prints details for one feed item', async () => {
  await withFeedDataDir(async (dir) => {
    await writeFeedConversationBundle({
      schemaVersion: 1,
      rootFeedTweetId: '1',
      rootFeedItemId: '1',
      conversationTweetId: '1',
      conversationId: '1',
      targetKind: 'feed_tweet',
      fetchedAt: '2026-04-12T14:10:00Z',
      outcome: 'success',
      summary: 'Conversation fetched successfully with 1 reply.',
      replies: [
        {
          id: '2',
          tweetId: '2',
          url: 'https://x.com/bob/status/2',
          text: 'I agree with this take',
          authorHandle: 'bob',
          syncedAt: '2026-04-12T14:10:00Z',
          postedAt: '2026-04-12T13:10:00Z',
          ingestedVia: 'graphql',
        },
      ],
    });

    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'show', '1'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stdout, /Alice Smith/);
    assert.match(stdout, /Machine learning agents are getting better/);
    assert.match(stdout, /Conversation context/);
    assert.match(stdout, /sample replies/i);
    assert.match(stdout, /@bob/);
  });
});

test('ft feed show --json preserves the feed item shape and adds optional conversationContext', async () => {
  await withFeedDataDir(async (dir) => {
    await writeFeedConversationBundle({
      schemaVersion: 1,
      rootFeedTweetId: '1',
      rootFeedItemId: '1',
      conversationTweetId: '1',
      conversationId: '1',
      targetKind: 'feed_tweet',
      fetchedAt: '2026-04-12T14:10:00Z',
      outcome: 'success',
      replies: [],
    });

    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'show', '1', '--json'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    const payload = JSON.parse(stdout);
    assert.equal(payload.id, '1');
    assert.equal(payload.tweetId, '1');
    assert.equal(payload.authorHandle, 'alice');
    assert.ok(payload.conversationContext);
    assert.equal(payload.conversationContext.rootFeedTweetId, '1');
  });
});

test('ft feed index rebuilds the feed search index', async () => {
  await withFeedDataDir(async (dir) => {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    const { stdout, stderr } = await execFileAsync(tsx, ['src/cli.ts', 'feed', 'index', '--force'], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir },
    });

    assert.match(stderr, /Building feed search index/);
    assert.match(stdout, /Indexed 1 feed items \(1 new\)/);
    assert.match(stdout, /feed\.db/);
  });
});

test('ft feed context sync fails with feed-specific guidance before any local feed data exists', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-feed-empty-'));

  try {
    const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
    await assert.rejects(
      execFileAsync(tsx, ['src/cli.ts', 'feed', 'context', 'sync'], {
        cwd: process.cwd(),
        env: { ...process.env, FT_DATA_DIR: dir },
      }),
      (error: any) => {
        assert.match(String(error.stdout), /No feed items synced yet/);
        assert.match(String(error.stdout), /Run: ft feed sync/);
        return true;
      },
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
