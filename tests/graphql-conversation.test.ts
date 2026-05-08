import test from 'node:test';
import assert from 'node:assert/strict';
import {
  convertConversationTweetToReply,
  fetchConversationContext,
  parseConversationResponse,
  resolveConversationTarget,
} from '../src/graphql-conversation.js';
import type { FeedRecord } from '../src/types.js';

const NOW = '2026-04-24T08:00:00.000Z';

function makeTweetResult(overrides: Record<string, any> = {}) {
  return {
    rest_id: '1900000000000000001',
    core: {
      user_results: {
        result: {
          rest_id: '42',
          core: { screen_name: 'alice', name: 'Alice' },
          avatar: { image_url: 'https://pbs.twimg.com/profile_images/alice.jpg' },
          legacy: {
            description: 'builder',
            followers_count: 100,
            friends_count: 50,
            location: 'Shanghai',
            verified: false,
          },
        },
      },
    },
    legacy: {
      id_str: '1900000000000000001',
      full_text: 'reply text',
      created_at: 'Thu Apr 24 07:00:00 +0000 2026',
      favorite_count: 5,
      retweet_count: 1,
      reply_count: 2,
      quote_count: 0,
      bookmark_count: 0,
      conversation_id_str: '1800000000000000000',
      in_reply_to_status_id_str: '1800000000000000000',
      in_reply_to_user_id_str: '100',
      lang: 'en',
      entities: {
        urls: [{ expanded_url: 'https://example.com/reply', url: 'https://t.co/reply' }],
      },
    },
    views: { count: '25' },
    ...overrides,
  };
}

function makeEntry(tweet: any, overrides: Record<string, any> = {}) {
  return {
    entryId: `tweet-${tweet.rest_id}`,
    content: {
      itemContent: {
        itemType: 'TimelineTweet',
        tweet_results: { result: tweet },
      },
    },
    ...overrides,
  };
}

function makeConversationResponse(entries: any[]) {
  return {
    data: {
      threaded_conversation_with_injections_v2: {
        instructions: [
          {
            type: 'TimelineAddEntries',
            entries,
          },
        ],
      },
    },
  };
}

function makeRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  return {
    id: 'feed-1',
    tweetId: '1800000000000000000',
    url: 'https://x.com/source/status/1800000000000000000',
    text: 'root tweet',
    authorHandle: 'source',
    syncedAt: NOW,
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

test('convertConversationTweetToReply normalizes author, text, and linkage fields', () => {
  const reply = convertConversationTweetToReply(makeTweetResult(), NOW);
  assert.ok(reply);
  assert.equal(reply.authorHandle, 'alice');
  assert.equal(reply.text, 'reply text');
  assert.equal(reply.conversationId, '1800000000000000000');
  assert.equal(reply.inReplyToStatusId, '1800000000000000000');
  assert.equal(reply.engagement?.viewCount, 25);
});

test('resolveConversationTarget prefers quoted tweet when available', () => {
  const target = resolveConversationTarget(makeRecord({
    quotedStatusId: '555',
    quotedTweet: {
      id: '555',
      text: 'quoted',
      url: 'https://x.com/quoted/status/555',
    },
  }));

  assert.ok(target);
  assert.equal(target.targetKind, 'quoted_tweet');
  assert.equal(target.conversationTweetId, '555');
  assert.equal(target.rootFeedTweetId, '1800000000000000000');
});

test('parseConversationResponse keeps replies and excludes the root focal tweet', () => {
  const target = resolveConversationTarget(makeRecord())!;
  const result = parseConversationResponse(makeConversationResponse([
    makeEntry(makeTweetResult({
      rest_id: '1800000000000000000',
      legacy: { ...makeTweetResult().legacy, id_str: '1800000000000000000' },
    })),
    makeEntry(makeTweetResult()),
  ]), { now: NOW, target });

  assert.equal(result.outcome, 'success');
  assert.equal(result.replies.length, 1);
  assert.equal(result.replies[0].tweetId, '1900000000000000001');
});

test('parseConversationResponse returns unavailable outcome for deleted/protected responses', () => {
  const target = resolveConversationTarget(makeRecord())!;
  const deleted = parseConversationResponse({ errors: [{ message: 'Tweet not found' }] }, { now: NOW, target });
  const protectedResult = parseConversationResponse({ errors: [{ message: 'This Tweet is from a protected account' }] }, { now: NOW, target });

  assert.equal(deleted.outcome, 'unavailable');
  assert.equal(deleted.unavailableReason, 'deleted');
  assert.equal(protectedResult.unavailableReason, 'protected');
});

test('fetchConversationContext uses TweetDetail request and returns normalized bundle', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    assert.match(String(input), /\/i\/api\/graphql\/.+\/TweetDetail/);
    assert.equal(init?.headers && (init.headers as Record<string, string>).referer, 'https://x.com/source/status/1800000000000000000');
    return new Response(JSON.stringify(makeConversationResponse([
      makeEntry(makeTweetResult()),
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await fetchConversationContext(makeRecord(), {
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });
    assert.equal(result.outcome, 'success');
    assert.equal(result.replies.length, 1);
    assert.equal(result.rootFeedTweetId, '1800000000000000000');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchConversationContext follows TweetDetail bottom cursors', async () => {
  const originalFetch = globalThis.fetch;
  const seenUrls: string[] = [];
  globalThis.fetch = async (input: RequestInfo | URL) => {
    seenUrls.push(String(input));
    const page = seenUrls.length;
    return new Response(JSON.stringify({
      data: {
        threaded_conversation_with_injections_v2: {
          instructions: [{
            type: 'TimelineAddEntries',
            entries: [
              makeEntry(makeTweetResult({
                rest_id: `190000000000000000${page}`,
                legacy: {
                  ...makeTweetResult().legacy,
                  id_str: `190000000000000000${page}`,
                  full_text: `reply page ${page}`,
                },
              })),
              ...(page === 1 ? [{ entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: 'NEXT_PAGE' } }] : []),
            ],
          }],
        },
      },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await fetchConversationContext(makeRecord(), {
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });
    assert.equal(result.outcome, 'success');
    assert.equal(result.replies.length, 2);
    assert.equal(seenUrls.length, 2);
    assert.doesNotMatch(decodeURIComponent(seenUrls[0]), /"cursor":"NEXT_PAGE"/);
    assert.match(decodeURIComponent(seenUrls[1]), /"cursor":"NEXT_PAGE"/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchConversationContext marks partial when maxPages stops before next token', async () => {
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;
  globalThis.fetch = async () => {
    fetchCount += 1;
    return new Response(JSON.stringify(makeConversationResponse([
      makeEntry(makeTweetResult()),
      { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: 'NEXT_PAGE' } },
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await fetchConversationContext(makeRecord(), {
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
      maxPages: 1,
    });
    assert.equal(result.outcome, 'partial');
    assert.equal(result.replies.length, 1);
    assert.equal(fetchCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchConversationContext marks partial when maxReplies truncates a page', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(makeConversationResponse([
    makeEntry(makeTweetResult()),
    makeEntry(makeTweetResult({
      rest_id: '1900000000000000002',
      legacy: { ...makeTweetResult().legacy, id_str: '1900000000000000002', full_text: 'reply two' },
    })),
  ])), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const result = await fetchConversationContext(makeRecord(), {
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
      maxReplies: 1,
    });
    assert.equal(result.outcome, 'partial');
    assert.equal(result.replies.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchConversationContext surfaces auth failures as actionable errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('forbidden', { status: 403 });

  try {
    await assert.rejects(
      () => fetchConversationContext(makeRecord(), {
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      }),
      /unauthorized/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
