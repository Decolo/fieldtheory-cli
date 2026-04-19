import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { rememberAccountHandle } from '../src/account-registry.js';
import { exportAccountTimeline } from '../src/account-export.js';
import type { AccountTimelineRecord } from '../src/types.js';

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-export-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedAccountArchive(dir: string, records: AccountTimelineRecord[]): Promise<void> {
  await rememberAccountHandle({ userId: '44196397', handle: '@elonmusk', name: 'Elon Musk' });
  const accountDir = path.join(dir, 'accounts', '44196397');
  await mkdir(accountDir, { recursive: true });
  await writeFile(path.join(accountDir, 'timeline.jsonl'), records.map((row) => JSON.stringify(row)).join('\n') + '\n');
}

function fixture(overrides: Partial<AccountTimelineRecord> = {}): AccountTimelineRecord {
  return {
    id: '1',
    tweetId: '1',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    targetName: 'Elon Musk',
    url: 'https://x.com/elonmusk/status/1',
    text: 'launching something soon',
    authorHandle: 'elonmusk',
    authorName: 'Elon Musk',
    authorProfileImageUrl: 'https://example.com/avatar.jpg',
    syncedAt: '2026-04-19T08:00:00Z',
    postedAt: '2026-04-19T07:00:00Z',
    conversationId: 'c1',
    inReplyToStatusId: undefined,
    inReplyToUserId: undefined,
    quotedStatusId: '9',
    quotedTweet: {
      id: '9',
      text: 'quoted text',
      authorHandle: 'someone',
      authorName: 'Someone',
      postedAt: '2026-04-18T00:00:00Z',
      media: [],
      mediaObjects: [],
      url: 'https://x.com/someone/status/9',
    },
    language: 'en',
    sourceApp: 'web',
    possiblySensitive: false,
    engagement: {
      likeCount: 10,
      repostCount: 2,
      replyCount: 1,
      quoteCount: 0,
      bookmarkCount: 3,
      viewCount: 100,
    },
    media: ['https://example.com/media.jpg'],
    mediaObjects: [{
      type: 'photo',
      url: 'https://example.com/media.jpg',
    }],
    links: ['https://example.com'],
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

test('exportAccountTimeline returns only tweets inside the requested date range', async () => {
  await withDataDir(async (dir) => {
    await seedAccountArchive(dir, [
      fixture({ id: '1', tweetId: '1', postedAt: '2026-04-19T07:00:00Z' }),
      fixture({ id: '2', tweetId: '2', postedAt: '2026-03-01T07:00:00Z' }),
      fixture({ id: '3', tweetId: '3', postedAt: '2025-12-31T07:00:00Z' }),
    ]);

    const result = await exportAccountTimeline('@elonmusk', {
      after: '2026-01-01',
      before: '2026-04-01',
    });

    assert.equal(result.account.handle, 'elonmusk');
    assert.deepEqual(result.filters, { after: '2026-01-01', before: '2026-04-01' });
    assert.equal(result.count, 1);
    assert.equal(result.items[0]?.tweetId, '2');
  });
});

test('exportAccountTimeline preserves core research fields', async () => {
  await withDataDir(async (dir) => {
    await seedAccountArchive(dir, [fixture()]);

    const result = await exportAccountTimeline('@elonmusk');
    assert.equal(result.count, 1);
    assert.deepEqual(result.items[0], {
      id: '1',
      tweetId: '1',
      url: 'https://x.com/elonmusk/status/1',
      text: 'launching something soon',
      postedAt: '2026-04-19T07:00:00Z',
      syncedAt: '2026-04-19T08:00:00Z',
      targetUserId: '44196397',
      targetHandle: 'elonmusk',
      targetName: 'Elon Musk',
      authorHandle: 'elonmusk',
      authorName: 'Elon Musk',
      authorProfileImageUrl: 'https://example.com/avatar.jpg',
      conversationId: 'c1',
      inReplyToStatusId: undefined,
      inReplyToUserId: undefined,
      quotedStatusId: '9',
      quotedTweet: {
        id: '9',
        text: 'quoted text',
        authorHandle: 'someone',
        authorName: 'Someone',
        postedAt: '2026-04-18T00:00:00Z',
        media: [],
        mediaObjects: [],
        url: 'https://x.com/someone/status/9',
      },
      language: 'en',
      sourceApp: 'web',
      possiblySensitive: false,
      engagement: {
        likeCount: 10,
        repostCount: 2,
        replyCount: 1,
        quoteCount: 0,
        bookmarkCount: 3,
        viewCount: 100,
      },
      media: ['https://example.com/media.jpg'],
      mediaObjects: [{
        type: 'photo',
        url: 'https://example.com/media.jpg',
      }],
      links: ['https://example.com'],
    });
  });
});

test('exportAccountTimeline falls back to syncedAt when postedAt is missing', async () => {
  await withDataDir(async (dir) => {
    await seedAccountArchive(dir, [
      fixture({ id: '1', tweetId: '1', postedAt: null, syncedAt: '2026-04-19T08:00:00Z' }),
      fixture({ id: '2', tweetId: '2', postedAt: null, syncedAt: '2025-12-31T08:00:00Z' }),
    ]);

    const result = await exportAccountTimeline('@elonmusk', { after: '2026-01-01' });
    assert.equal(result.count, 1);
    assert.equal(result.items[0]?.tweetId, '1');
  });
});

test('exportAccountTimeline orders results newest first', async () => {
  await withDataDir(async (dir) => {
    await seedAccountArchive(dir, [
      fixture({ id: '1', tweetId: '1', postedAt: '2026-04-18T07:00:00Z' }),
      fixture({ id: '3', tweetId: '3', postedAt: '2026-04-19T07:00:00Z' }),
      fixture({ id: '2', tweetId: '2', postedAt: '2026-04-19T06:00:00Z' }),
    ]);

    const result = await exportAccountTimeline('@elonmusk');
    assert.deepEqual(result.items.map((item) => item.tweetId), ['3', '2', '1']);
  });
});

test('exportAccountTimeline fails for an unknown account', async () => {
  await withDataDir(async () => {
    await assert.rejects(
      () => exportAccountTimeline('@unknown'),
      /No local archive found/,
    );
  });
});

test('exportAccountTimeline fails fast on invalid date input', async () => {
  await withDataDir(async (dir) => {
    await seedAccountArchive(dir, [fixture()]);
    await assert.rejects(
      () => exportAccountTimeline('@elonmusk', { after: '04-19-2026' }),
      /Invalid after date/,
    );
  });
});
