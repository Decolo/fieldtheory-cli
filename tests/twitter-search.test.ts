import test from 'node:test';
import assert from 'node:assert/strict';
import { XRequestError } from '../src/x-graphql.js';
import { extractTweetIdFromUrl, searchRemoteTweets, searchTweetsGraphQL } from '../src/twitter-search.js';

function makeSearchTweetResult(id: string, overrides: Record<string, any> = {}) {
  return {
    rest_id: id,
    legacy: {
      id_str: id,
      full_text: `tweet ${id}`,
      created_at: 'Wed Apr 08 12:26:29 +0000 2026',
      entities: { urls: [] },
      ...overrides.legacy,
    },
    core: {
      user_results: {
        result: {
          rest_id: `user-${id}`,
          core: {
            screen_name: overrides.authorHandle ?? `user${id}`,
            name: overrides.authorName ?? `User ${id}`,
          },
        },
      },
    },
    ...overrides.tweet,
  };
}

function makeSearchTimelineResponse(tweetIds: string[], nextCursor?: string, options: { duplicateFirst?: boolean } = {}) {
  const tweetEntries = tweetIds.map((id, index) => ({
    entryId: `tweet-${id}-${index}`,
    content: {
      itemContent: {
        tweet_results: {
          result: makeSearchTweetResult(id),
        },
      },
    },
  }));

  if (options.duplicateFirst && tweetIds[0]) {
    tweetEntries.push({
      entryId: `tweet-duplicate-${tweetIds[0]}`,
      content: {
        itemContent: {
          tweet_results: {
            result: makeSearchTweetResult(tweetIds[0]),
          },
        },
      },
    });
  }

  const entries = nextCursor
    ? [
        ...tweetEntries,
        {
          entryId: `cursor-bottom-${nextCursor}`,
          content: {
            cursorType: 'Bottom',
            value: nextCursor,
          },
        },
      ]
    : tweetEntries;

  return {
    data: {
      search_by_raw_query: {
        search_timeline: {
          timeline: {
            instructions: [{ type: 'TimelineAddEntries', entries }],
          },
        },
      },
    },
  };
}

function makeModuleEntry(tweetIds: string[]) {
  return {
    entryId: 'module-1',
    content: {
      items: tweetIds.map((id, index) => ({
        item: {
          itemContent: {
            tweet_results: {
              result: makeSearchTweetResult(id, {
                authorHandle: `module${index}`,
              }),
            },
          },
        },
      })),
    },
  };
}

test('extractTweetIdFromUrl parses x.com status urls', () => {
  assert.equal(extractTweetIdFromUrl('https://x.com/karpathy/status/2039805659525644595'), '2039805659525644595');
  assert.equal(extractTweetIdFromUrl('https://example.com/nope'), null);
});

test('searchTweetsGraphQL maps top/live filters into SearchTimeline product values', async () => {
  const seenProducts: string[] = [];
  const fetchResource = async (input: string) => {
    const url = new URL(input);
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
    seenProducts.push(String(variables.product));
    return new Response(JSON.stringify(makeSearchTimelineResponse(['1001'])), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  await searchTweetsGraphQL(
    { query: 'mlcc', limit: 1, filter: 'live', csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
    { resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }), fetchResource, now: () => '2026-05-31T00:00:00.000Z' },
  );
  await searchTweetsGraphQL(
    { query: 'mlcc', limit: 1, filter: 'top', csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
    { resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }), fetchResource, now: () => '2026-05-31T00:00:00.000Z' },
  );

  assert.deepEqual(seenProducts, ['Latest', 'Top']);
});

test('searchTweetsGraphQL paginates, dedupes overlapping ids, and respects limit', async () => {
  const seenCounts: number[] = [];
  const seenCursors: Array<string | null> = [];
  const pages = [
    makeSearchTimelineResponse(
      Array.from({ length: 20 }, (_, index) => `1${String(index).padStart(2, '0')}`),
      'CURSOR_2',
      { duplicateFirst: true },
    ),
    makeSearchTimelineResponse(
      [
        '119',
        ...Array.from({ length: 19 }, (_, index) => `2${String(index).padStart(2, '0')}`),
      ],
      'CURSOR_3',
    ),
    makeSearchTimelineResponse(
      Array.from({ length: 20 }, (_, index) => `3${String(index).padStart(2, '0')}`),
    ),
  ];

  const fetchResource = async (input: string) => {
    const url = new URL(input);
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
    seenCounts.push(Number(variables.count));
    seenCursors.push(variables.cursor ?? null);
    const page = pages.shift();
    assert.ok(page, 'Expected another mock SearchTimeline page');
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const results = await searchTweetsGraphQL(
    { query: 'Samsung MLCC', limit: 50, filter: 'top', csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
    { resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }), fetchResource, now: () => '2026-05-31T00:00:00.000Z' },
  );

  assert.equal(results.length, 50);
  assert.equal(new Set(results.map((item) => item.tweetId)).size, 50);
  assert.deepEqual(seenCounts, [20, 20, 11]);
  assert.deepEqual(seenCursors, [null, 'CURSOR_2', 'CURSOR_3']);
});

