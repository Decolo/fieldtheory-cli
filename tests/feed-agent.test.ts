import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { getBookmarkById, buildIndex } from '../src/bookmarks-db.js';
import { buildFeedIndex } from '../src/feed-db.js';
import { runFeedAgent, listFeedAgentLog, runFeedConsumer } from '../src/feed-agent.js';
import { consumeFeedItems } from '../src/feed-consumer.js';
import { buildLikesIndex, getLikeById } from '../src/likes-db.js';
import { writeJson } from '../src/fs.js';
import { saveFeedPreferences } from '../src/feed-preferences.js';
import { twitterArchiveCachePath } from '../src/paths.js';

const BOOKMARKS = [
  {
    id: 'bm-1',
    tweetId: 'bm-1',
    url: 'https://x.com/alice/status/bm-1',
    text: 'AI agents for code review and code search across repos',
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-04-01T00:00:00Z',
    bookmarkedAt: '2026-04-02T00:00:00Z',
    syncedAt: '2026-04-02T00:00:00Z',
    links: ['https://blog.example.com/agents'],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
  },
];

const LIKES = [
  {
    id: 'lk-1',
    tweetId: 'lk-1',
    url: 'https://x.com/alice/status/lk-1',
    text: 'Practical AI agents and tooling for code review',
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-04-03T00:00:00Z',
    likedAt: '2026-04-04T00:00:00Z',
    syncedAt: '2026-04-04T00:00:00Z',
    links: ['https://blog.example.com/practical-agents'],
    mediaObjects: [],
    tags: [],
    ingestedVia: 'graphql',
  },
];

const FEED = [
  {
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
  },
  {
    id: 'fd-2',
    tweetId: 'fd-2',
    url: 'https://x.com/bob/status/fd-2',
    text: 'Completely unrelated sports update',
    authorHandle: 'bob',
    authorName: 'Bob',
    postedAt: '2026-04-12T00:00:00Z',
    syncedAt: '2026-04-12T00:00:00Z',
    sortIndex: '199',
    fetchPage: 1,
    fetchPosition: 1,
    links: [],
    tags: [],
    ingestedVia: 'graphql',
  },
];

