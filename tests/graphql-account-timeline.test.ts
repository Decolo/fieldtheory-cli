import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import {
  convertAccountTimelineTweetToRecord,
  mergeAccountTimelineRecords,
  parseAccountTimelineResponse,
  resolveAccountByHandleGraphQL,
  syncAccountTimelineGraphQL,
} from '../src/graphql-account-timeline.js';
import { readJson, readJsonLines, writeJson, writeJsonLines } from '../src/fs.js';

const NOW = '2026-04-19T08:00:00.000Z';

function toLegacyTwitterDate(date: Date): string {
  return date.toUTCString().replace(',', '').replace('GMT', '+0000');
}

function makeUserResult(overrides: Record<string, any> = {}) {
  return {
    rest_id: '44196397',
    core: { screen_name: 'elonmusk', name: 'Elon Musk' },
    avatar: { image_url: 'https://pbs.twimg.com/profile_images/example.jpg' },
    legacy: {
      description: 'Mars',
      followers_count: 200000000,
      friends_count: 500,
      location: 'Earth',
      verified: true,
    },
    is_blue_verified: true,
    ...overrides,
  };
}

function makeTweetResult(overrides: Record<string, any> = {}) {
  return {
    rest_id: '1900000000000000001',
    core: {
      user_results: {
        result: makeUserResult(),
      },
    },
    legacy: {
      id_str: '1900000000000000001',
      full_text: 'launching something soon',
      created_at: 'Sun Apr 19 07:00:00 +0000 2026',
      favorite_count: 10,
      retweet_count: 2,
      reply_count: 3,
      quote_count: 1,
      conversation_id_str: '1900000000000000001',
      in_reply_to_status_id_str: '1800000000000000001',
      in_reply_to_user_id_str: '42',
      lang: 'en',
      entities: {
        urls: [{ expanded_url: 'https://example.com', url: 'https://t.co/x' }],
      },
    },
    views: { count: '99' },
    ...overrides,
  };
}

