import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildCli } from '../src/cli.js';
import { buildFollowingReviewIndex, getFollowingReviewItemByHandle } from '../src/following-review-db.js';
import { writeFollowingReviewResults, writeFollowingSnapshot } from '../src/following-review-state.js';

const execFileAsync = promisify(execFile);

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-cli-accounts-review-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

async function runCli(args: string[], dir: string, env: Record<string, string> = {}): Promise<{ stdout: string; stderr: string; code: number | null }> {
  const tsx = path.join(process.cwd(), 'node_modules', '.bin', 'tsx');
  try {
    const result = await execFileAsync(tsx, ['src/cli.ts', ...args], {
      cwd: process.cwd(),
      env: { ...process.env, FT_DATA_DIR: dir, ...env },
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

async function startMockXServer(options: { partialFollowing?: boolean } = {}) {
  const timelineResponse = {
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [
                    {
                      entryId: 'tweet-1',
                      content: {
                        itemContent: {
                          itemType: 'TimelineTweet',
                          tweet_results: {
                            result: {
                              rest_id: '1',
                              core: {
                                user_results: {
                                  result: {
                                    rest_id: '1',
                                    core: { screen_name: 'alice', name: 'Alice' },
                                    legacy: {
                                      followers_count: 10,
                                      friends_count: 20,
                                      statuses_count: 50,
                                    },
                                  },
                                },
                              },
                              legacy: {
                                id_str: '1',
                                full_text: 'old post',
                                created_at: 'Mon Jan 01 00:00:00 +0000 2026',
                                favorite_count: 1,
                                retweet_count: 0,
                                reply_count: 0,
                                quote_count: 0,
                              },
                              views: { count: '10' },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
      },
    },
  };

  const server = http.createServer(async (req, res) => {
    if (req.url?.startsWith('/2/users/me')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { id: '111', username: 'me', name: 'Me' } }));
      return;
    }
    if (req.url?.startsWith('/2/users/111/following')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: [{
          id: '1',
          username: 'alice',
          name: 'Alice',
          verified: false,
          protected: false,
          public_metrics: {
            followers_count: 10,
            following_count: 20,
            tweet_count: 50,
          },
        }],
        meta: options.partialFollowing ? { next_token: 'next-token' } : {},
      }));
      return;
    }
    if (req.url?.includes('/UserByScreenName')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({
        data: {
          user: {
            result: {
              rest_id: '1',
              core: { screen_name: 'alice', name: 'Alice' },
              legacy: { followers_count: 10, friends_count: 20, statuses_count: 50 },
            },
          },
        },
      }));
      return;
    }
    if (req.url?.includes('/UserTweetsAndReplies')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(timelineResponse));
      return;
    }
    if (req.url?.includes('/UnfollowUser')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ data: { unfollow_user: 'Done' } }));
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind mock X server.');

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('buildCli help includes accounts review commands', () => {
  const cli = buildCli();
  const help = cli.helpInformation();
  assert.match(help, /\baccounts\b/);
  const accountsHelp = cli.commands.find((command) => command.name() === 'accounts')?.helpInformation() ?? '';
  assert.match(accountsHelp, /\breview\b/);
  assert.match(accountsHelp, /\bunfollow\b/);
});

test('ft accounts review prints conservative candidates from mock X data', async () => {
  await withDataDir(async (dir) => {
    const mockX = await startMockXServer();
    try {
      const { stdout, code } = await runCli(
        ['accounts', 'review', '--cookies', 'ct0-token', 'auth', '--max-pages', '1'],
        dir,
        { FT_X_API_ORIGIN: mockX.origin, FT_X_REST_API_ORIGIN: mockX.origin },
      );
      assert.equal(code, 0);
      assert.match(stdout, /Reviewed 1 followed accounts/);
      assert.doesNotMatch(stdout, /following snapshot is partial/i);
    } finally {
      await mockX.close();
    }
  });
});

test('ft accounts review warns when the persisted following snapshot is partial', async () => {
  await withDataDir(async (dir) => {
    const mockX = await startMockXServer({ partialFollowing: true });
    try {
      const { stdout, code } = await runCli(
        ['accounts', 'review', '--cookies', 'ct0-token', 'auth', '--max-pages', '1'],
        dir,
        { FT_X_API_ORIGIN: mockX.origin, FT_X_REST_API_ORIGIN: mockX.origin },
      );
      assert.equal(code, 0);
      assert.match(stdout, /following snapshot is partial/i);
    } finally {
      await mockX.close();
    }
  });
});

test('ft accounts label stores a manual label against the review cache', async () => {
  await withDataDir(async (dir) => {
    await writeFollowingSnapshot([{ userId: '1', handle: 'alice', state: 'active', lastSyncedAt: '2026-04-19T00:00:00Z' }]);
    await writeFollowingReviewResults([{
      targetUserId: '1',
      handle: 'alice',
      stage: 'stage1',
      disposition: 'candidate',
      primaryReason: 'inactive',
      score: 0.9,
      evidence: {},
      lastEvaluatedAt: '2026-04-19T00:00:00Z',
    }]);
    await buildFollowingReviewIndex({ force: true });

    const { stdout, code } = await runCli(['accounts', 'label', '@alice', 'valuable'], dir);
    assert.equal(code, 0);
    assert.match(stdout, /Saved label for @alice: valuable/);

    const row = await getFollowingReviewItemByHandle('@alice');
    assert.equal(row?.label, 'valuable');
  });
});

test('ft accounts unfollow removes a reviewed account with --yes', async () => {
  await withDataDir(async (dir) => {
    await writeFollowingSnapshot([{ userId: '1', handle: 'alice', state: 'active', lastSyncedAt: '2026-04-19T00:00:00Z' }]);
    await writeFollowingReviewResults([{
      targetUserId: '1',
      handle: 'alice',
      stage: 'stage2',
      disposition: 'candidate',
      primaryReason: 'inactive',
      score: 0.9,
      evidence: { inactivityDays: 100 },
      lastEvaluatedAt: '2026-04-19T00:00:00Z',
    }]);
    await buildFollowingReviewIndex({ force: true });

    const mockX = await startMockXServer();
    try {
      const { stdout, code } = await runCli(
        ['accounts', 'unfollow', '@alice', '--yes', '--cookies', 'ct0-token', 'auth'],
        dir,
        { FT_X_API_ORIGIN: mockX.origin, FT_X_REST_API_ORIGIN: mockX.origin },
      );
      assert.equal(code, 0);
      assert.match(stdout, /Unfollowed on X: @alice/);
      assert.equal(await getFollowingReviewItemByHandle('@alice'), null);
    } finally {
      await mockX.close();
    }
  });
});