async function withAgentData(
  fn: (dir: string, origin: string, requests: string[]) => Promise<void>,
  options: { favoriteStatuses?: number[]; bookmarkStatuses?: number[] } = {},
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-agent-'));
  process.env.FT_DATA_DIR = dir;
  process.env.FT_X_CLIENT_TRANSACTION_ID = 'test-transaction-id';
  const requests: string[] = [];
  const favoriteStatuses = [...(options.favoriteStatuses ?? [])];
  const bookmarkStatuses = [...(options.bookmarkStatuses ?? [])];

  const server = http.createServer(async (req, res) => {
    const body = await new Promise<string>((resolve) => {
      let data = '';
      req.on('data', (chunk) => { data += chunk; });
      req.on('end', () => resolve(data));
    });
    const parsed = body ? JSON.parse(body) : {};
    requests.push(req.url ?? '');

    if (req.url === '/embeddings') {
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
      const encode = (text: string): number[] => {
        const value = String(text).toLowerCase();
        if (value.includes('agent') || value.includes('code review') || value.includes('software engineering')) return [1, 0, 0];
        if (value.includes('sports')) return [0, 1, 0];
        return [0, 0, 1];
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

    if (req.url?.includes('/FavoriteTweet')) {
      assert.equal(['fd-1', 'fd-3', 'shared-1', 'lk-1', 'bm-1', 'legacy-shared-1'].includes(parsed.variables?.tweet_id), true);
      const status = favoriteStatuses.shift() ?? 200;
      res.writeHead(status, { 'content-type': status === 200 ? 'application/json' : 'text/plain' });
      res.end(status === 200 ? JSON.stringify({ data: { favorite_tweet: 'Done' } }) : 'temporary like failure');
      return;
    }

    if (req.url?.includes('/CreateBookmark')) {
      assert.equal(['fd-1', 'fd-3', 'shared-1', 'lk-1', 'bm-1', 'legacy-shared-1'].includes(parsed.variables?.tweet_id), true);
      const status = bookmarkStatuses.shift() ?? 200;
      res.writeHead(status, { 'content-type': status === 200 ? 'application/json' : 'text/plain' });
      res.end(status === 200 ? JSON.stringify({ data: { tweet_bookmark_put: 'Done' } }) : 'temporary bookmark failure');
      return;
    }

    res.writeHead(404).end('not found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Failed to bind test server.');

  try {
    await writeFile(path.join(dir, 'bookmarks.jsonl'), BOOKMARKS.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(dir, 'likes.jsonl'), LIKES.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(dir, 'feed.jsonl'), FEED.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeJson(path.join(dir, 'bookmarks-meta.json'), { provider: 'twitter', schemaVersion: 1, totalBookmarks: BOOKMARKS.length });
    await writeJson(path.join(dir, 'likes-meta.json'), { provider: 'twitter', schemaVersion: 1, totalLikes: LIKES.length });
    await writeJson(path.join(dir, 'feed-meta.json'), { provider: 'twitter', schemaVersion: 1, totalItems: FEED.length, totalSkippedEntries: 0 });
    await buildIndex({ force: true });
    await buildLikesIndex({ force: true });
    await buildFeedIndex({ force: true });
    await fn(dir, `http://127.0.0.1:${address.port}`, requests);
  } finally {
    delete process.env.FT_DATA_DIR;
    delete process.env.FT_X_CLIENT_TRANSACTION_ID;
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

test('runFeedAgent applies like and bookmark actions, updates local archives, and writes logs', async () => {
  await withAgentData(async (_dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    try {
      const result = await runFeedAgent({
        maxPages: 0,
        candidateLimit: 5,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });

      assert.equal(result.evaluated, 2);
      assert.equal(result.liked, 1);
      assert.equal(result.bookmarked, 1);
      assert.ok(await getLikeById('fd-1'));
      assert.ok(await getBookmarkById('fd-1'));
      assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 1);
      assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 1);

      const logs = await listFeedAgentLog(5);
      assert.equal(logs[0]?.tweetId, 'fd-2');
      assert.equal(logs[1]?.tweetId, 'fd-1');
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  });
});

test('runFeedAgent dry-run logs planned actions without remote mutations', async () => {
  await withAgentData(async (_dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    try {
      const result = await runFeedAgent({
        maxPages: 0,
        candidateLimit: 5,
        dryRun: true,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });
      assert.equal(result.liked, 0);
      assert.equal(result.bookmarked, 0);
      assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 0);
      assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 0);
      const logs = await listFeedAgentLog(5);
      assert.equal(logs.some((entry) => entry.decision === 'dry-run'), true);
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  });
});

test('explicit feed preferences override weak history and drive bookmark decisions', async () => {
  await withAgentData(async (_dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    saveFeedPreferences({
      like: { prefer: [], avoid: [] },
      bookmark: {
        prefer: [{ kind: 'domain', value: 'blog.example.com', createdAt: '2026-04-15T00:00:00Z' }],
        avoid: [],
      },
    });
    try {
      const result = await runFeedConsumer([
        {
          id: 'fd-3',
          tweetId: 'fd-3',
          url: 'https://x.com/carla/status/fd-3',
          text: 'A long field report about browser agents and code review',
          authorHandle: 'carla',
          authorName: 'Carla',
          postedAt: '2026-04-13T00:00:00Z',
          syncedAt: '2026-04-13T00:00:00Z',
          links: ['https://blog.example.com/field-report'],
          tags: [],
          ingestedVia: 'graphql',
        },
      ], {
        candidateLimit: 5,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });

      assert.equal(result.bookmarked, 1);
      assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 1);
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  });
});

test('runFeedConsumer treats canonical archive attachments as idempotency state even if legacy caches are absent', async () => {
  await withAgentData(async (dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    saveFeedPreferences({
      like: {
        prefer: [{ kind: 'author', value: 'alice', createdAt: '2026-04-15T00:00:00Z' }],
        avoid: [],
      },
      bookmark: {
        prefer: [{ kind: 'domain', value: 'blog.example.com', createdAt: '2026-04-15T00:00:00Z' }],
        avoid: [],
      },
    });
    try {
      const sharedBookmark = {
        id: 'bm-shared',
        tweetId: 'shared-1',
        url: 'https://x.com/alice/status/shared-1',
        text: 'AI agents for code review and browser automation',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-04-10T00:00:00Z',
        bookmarkedAt: '2026-04-11T00:00:00Z',
        syncedAt: '2026-04-11T00:00:00Z',
        links: ['https://blog.example.com/shared'],
        mediaObjects: [],
        tags: [],
        ingestedVia: 'graphql',
      };
      const sharedLike = {
        id: 'lk-shared',
        tweetId: 'shared-1',
        url: 'https://x.com/alice/status/shared-1',
        text: 'AI agents for code review and browser automation',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-04-10T00:00:00Z',
        likedAt: '2026-04-12T00:00:00Z',
        syncedAt: '2026-04-12T00:00:00Z',
        links: ['https://blog.example.com/shared'],
        mediaObjects: [],
        tags: [],
        ingestedVia: 'graphql',
      };

      await writeFile(path.join(dir, 'bookmarks.jsonl'), '');
      await writeFile(path.join(dir, 'likes.jsonl'), '');
      await writeJson(path.join(dir, 'bookmarks-meta.json'), { provider: 'twitter', schemaVersion: 1, totalBookmarks: 0 });
      await writeJson(path.join(dir, 'likes-meta.json'), { provider: 'twitter', schemaVersion: 1, totalLikes: 0 });
      await writeFile(twitterArchiveCachePath(), `${JSON.stringify({
        id: 'shared-1',
        tweetId: 'shared-1',
        url: sharedBookmark.url,
        text: sharedBookmark.text,
        authorHandle: sharedBookmark.authorHandle,
        authorName: sharedBookmark.authorName,
        postedAt: sharedBookmark.postedAt,
        syncedAt: sharedLike.syncedAt,
        links: sharedBookmark.links,
        mediaObjects: sharedBookmark.mediaObjects,
        tags: sharedBookmark.tags,
        ingestedVia: 'graphql',
        sourceAttachments: {
          bookmark: {
            source: 'bookmark',
            sourceTimestamp: sharedBookmark.bookmarkedAt,
            syncedAt: sharedBookmark.syncedAt,
            ingestedVia: 'graphql',
            metadata: { sourceRecordId: sharedBookmark.id },
          },
          like: {
            source: 'like',
            sourceTimestamp: sharedLike.likedAt,
            syncedAt: sharedLike.syncedAt,
            ingestedVia: 'graphql',
            metadata: { sourceRecordId: sharedLike.id },
          },
        },
      })}\n`);

      const result = await consumeFeedItems([
        {
          id: 'fd-shared',
          tweetId: 'shared-1',
          url: 'https://x.com/alice/status/shared-1',
          text: 'AI agents for code review and browser automation',
          authorHandle: 'alice',
          authorName: 'Alice',
          postedAt: '2026-04-13T00:00:00Z',
          syncedAt: '2026-04-13T00:00:00Z',
          links: ['https://blog.example.com/shared'],
          tags: [],
          ingestedVia: 'graphql',
        },
      ], {
        candidateLimit: 1,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });

      assert.equal(result.evaluated, 1);
      assert.equal(result.liked, 0);
      assert.equal(result.bookmarked, 0);
      assert.equal(result.skipped, 1);
      assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 0);
      assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 0);
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  });
});

test('runFeedConsumer falls back to legacy like and bookmark caches when archive cache is missing', async () => {
  await withAgentData(async (dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    try {
      const legacyBookmark = {
        id: 'bm-legacy-shared',
        tweetId: 'legacy-shared-1',
        url: 'https://x.com/alice/status/legacy-shared-1',
        text: 'Practical AI agents and tooling for code review',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-04-12T00:00:00Z',
        bookmarkedAt: '2026-04-13T00:00:00Z',
        syncedAt: '2026-04-13T00:00:00Z',
        links: ['https://blog.example.com/practical-agents'],
        mediaObjects: [],
        tags: [],
        ingestedVia: 'graphql',
      };
      const legacyLike = {
        id: 'lk-legacy-shared',
        tweetId: 'legacy-shared-1',
        url: 'https://x.com/alice/status/legacy-shared-1',
        text: 'Practical AI agents and tooling for code review',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-04-12T00:00:00Z',
        likedAt: '2026-04-13T00:00:00Z',
        syncedAt: '2026-04-13T00:00:00Z',
        links: ['https://blog.example.com/practical-agents'],
        mediaObjects: [],
        tags: [],
        ingestedVia: 'graphql',
      };

      await writeFile(path.join(dir, 'bookmarks.jsonl'), `${JSON.stringify(legacyBookmark)}\n`);
      await writeFile(path.join(dir, 'likes.jsonl'), `${JSON.stringify(legacyLike)}\n`);
      await writeJson(path.join(dir, 'bookmarks-meta.json'), { provider: 'twitter', schemaVersion: 1, totalBookmarks: 1 });
      await writeJson(path.join(dir, 'likes-meta.json'), { provider: 'twitter', schemaVersion: 1, totalLikes: 1 });
      await rm(twitterArchiveCachePath(), { force: true });

      const result = await runFeedConsumer([
        {
          id: 'fd-fallback',
          tweetId: 'legacy-shared-1',
          url: 'https://x.com/alice/status/legacy-shared-1',
          text: 'Practical AI agents and tooling for code review',
          authorHandle: 'alice',
          authorName: 'Alice',
          postedAt: '2026-04-13T00:00:00Z',
          syncedAt: '2026-04-13T00:00:00Z',
          links: ['https://blog.example.com/practical-agents'],
          tags: [],
          ingestedVia: 'graphql',
        },
      ], {
        candidateLimit: 1,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });

      assert.equal(result.evaluated, 1);
      assert.equal(result.liked, 0);
      assert.equal(result.bookmarked, 0);
      assert.equal(result.skipped, 1);
      assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 0);
      assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 0);

      const logs = await listFeedAgentLog(5);
      assert.equal(logs.some((entry) => entry.tweetId === 'legacy-shared-1' && entry.actions.like === 'already-done'), true);
      assert.equal(logs.some((entry) => entry.tweetId === 'legacy-shared-1' && entry.actions.bookmark === 'already-done'), true);
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  });
});

test('runFeedConsumer respects candidateLimit 0 as a no-op', async () => {
  await withAgentData(async (_dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    try {
      const result = await runFeedConsumer(FEED, {
        candidateLimit: 0,
        dryRun: true,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });

      assert.equal(result.evaluated, 0);
      assert.equal(result.liked, 0);
      assert.equal(result.bookmarked, 0);
      assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 0);
      assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 0);
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  });
});

test('runFeedConsumer logs semantic errors per item instead of aborting the run', async () => {
  await withAgentData(async (_dir, _origin, requests) => {
    const result = await consumeFeedItems(FEED, {
      candidateLimit: 2,
      dryRun: true,
    });

    assert.equal(result.evaluated, 2);
    assert.equal(result.failed, 2);
    assert.equal(result.skipped, 2);
    assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 0);
    assert.equal(requests.filter((url) => url.includes('/CreateBookmark')).length, 0);

    const logs = await listFeedAgentLog(5);
    assert.equal(logs.every((entry) => entry.decision === 'error'), true);
    assert.equal(logs.every((entry) => /Semantic vector missing/.test(entry.error ?? '')), true);
  });
});

test('runFeedConsumer records retry metadata when an action succeeds after a transient failure', async () => {
  await withAgentData(async (_dir, origin, requests) => {
    process.env.FT_X_API_ORIGIN = origin;
    process.env.FT_EMBEDDING_API_KEY = 'test-key';
    process.env.FT_EMBEDDING_BASE_URL = origin;
    try {
      const result = await runFeedConsumer([FEED[0]!], {
        candidateLimit: 1,
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token; auth_token=auth',
      });

      assert.equal(result.liked, 1);
      assert.equal(result.bookmarked, 1);
      assert.equal(result.actionRetries, 1);
      assert.equal(requests.filter((url) => url.includes('/FavoriteTweet')).length, 2);

      const logs = await listFeedAgentLog(5);
      assert.equal(logs[0]?.actionDetails?.like?.attempts, 2);
      assert.equal(logs[0]?.actions.like, 'applied');
    } finally {
      delete process.env.FT_X_API_ORIGIN;
      delete process.env.FT_EMBEDDING_API_KEY;
      delete process.env.FT_EMBEDDING_BASE_URL;
    }
  }, { favoriteStatuses: [500, 200] });
});
