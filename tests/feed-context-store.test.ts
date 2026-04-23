import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  readFeedConversationBundle,
  readFeedConversationState,
  writeFeedConversationBundle,
} from '../src/feed-context-store.js';
import { twitterFeedContextBundlePath } from '../src/paths.js';
import type { FeedConversationBundle } from '../src/types.js';

function makeBundle(overrides: Partial<FeedConversationBundle> = {}): FeedConversationBundle {
  return {
    schemaVersion: 1,
    rootFeedTweetId: '100',
    rootFeedItemId: '100',
    conversationTweetId: '100',
    conversationId: '100',
    targetKind: 'feed_tweet',
    fetchedAt: '2026-04-24T08:00:00.000Z',
    outcome: 'success',
    replies: [
      {
        id: '200',
        tweetId: '200',
        url: 'https://x.com/replier/status/200',
        text: 'First reply',
        authorHandle: 'replier',
        syncedAt: '2026-04-24T08:00:00.000Z',
        postedAt: '2026-04-24T07:59:00.000Z',
        ingestedVia: 'graphql',
      },
    ],
    ...overrides,
  };
}

test('feed context bundle can be written and reloaded with state metadata', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-context-store-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeFeedConversationBundle(makeBundle());
    const bundle = await readFeedConversationBundle('100');
    const state = await readFeedConversationState();

    assert.ok(bundle);
    assert.equal(bundle.replies.length, 1);
    assert.equal(state.records['100']?.replyCount, 1);
    assert.equal(state.records['100']?.outcome, 'success');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('feed context bundle preserves root feed id when context targets quoted tweet', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-context-store-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeFeedConversationBundle(makeBundle({
      rootFeedTweetId: '100',
      rootFeedItemId: '100',
      conversationTweetId: '555',
      conversationId: '555',
      targetKind: 'quoted_tweet',
    }));

    const bundle = await readFeedConversationBundle('100');
    assert.ok(bundle);
    assert.equal(bundle.rootFeedTweetId, '100');
    assert.equal(bundle.conversationTweetId, '555');
    assert.equal(bundle.targetKind, 'quoted_tweet');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('feed context bundle stores replies with missing optional fields', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-context-store-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await writeFeedConversationBundle(makeBundle({
      replies: [
        {
          id: '201',
          tweetId: '201',
          url: 'https://x.com/replier/status/201',
          text: 'Sparse reply',
          syncedAt: '2026-04-24T08:00:00.000Z',
          ingestedVia: 'graphql',
        },
      ],
    }));

    const bundle = await readFeedConversationBundle('100');
    assert.ok(bundle);
    assert.equal(bundle.replies[0].authorHandle, undefined);
    assert.equal(bundle.replies[0].postedAt, undefined);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('feed context bundle read fails explicitly on malformed json', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-context-store-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    const filePath = twitterFeedContextBundlePath('broken');
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, '{not-json', 'utf8');
    await assert.rejects(() => readFeedConversationBundle('broken'));
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
