import test from 'node:test';
import assert from 'node:assert/strict';
import { bookmarkTweet, likeTweet, unlikeTweet, unbookmarkTweet } from '../src/graphql-actions.js';

test('unlikeTweet posts the current X web mutation with tweet_id variables', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody = '';
  let requestHeaders: Headers | undefined;

  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? '');
    requestHeaders = new Headers(init?.headers as HeadersInit | undefined);
    return new Response(JSON.stringify({ data: { unfavorite_tweet: 'Done' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  process.env.FT_X_API_ORIGIN = 'https://x.test';

  try {
    const result = await unlikeTweet('123', {
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
    });

    assert.equal(result.operation, 'unlike');
    assert.match(requestUrl, /https:\/\/x\.test\/i\/api\/graphql\/ZYKSe-w7KEslx3JhSIk5LA\/UnfavoriteTweet$/);
    assert.deepEqual(JSON.parse(requestBody), {
      variables: { tweet_id: '123' },
      queryId: 'ZYKSe-w7KEslx3JhSIk5LA',
    });
    assert.equal(requestHeaders?.get('x-csrf-token'), 'ct0-token');
    assert.match(requestHeaders?.get('cookie') ?? '', /auth_token=auth/);
  } finally {
    delete process.env.FT_X_API_ORIGIN;
    globalThis.fetch = originalFetch;
  }
});

test('unbookmarkTweet maps auth failures to re-login guidance', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('forbidden', { status: 403 })) as typeof fetch;

  try {
    await assert.rejects(
      unbookmarkTweet('456', {
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token',
      }),
      /make sure you are logged in/i,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('likeTweet posts the current X web mutation with tweet_id variables', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody = '';
  let requestHeaders: Headers | undefined;

  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? '');
    requestHeaders = new Headers(init?.headers as HeadersInit | undefined);
    return new Response(JSON.stringify({ data: { favorite_tweet: 'Done' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  process.env.FT_X_API_ORIGIN = 'https://x.test';

  try {
    const result = await likeTweet('789', {
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
    });

    assert.equal(result.operation, 'like');
    assert.match(requestUrl, /https:\/\/x\.test\/i\/api\/graphql\/lI07N6Otwv1PhnEgXILM7A\/FavoriteTweet$/);
    assert.deepEqual(JSON.parse(requestBody), {
      variables: { tweet_id: '789' },
      queryId: 'lI07N6Otwv1PhnEgXILM7A',
    });
    assert.equal(requestHeaders?.get('x-twitter-client-language'), 'en');
    assert.equal(requestHeaders?.get('accept-language'), 'en-US,en;q=0.9');
    assert.equal(requestHeaders?.get('origin'), 'https://x.test');
    assert.equal(requestHeaders?.get('referer'), 'https://x.test/home');
  } finally {
    delete process.env.FT_X_API_ORIGIN;
    globalThis.fetch = originalFetch;
  }
});

test('bookmarkTweet accepts the current bookmark success payload', async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = '';
  let requestBody = '';
  let requestHeaders: Headers | undefined;

  process.env.FT_X_CLIENT_TRANSACTION_ID = 'txn-123';
  process.env.FT_X_API_ORIGIN = 'https://x.test';
  globalThis.fetch = (async (input, init) => {
    requestUrl = String(input);
    requestBody = String(init?.body ?? '');
    requestHeaders = new Headers(init?.headers as HeadersInit | undefined);
    return new Response(JSON.stringify({ data: { tweet_bookmark_put: 'Done' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await bookmarkTweet('999', {
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
    });
    assert.equal(result.operation, 'bookmark');
    assert.match(requestUrl, /https:\/\/x\.test\/i\/api\/graphql\/aoDbu3RHznuiSkQ9aNM67Q\/CreateBookmark$/);
    assert.deepEqual(JSON.parse(requestBody), {
      variables: { tweet_id: '999' },
      queryId: 'aoDbu3RHznuiSkQ9aNM67Q',
    });
    assert.equal(requestHeaders?.get('x-client-transaction-id'), 'txn-123');
    assert.equal(requestHeaders?.get('referer'), 'https://x.test/i/web/status/999');
  } finally {
    delete process.env.FT_X_CLIENT_TRANSACTION_ID;
    delete process.env.FT_X_API_ORIGIN;
    globalThis.fetch = originalFetch;
  }
});

test('bookmarkTweet treats already-bookmarked responses as success', async () => {
  const originalFetch = globalThis.fetch;
  process.env.FT_X_CLIENT_TRANSACTION_ID = 'txn-123';

  globalThis.fetch = (async () => new Response(JSON.stringify({
    data: {},
    errors: [{
      code: 139,
      path: ['tweet_bookmark_put'],
      message: 'already bookmarked',
    }],
  }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })) as typeof fetch;

  try {
    const result = await bookmarkTweet('999', {
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
    });
    assert.equal(result.operation, 'bookmark');
  } finally {
    delete process.env.FT_X_CLIENT_TRANSACTION_ID;
    globalThis.fetch = originalFetch;
  }
});

test('likeTweet retries a transient 500 before succeeding', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;

  globalThis.fetch = (async () => {
    requests += 1;
    if (requests === 1) {
      return new Response('temporary upstream error', { status: 500 });
    }
    return new Response(JSON.stringify({ data: { favorite_tweet: 'Done' } }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const result = await likeTweet('789', {
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
    });

    assert.equal(result.operation, 'like');
    assert.equal(result.attempts, 2);
    assert.equal(requests, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('unbookmarkTweet does not retry auth failures', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = (async () => {
    requests += 1;
    return new Response('forbidden', { status: 403 });
  }) as typeof fetch;

  try {
    await assert.rejects(
      unbookmarkTweet('456', {
        csrfToken: 'ct0-token',
        cookieHeader: 'ct0=ct0-token',
      }),
      /make sure you are logged in/i,
    );
    assert.equal(requests, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