function makeEntry(tweet: any, overrides: Record<string, any> = {}) {
  return {
    entryId: `tweet-${tweet.rest_id}`,
    sortIndex: tweet.rest_id,
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

function makeTimelineResponse(entries: any[]) {
  return {
    data: {
      user: {
        result: {
          timeline_v2: {
            timeline: {
              instructions: [
                { type: 'TimelineAddEntries', entries },
              ],
            },
          },
        },
      },
    },
  };
}

test('resolveAccountByHandleGraphQL resolves one user from UserByScreenName response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      user: {
        result: makeUserResult(),
      },
    },
  }), { status: 200, headers: { 'content-type': 'application/json' } });

  try {
    const user = await resolveAccountByHandleGraphQL('@ElonMusk', { csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' });
    assert.equal(user.userId, '44196397');
    assert.equal(user.handle, 'elonmusk');
    assert.equal(user.name, 'Elon Musk');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('convertAccountTimelineTweetToRecord keeps replies from the target account', () => {
  const result = convertAccountTimelineTweetToRecord(makeTweetResult(), NOW, { targetUserId: '44196397' });
  assert.ok(result);
  assert.equal(result?.targetUserId, '44196397');
  assert.equal(result?.authorHandle, 'elonmusk');
  assert.equal(result?.inReplyToStatusId, '1800000000000000001');
});

test('parseAccountTimelineResponse keeps target-account tweets and extracts cursor', () => {
  const ownTweet = makeTweetResult();
  const otherTweet = makeTweetResult({
    rest_id: '1900000000000000002',
    core: { user_results: { result: makeUserResult({ rest_id: '2', core: { screen_name: 'other', name: 'Other' } }) } },
    legacy: { ...makeTweetResult().legacy, id_str: '1900000000000000002', full_text: 'not target author' },
  });

  const result = parseAccountTimelineResponse(makeTimelineResponse([
    makeEntry(ownTweet),
    makeEntry(otherTweet),
    {
      entryId: 'cursor-bottom-1',
      content: { cursorType: 'Bottom', value: 'next-cursor' },
    },
  ]), { now: NOW, targetUserId: '44196397' });

  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].tweetId, '1900000000000000001');
  assert.equal(result.skippedEntries, 1);
  assert.equal(result.nextCursor, 'next-cursor');
});

test('mergeAccountTimelineRecords refreshes existing records without duplicating tweet ids', () => {
  const existing = [{
    id: '1900000000000000001',
    tweetId: '1900000000000000001',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    url: 'https://x.com/elonmusk/status/1900000000000000001',
    text: 'old',
    syncedAt: '2026-04-18T00:00:00.000Z',
    postedAt: '2026-04-18T00:00:00.000Z',
    authorHandle: 'elonmusk',
    tags: [],
    ingestedVia: 'graphql' as const,
  }];
  const incoming = [{
    ...existing[0],
    text: 'new',
    syncedAt: NOW,
  }];

  const merged = mergeAccountTimelineRecords(existing, incoming);
  assert.equal(merged.added, 0);
  assert.equal(merged.merged.length, 1);
  assert.equal(merged.merged[0].text, 'new');
});

test('mergeAccountTimelineRecords breaks same-second ties by newer tweet id', () => {
  const older = {
    id: '1900000000000000001',
    tweetId: '1900000000000000001',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    url: 'https://x.com/elonmusk/status/1900000000000000001',
    text: 'older',
    syncedAt: '2026-04-19T08:00:00.000Z',
    postedAt: 'Sun Apr 19 07:00:00 +0000 2026',
    authorHandle: 'elonmusk',
    tags: [],
    ingestedVia: 'graphql' as const,
  };
  const newer = {
    ...older,
    id: '1900000000000000002',
    tweetId: '1900000000000000002',
    url: 'https://x.com/elonmusk/status/1900000000000000002',
    text: 'newer',
  };

  const merged = mergeAccountTimelineRecords([older], [newer]);
  assert.equal(merged.merged[0].tweetId, '1900000000000000002');
});

test('syncAccountTimelineGraphQL writes account-local cache, meta, state, and registry', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-sync-'));
  process.env.FT_DATA_DIR = tmpDir;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input: RequestInfo | URL) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        data: { user: { result: makeUserResult() } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(makeTimelineResponse([
      makeEntry(makeTweetResult()),
      {
        entryId: 'cursor-bottom-1',
        content: { cursorType: 'Bottom', value: 'next-cursor' },
      },
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await syncAccountTimelineGraphQL('@elonmusk', {
      limit: 50,
      retain: '90d',
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });

    assert.equal(result.userId, '44196397');
    assert.equal(result.targetHandle, 'elonmusk');
    assert.equal(result.added, 1);
    assert.equal(result.totalItems, 1);

    const rows = await readJsonLines<any>(result.cachePath);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].targetUserId, '44196397');

    const meta = await readJson<any>(result.metaPath);
    assert.equal(meta.totalItems, 1);
    assert.equal(meta.targetHandle, 'elonmusk');

    const state = await readJson<any>(result.statePath);
    assert.equal(state.lastAdded, 1);
    assert.equal(state.latestTweetId, '1900000000000000001');

    const registry = await readJson<any>(path.join(tmpDir, 'accounts-registry.json'));
    assert.equal(registry.byHandle.elonmusk, '44196397');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('syncAccountTimelineGraphQL does not stop early when a page mixes skipped entries with a next cursor', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-sync-mixed-page-'));
  process.env.FT_DATA_DIR = tmpDir;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (_input: RequestInfo | URL) => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        data: { user: { result: makeUserResult() } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (calls === 2) {
      return new Response(JSON.stringify(makeTimelineResponse([
        makeEntry(makeTweetResult()),
        makeEntry(makeTweetResult({
          rest_id: '1900000000000000002',
          core: { user_results: { result: makeUserResult({ rest_id: '2', core: { screen_name: 'other', name: 'Other' } }) } },
          legacy: { ...makeTweetResult().legacy, id_str: '1900000000000000002', full_text: 'not target author' },
        })),
        {
          entryId: 'cursor-bottom-1',
          content: { cursorType: 'Bottom', value: 'next-cursor' },
        },
      ])), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(makeTimelineResponse([
      makeEntry(makeTweetResult({
        rest_id: '1900000000000000003',
        legacy: { ...makeTweetResult().legacy, id_str: '1900000000000000003', full_text: 'second page target tweet' },
      })),
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await syncAccountTimelineGraphQL('@elonmusk', {
      limit: 2,
      retain: '90d',
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });

    assert.equal(result.added, 2);
    assert.equal(result.totalItems, 2);
    assert.equal(calls, 3);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('syncAccountTimelineGraphQL rejects invalid retain values', async () => {
  await assert.rejects(
    () => syncAccountTimelineGraphQL('@elonmusk', {
      limit: 10,
      retain: 'forever',
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    }),
    /Invalid retention/,
  );
});

test('syncAccountTimelineGraphQL surfaces auth failures during account lookup', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('forbidden', { status: 403 });

  try {
    await assert.rejects(
      () => syncAccountTimelineGraphQL('@elonmusk', {
        limit: 10,
        retain: '90d',
        csrfToken: 'ct0',
        cookieHeader: 'ct0=ct0; auth_token=auth',
      }),
      /Account lookup unauthorized/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncAccountTimelineGraphQL reports stale stop reason when no newer tweets are added', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-sync-stale-'));
  process.env.FT_DATA_DIR = tmpDir;

  await mkdir(path.join(tmpDir, 'accounts', '44196397'), { recursive: true });
  const existingRecord = {
    id: '1900000000000000001',
    tweetId: '1900000000000000001',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    targetName: 'Elon Musk',
    url: 'https://x.com/elonmusk/status/1900000000000000001',
    text: 'launching something soon',
    authorHandle: 'elonmusk',
    authorName: 'Elon Musk',
    syncedAt: '2026-04-18T08:00:00.000Z',
    postedAt: 'Sun Apr 19 07:00:00 +0000 2026',
    links: [],
    tags: [],
    ingestedVia: 'graphql' as const,
  };
  await writeJsonLines(path.join(tmpDir, 'accounts', '44196397', 'timeline.jsonl'), [existingRecord]);
  await writeJson(path.join(tmpDir, 'accounts', '44196397', 'timeline-meta.json'), {
    provider: 'twitter',
    schemaVersion: 1,
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    targetName: 'Elon Musk',
    lastSyncAt: '2026-04-18T08:00:00.000Z',
    retention: '90d',
    totalItems: 1,
    latestTweetId: '1900000000000000001',
    latestTweetPostedAt: 'Sun Apr 19 07:00:00 +0000 2026',
    latestChanged: false,
  });

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        data: { user: { result: makeUserResult() } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(makeTimelineResponse([
      makeEntry(makeTweetResult()),
      {
        entryId: 'cursor-bottom-1',
        content: { cursorType: 'Bottom', value: 'next-cursor' },
      },
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await syncAccountTimelineGraphQL('@elonmusk', {
      limit: 50,
      retain: '90d',
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });

    assert.equal(result.added, 0);
    assert.equal(result.stopReason, 'no new tweets (stale)');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});

test('syncAccountTimelineGraphQL prunes records outside the retain window', async () => {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-sync-prune-'));
  process.env.FT_DATA_DIR = tmpDir;
  const oldPostedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
  const freshPostedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

  await mkdir(path.join(tmpDir, 'accounts', '44196397'), { recursive: true });
  await writeJsonLines(path.join(tmpDir, 'accounts', '44196397', 'timeline.jsonl'), [{
    id: '1',
    tweetId: '1',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    targetName: 'Elon Musk',
    url: 'https://x.com/elonmusk/status/1',
    text: 'old post',
    authorHandle: 'elonmusk',
    authorName: 'Elon Musk',
    syncedAt: '2026-04-01T08:00:00.000Z',
    postedAt: toLegacyTwitterDate(oldPostedAt),
    links: [],
    tags: [],
    ingestedVia: 'graphql' as const,
  }]);

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify({
        data: { user: { result: makeUserResult() } },
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    return new Response(JSON.stringify(makeTimelineResponse([
      makeEntry(makeTweetResult({
        rest_id: '1900000000000000009',
        legacy: {
          ...makeTweetResult().legacy,
          id_str: '1900000000000000009',
          created_at: toLegacyTwitterDate(freshPostedAt),
          full_text: 'new post',
        },
      })),
    ])), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    const result = await syncAccountTimelineGraphQL('@elonmusk', {
      limit: 10,
      retain: '1d',
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });

    assert.equal(result.pruned, 1);
    assert.equal(result.totalItems, 1);
    assert.equal(result.latestTweetId, '1900000000000000009');

    const rows = await readJsonLines<any>(result.cachePath);
    assert.deepEqual(rows.map((row) => row.tweetId), ['1900000000000000009']);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(tmpDir, { recursive: true, force: true });
  }
});
