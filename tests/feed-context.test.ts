import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { writeJsonLines } from '../src/fs.js';
import { readFeedConversationBundle, readFeedConversationState } from '../src/feed-context-store.js';
import { syncFeedConversationContext } from '../src/feed-context.js';
import type { FeedRecord } from '../src/types.js';

const NOW = '2026-04-24T08:00:00.000Z';

function makeFeedRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  return {
    id: '100',
    tweetId: '100',
    url: 'https://x.com/source/status/100',
    text: 'root tweet',
    authorHandle: 'source',
    syncedAt: NOW,
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeConversationResponse(rootId: string, replyId: string) {
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries: [
              {
                entryId: `tweet-${rootId}`,
                content: {
                  itemContent: {
                    itemType: 'TimelineTweet',
                    tweet_results: {
                      result: {
                        rest_id: rootId,
                        core: { user_results: { result: { rest_id: '1', core: { screen_name: 'source', name: 'Source' } } } },
                        legacy: {
                          id_str: rootId,
                          full_text: 'root',
                          created_at: 'Thu Apr 24 07:00:00 +0000 2026',
                          conversation_id_str: rootId,
                        },
                      },
                    },
                  },
                },
              },
              {
                entryId: `tweet-${replyId}`,
                content: {
                  itemContent: {
                    itemType: 'TimelineTweet',
                    tweet_results: {
                      result: {
                        rest_id: replyId,
                        core: { user_results: { result: { rest_id: '2', core: { screen_name: 'alice', name: 'Alice' } } } },
                        legacy: {
                          id_str: replyId,
                          full_text: `reply ${replyId}`,
                          created_at: 'Thu Apr 24 07:30:00 +0000 2026',
                          favorite_count: 3,
                          retweet_count: 1,
                          reply_count: 0,
                          quote_count: 0,
                          conversation_id_str: rootId,
                          in_reply_to_status_id_str: rootId,
                          lang: 'en',
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
  };
}

async function withFeedDir(records: FeedRecord[], fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-context-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeJsonLines(path.join(dir, 'feed.jsonl'), records);
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('syncFeedConversationContext collects and stores bounded recent feed conversations', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(makeConversationResponse('100', '200')), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    await withFeedDir([makeFeedRecord()], async () => {
      const result = await syncFeedConversationContext({
        limit: 1,
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      });

      assert.equal(result.stored, 1);
      assert.equal(result.totalReplies, 1);

      const bundle = await readFeedConversationBundle('100');
      assert.ok(bundle);
      assert.equal(bundle.replies[0].tweetId, '200');
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncFeedConversationContext --tweet-id limits collection to one local feed item', async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (input: RequestInfo | URL) => {
    calls += 1;
    if (String(input).includes('focalTweetId%22%3A%22101')) {
      return new Response(JSON.stringify(makeConversationResponse('101', '201')), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(makeConversationResponse('100', '200')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await withFeedDir([
      makeFeedRecord({ id: '100', tweetId: '100' }),
      makeFeedRecord({ id: '101', tweetId: '101', url: 'https://x.com/source/status/101' }),
    ], async () => {
      const result = await syncFeedConversationContext({
        tweetId: '101',
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      });

      assert.equal(result.requested, 1);
      assert.equal(result.stored, 1);
      assert.equal(calls, 1);
      assert.equal(await readFeedConversationBundle('100'), null);
      assert.ok(await readFeedConversationBundle('101'));
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncFeedConversationContext reruns refresh metadata without duplicating replies', async () => {
  const originalFetch = globalThis.fetch;
  let call = 0;
  globalThis.fetch = async () => {
    call += 1;
    return new Response(JSON.stringify(makeConversationResponse('100', '200')), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    await withFeedDir([makeFeedRecord()], async () => {
      await syncFeedConversationContext({
        limit: 1,
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      });
      await syncFeedConversationContext({
        limit: 1,
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      });

      const bundle = await readFeedConversationBundle('100');
      const state = await readFeedConversationState();
      assert.ok(bundle);
      assert.equal(bundle.replies.length, 1);
      assert.equal(state.records['100']?.replyCount, 1);
      assert.equal(call, 2);
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncFeedConversationContext returns guidance when local feed data is missing', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-feed-context-empty-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    await assert.rejects(
      () => syncFeedConversationContext({
        limit: 1,
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      }),
      /Run: ft feed sync/,
    );
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