test('searchTweetsGraphQL stops when cursor is exhausted before limit', async () => {
  const fetchResource = async () => new Response(JSON.stringify(makeSearchTimelineResponse(['1001', '1002'])), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const results = await searchTweetsGraphQL(
    { query: 'short query', limit: 5, csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
    { resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }), fetchResource, now: () => '2026-05-31T00:00:00.000Z' },
  );

  assert.equal(results.length, 2);
  assert.deepEqual(results.map((item) => item.tweetId), ['1001', '1002']);
});

test('searchTweetsGraphQL throws when SearchTimeline response is malformed', async () => {
  await assert.rejects(
    () => searchTweetsGraphQL(
      { query: 'bad response', limit: 1, csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
      {
        resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }),
        fetchResource: async () => new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
        now: () => '2026-05-31T00:00:00.000Z',
      },
    ),
    /SearchTimeline response missing/i,
  );
});

test('searchTweetsGraphQL follows TimelineReplaceEntry bottom cursors', async () => {
  const seenCursors: Array<string | null> = [];
  const pages = [
    {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [
                {
                  type: 'TimelineAddEntries',
                  entries: [{
                    entryId: 'tweet-1',
                    content: {
                      itemContent: {
                        tweet_results: { result: makeSearchTweetResult('1001') },
                      },
                    },
                  }],
                },
                {
                  type: 'TimelineReplaceEntry',
                  entry: {
                    entryId: 'cursor-bottom-replace',
                    content: {
                      cursorType: 'Bottom',
                      value: 'NEXT_CURSOR',
                    },
                  },
                },
              ],
            },
          },
        },
      },
    },
    makeSearchTimelineResponse(['1002']),
  ];

  const fetchResource = async (input: string) => {
    const url = new URL(input);
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
    seenCursors.push(variables.cursor ?? null);
    const page = pages.shift();
    assert.ok(page);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const results = await searchTweetsGraphQL(
    { query: 'replace entry cursor', limit: 2, csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
    { resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }), fetchResource, now: () => '2026-05-31T00:00:00.000Z' },
  );

  assert.deepEqual(seenCursors, [null, 'NEXT_CURSOR']);
  assert.deepEqual(results.map((item) => item.tweetId), ['1001', '1002']);
});

test('searchTweetsGraphQL extracts tweets from module items and operation cursors', async () => {
  const seenCursors: Array<string | null> = [];
  const pages = [
    {
      data: {
        search_by_raw_query: {
          search_timeline: {
            timeline: {
              instructions: [{
                type: 'TimelineAddEntries',
                entries: [
                  makeModuleEntry(['2001', '2002']),
                  {
                    entryId: 'cursor-bottom-operation',
                    content: {
                      operation: {
                        cursor: {
                          cursorType: 'Bottom',
                          value: 'OP_CURSOR',
                        },
                      },
                    },
                  },
                ],
              }],
            },
          },
        },
      },
    },
    makeSearchTimelineResponse(['2003']),
  ];

  const fetchResource = async (input: string) => {
    const url = new URL(input);
    const variables = JSON.parse(url.searchParams.get('variables') ?? '{}');
    seenCursors.push(variables.cursor ?? null);
    const page = pages.shift();
    assert.ok(page);
    return new Response(JSON.stringify(page), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  const results = await searchTweetsGraphQL(
    { query: 'module cursor', limit: 3, csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' },
    { resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }), fetchResource, now: () => '2026-05-31T00:00:00.000Z' },
  );

  assert.deepEqual(seenCursors, [null, 'OP_CURSOR']);
  assert.deepEqual(results.map((item) => item.tweetId), ['2001', '2002', '2003']);
});

test('searchRemoteTweets prefers GraphQL when auth is available', async () => {
  const result = await searchRemoteTweets(
    { query: 'Karpathy knowledge base', limit: 2 },
    {
      resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }),
      searchGraphql: async () => ([
        {
          tweetId: '2039805659525644595',
          url: 'https://x.com/karpathy/status/2039805659525644595',
          text: 'GraphQL result',
          authorHandle: 'karpathy',
          authorName: 'Andrej Karpathy',
          postedAt: '2026-05-31T00:00:00.000Z',
          status: 'ok',
        },
      ]),
      fetchRss: async () => {
        throw new Error('Bing fallback should not run when GraphQL succeeds');
      },
      fetchTweet: async () => {
        throw new Error('Syndication fallback should not run when GraphQL succeeds');
      },
      writeWarning: () => {},
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.text, 'GraphQL result');
});

