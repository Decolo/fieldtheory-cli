import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  convertHomeTimelineTweetToArchiveItem,
  convertHomeTimelineTweetToRecord,
  emitFeedArchiveItem,
  parseHomeTimelineResponse,
  mergeFeedRecord,
  mergeFeedRecords,
  syncFeedGraphQL,
} from '../src/graphql-feed.js';
import { loadArchiveStore, rebuildArchiveStoreFromCaches } from '../src/archive-store.js';
import { readJson, readJsonLines, writeJsonLines } from '../src/fs.js';
import type { BookmarkRecord, FeedRecord, LikeRecord } from '../src/types.js';

const NOW = '2026-04-12T14:00:00.000Z';

function makeTweetResult(overrides: Record<string, any> = {}) {
  return {
    rest_id: '2043312514902171702',
    core: {
      user_results: {
        result: {
          rest_id: '296593919',
          core: { screen_name: 'vikingmute', name: 'Viking' },
          avatar: { image_url: 'https://pbs.twimg.com/profile_images/725179208528322560/TPjU7qop_normal.jpg' },
          legacy: {
            description: 'builder',
            followers_count: 64701,
            friends_count: 279,
            location: 'Shanghai',
            verified: false,
          },
          is_blue_verified: true,
        },
      },
    },
    legacy: {
      id_str: '2043312514902171702',
      full_text: 'hello from the home timeline',
      created_at: 'Sun Apr 12 12:57:21 +0000 2026',
      favorite_count: 25,
      retweet_count: 7,
      reply_count: 0,
      quote_count: 0,
      bookmark_count: 31,
      conversation_id_str: '2043312514902171702',
      lang: 'zh',
      entities: {
        urls: [
          { expanded_url: 'https://example.com/post', url: 'https://t.co/abc' },
        ],
      },
      extended_entities: {
        media: [
          {
            type: 'photo',
            media_url_https: 'https://pbs.twimg.com/media/example.jpg',
            expanded_url: 'https://x.com/vikingmute/status/2043312514902171702/photo/1',
            original_info: { width: 1200, height: 800 },
            ext_alt_text: 'A test image',
          },
        ],
      },
    },
    views: { count: '1829' },
    ...overrides,
  };
}

function makeEntry(tweet: any, overrides: Record<string, any> = {}) {
  return {
    entryId: `tweet-${tweet.rest_id}`,
    sortIndex: '2043330774450569216',
    content: {
      __typename: 'TimelineTimelineItem',
      itemContent: {
        __typename: 'TimelineTweet',
        itemType: 'TimelineTweet',
        tweet_results: { result: tweet },
      },
    },
    ...overrides,
  };
}

function makeResponse(entries: any[]) {
  return {
    data: {
      home: {
        home_timeline_urt: {
          instructions: [
            {
              type: 'TimelineAddEntries',
              entries,
            },
          ],
        },
      },
    },
  };
}

function makeRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  return {
    id: '100',
    tweetId: '100',
    url: 'https://x.com/user/status/100',
    text: 'Test',
    syncedAt: NOW,
    sortIndex: '1000',
    fetchPage: 1,
    fetchPosition: 0,
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeBookmarkRecord(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: 'bookmark-1',
    tweetId: 'bookmark-1',
    url: 'https://x.com/user/status/bookmark-1',
    text: 'Bookmark text',
    syncedAt: NOW,
    bookmarkedAt: NOW,
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeLikeRecord(overrides: Partial<LikeRecord> = {}): LikeRecord {
  return {
    id: 'like-1',
    tweetId: 'like-1',
    url: 'https://x.com/user/status/like-1',
    text: 'Like text',
    syncedAt: NOW,
    likedAt: NOW,
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

test('convertHomeTimelineTweetToRecord builds a feed record with ordering fields', () => {
  const result = convertHomeTimelineTweetToRecord(makeTweetResult(), NOW, {
    sortIndex: '2043330774450569216',
    fetchPage: 1,
    fetchPosition: 0,
  });
  assert.ok(result);
  assert.equal(result.id, '2043312514902171702');
  assert.equal(result.authorHandle, 'vikingmute');
  assert.equal(result.sortIndex, '2043330774450569216');
  assert.equal(result.fetchPage, 1);
  assert.equal(result.fetchPosition, 0);
  assert.equal(result.engagement?.viewCount, 1829);
});

test('convertHomeTimelineTweetToArchiveItem emits canonical feed attachment metadata', () => {
  const result = convertHomeTimelineTweetToArchiveItem(makeTweetResult(), NOW, {
    sortIndex: '2043330774450569216',
    fetchPage: 1,
    fetchPosition: 0,
  });
  assert.ok(result);
  assert.equal(result?.id, '2043312514902171702');
  assert.equal(result?.normalizedText, 'hello from the home timeline');
  assert.equal(result?.sourceAttachments.feed?.source, 'feed');
  assert.equal(result?.sourceAttachments.feed?.orderingKey, '2043330774450569216');
  assert.equal(result?.sourceAttachments.feed?.fetchPage, 1);
  assert.equal(result?.sourceAttachments.feed?.fetchPosition, 0);
  assert.equal(result?.sourceAttachments.feed?.metadata?.sourceRecordId, '2043312514902171702');
});

test('emitFeedArchiveItem preserves feed ordering metadata', () => {
  const item = emitFeedArchiveItem(makeRecord({
    id: 'feed-row-1',
    tweetId: '888',
    text: 'feed text',
    sortIndex: '222',
    fetchPage: 3,
    fetchPosition: 4,
  }));

  assert.equal(item.id, '888');
  assert.equal(item.sourceAttachments.feed?.orderingKey, '222');
  assert.equal(item.sourceAttachments.feed?.fetchPage, 3);
  assert.equal(item.sourceAttachments.feed?.fetchPosition, 4);
  assert.equal(item.sourceAttachments.feed?.metadata?.sourceRecordId, 'feed-row-1');
});

test('parseHomeTimelineResponse keeps tweet entries, skips promoted and non-tweet entries, and extracts cursor', () => {
  const response = makeResponse([
    makeEntry(makeTweetResult()),
    makeEntry(makeTweetResult({ rest_id: '2042253137759588807', legacy: { ...makeTweetResult().legacy, id_str: '2042253137759588807' } }), {
      entryId: 'promoted-tweet-2042253137759588807-abc',
      sortIndex: '2043330774450569215',
    }),
    {
      entryId: 'module-1',
      content: {
        __typename: 'TimelineTimelineModule',
      },
    },
    {
      entryId: 'cursor-bottom-1',
      sortIndex: '2043330774450569181',
      content: {
        cursorType: 'Bottom',
        value: 'cursor-next',
      },
    },
  ]);

  const result = parseHomeTimelineResponse(response, { now: NOW, fetchPage: 2 });
  assert.equal(result.records.length, 1);
  assert.equal(result.skippedEntries, 2);
  assert.equal(result.nextCursor, 'cursor-next');
  assert.deepEqual(result.seenTweetIds, ['2043312514902171702']);
  assert.equal(result.records[0].fetchPage, 2);
});

test('mergeFeedRecord keeps richer content and refreshes latest feed order metadata', () => {
  const existing = makeRecord({
    text: 'old',
    syncedAt: '2026-04-11T00:00:00.000Z',
    sortIndex: '1000',
    fetchPage: 3,
    fetchPosition: 9,
  });
  const incoming = makeRecord({
    text: 'new',
    authorHandle: 'alice',
    syncedAt: '2026-04-12T00:00:00.000Z',
    sortIndex: '2000',
    fetchPage: 1,
    fetchPosition: 0,
  });
  const merged = mergeFeedRecord(existing, incoming);
  assert.equal(merged.text, 'new');
  assert.equal(merged.authorHandle, 'alice');
  assert.equal(merged.sortIndex, '2000');
  assert.equal(merged.fetchPage, 1);
});

test('mergeFeedRecords sorts by latest sync then feed order metadata', () => {
  const older = makeRecord({ id: '1', tweetId: '1', syncedAt: '2026-04-11T00:00:00.000Z', sortIndex: '1000', fetchPage: 1, fetchPosition: 0 });
  const newer = makeRecord({ id: '2', tweetId: '2', syncedAt: '2026-04-12T00:00:00.000Z', sortIndex: '999', fetchPage: 1, fetchPosition: 0 });
  const refreshed = makeRecord({ id: '1', tweetId: '1', syncedAt: '2026-04-13T00:00:00.000Z', sortIndex: '3000', fetchPage: 1, fetchPosition: 0 });
  const result = mergeFeedRecords([older, newer], [refreshed]);
  assert.deepEqual(result.merged.map((record) => record.id), ['1', '2']);
});

test('syncFeedGraphQL writes cache, meta, state, and index from mocked Home timeline pages', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-sync-feed-'));
  process.env.FT_DATA_DIR = tmpDir;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls += 1;
    if (calls === 1) {
      assert.equal(init?.method, undefined);
      return new Response(JSON.stringify(makeResponse([
        makeEntry(makeTweetResult()),
        {
          entryId: 'cursor-bottom-1',
          sortIndex: '2043330774450569181',
          content: { cursorType: 'Bottom', value: 'cursor-next' },
        },
      ])), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    assert.equal(init?.method, 'POST');
    return new Response(JSON.stringify(makeResponse([
      makeEntry(makeTweetResult({
        rest_id: '2043144280731259110',
        legacy: { ...makeTweetResult().legacy, id_str: '2043144280731259110', full_text: 'page two tweet' },
      }), { sortIndex: '2043330774450569214' }),
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;

  try {
    const result = await syncFeedGraphQL({
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
      maxPages: 2,
      delayMs: 0,
    });

    assert.equal(result.added, 2);
    assert.equal(result.totalItems, 2);
    const cache = await readJsonLines<FeedRecord>(path.join(tmpDir, 'feed.jsonl'));
    assert.equal(cache.length, 2);
    const meta = await readJson<any>(path.join(tmpDir, 'feed-meta.json'));
    assert.equal(meta.totalItems, 2);
    const state = await readJson<any>(path.join(tmpDir, 'feed-state.json'));
    assert.equal(state.totalStored, 2);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('rebuildArchiveStoreFromCaches merges one tweet across feed, likes, and bookmarks attachments', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-unified-archive-ingest-'));
  process.env.FT_DATA_DIR = tmpDir;

  try {
    const tweetId = 'shared-tweet';
    await writeJsonLines(path.join(tmpDir, 'feed.jsonl'), [
      makeRecord({
        id: 'feed-row-1',
        tweetId,
        url: `https://x.com/user/status/${tweetId}`,
        text: 'Shared tweet from feed',
        sortIndex: '400',
        fetchPage: 1,
        fetchPosition: 0,
      }),
    ]);
    await writeJsonLines(path.join(tmpDir, 'likes.jsonl'), [
      makeLikeRecord({
        id: 'like-row-1',
        tweetId,
        url: `https://x.com/user/status/${tweetId}`,
        text: 'Shared tweet from feed',
      }),
    ]);
    await writeJsonLines(path.join(tmpDir, 'bookmarks.jsonl'), [
      makeBookmarkRecord({
        id: 'bookmark-row-1',
        tweetId,
        url: `https://x.com/user/status/${tweetId}`,
        text: 'Shared tweet from feed',
      }),
    ]);

    const result = await rebuildArchiveStoreFromCaches({ forceIndex: true });
    const archive = await loadArchiveStore();
    const shared = archive.find((item) => item.tweetId === tweetId);

    assert.equal(result.totalItems, 1);
    assert.ok(shared);
    assert.equal(shared?.id, tweetId);
    assert.deepEqual(Object.keys(shared?.sourceAttachments ?? {}).sort(), ['bookmark', 'feed', 'like']);
    assert.equal(shared?.sourceAttachments.feed?.metadata?.sourceRecordId, 'feed-row-1');
    assert.equal(shared?.sourceAttachments.like?.metadata?.sourceRecordId, 'like-row-1');
    assert.equal(shared?.sourceAttachments.bookmark?.metadata?.sourceRecordId, 'bookmark-row-1');
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