test('searchRemoteTweets falls back to Bing RSS when auth is unavailable', async () => {
  const seenQueries: string[] = [];
  const result = await searchRemoteTweets(
    {
      query: 'Karpathy knowledge base',
      limit: 2,
    },
    {
      resolveAuth: () => {
        throw new Error('no auth');
      },
      searchGraphql: async () => {
        throw new Error('GraphQL should be skipped when auth is unavailable');
      },
      fetchRss: async (query: string) => {
        seenQueries.push(query);
        if (query === 'site:x.com/status Karpathy knowledge base') {
          return [
            '<?xml version="1.0"?>',
            '<rss><channel>',
            '<item><link>https://x.com/karpathy/status/2039805659525644595</link></item>',
            '<item><link>https://x.com/shannholmberg/status/2042264029427909083</link></item>',
            '</channel></rss>',
          ].join('');
        }
        return '<?xml version="1.0"?><rss><channel></channel></rss>';
      },
      fetchTweet: async (tweetId: string) => ({
        status: 'ok',
        snapshot: {
          id: tweetId,
          text: `tweet ${tweetId}`,
          authorHandle: tweetId === '2039805659525644595' ? 'karpathy' : 'shannholmberg',
          authorName: 'Author',
          postedAt: 'Wed Apr 08 12:26:29 +0000 2026',
          url: `https://x.com/i/status/${tweetId}`,
          media: [],
          mediaObjects: [],
        },
      }),
      writeWarning: () => {},
    },
  );

  assert.deepEqual(seenQueries, ['site:x.com/status Karpathy knowledge base']);
  assert.equal(result.length, 2);
  assert.equal(result[0]?.tweetId, '2039805659525644595');
  assert.equal(result[1]?.tweetId, '2042264029427909083');
});

test('searchRemoteTweets warns and falls back to Bing RSS on GraphQL rate limit', async () => {
  const warnings: string[] = [];
  const result = await searchRemoteTweets(
    { query: 'MLCC Samsung', limit: 1 },
    {
      resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }),
      searchGraphql: async () => {
        throw new XRequestError('rate limited', { kind: 'rate_limit', status: 429 });
      },
      fetchRss: async () => '<?xml version="1.0"?><rss><channel><item><link>https://x.com/mlcc/status/3001</link></item></channel></rss>',
      fetchTweet: async () => ({
        status: 'ok',
        snapshot: {
          id: '3001',
          text: 'Bing fallback result',
          authorHandle: 'mlcc',
          authorName: 'MLCC Author',
          postedAt: 'Wed Apr 08 12:26:29 +0000 2026',
          url: 'https://x.com/mlcc/status/3001',
          media: [],
          mediaObjects: [],
        },
      }),
      writeWarning: (message: string) => {
        warnings.push(message);
      },
    },
  );

  assert.equal(result.length, 1);
  assert.equal(result[0]?.tweetId, '3001');
  assert.deepEqual(warnings, ['GraphQL search rate-limited, falling back to Bing RSS; retry later']);
});

test('searchRemoteTweets surfaces authenticated auth failures instead of silently falling back', async () => {
  await assert.rejects(
    () => searchRemoteTweets(
      { query: 'auth failure', limit: 1 },
      {
        resolveAuth: () => ({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }),
        searchGraphql: async () => {
          throw new XRequestError('unauthorized', { kind: 'auth', status: 403 });
        },
        fetchRss: async () => {
          throw new Error('Bing fallback should not run for authenticated auth failures');
        },
        fetchTweet: async () => {
          throw new Error('Syndication fallback should not run for authenticated auth failures');
        },
        writeWarning: () => {},
      },
    ),
    /unauthorized/i,
  );
});
