import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import {
  fetchFollowingPage,
  parseAuthenticatedUserResponse,
  parseFollowingResponse,
  resolveAuthenticatedXUser,
  syncFollowingSnapshot,
} from '../src/graphql-following.js';
import { readFollowingReviewState, readFollowingSnapshot } from '../src/following-review-state.js';

function viewerPayload() {
  return {
    data: {
      id: '111',
      username: 'me',
      name: 'Me',
    },
  };
}

function followingPayload() {
  return {
    data: [
      {
        id: '1',
        username: 'alice',
        name: 'Alice',
        protected: false,
        verified: true,
        description: 'writes about AI',
        profile_image_url: 'https://example.com/alice.jpg',
        public_metrics: {
          followers_count: 100,
          following_count: 50,
          tweet_count: 20,
        },
      },
      {
        id: '2',
        username: 'bob',
        name: 'Bob',
        protected: true,
        verified: false,
        public_metrics: {
          followers_count: 5,
          following_count: 10,
          tweet_count: 1,
        },
      },
    ],
    meta: {
      next_token: 'next-token',
    },
  };
}

function followingLastPagePayload() {
  return {
    data: [
      {
        id: '3',
        username: 'carol',
        name: 'Carol',
        protected: false,
        verified: false,
        public_metrics: {
          followers_count: 8,
          following_count: 20,
          tweet_count: 2,
        },
      },
    ],
    meta: {},
  };
}

test('parseAuthenticatedUserResponse normalizes the authenticated user', () => {
  const result = parseAuthenticatedUserResponse(viewerPayload());
  assert.equal(result.userId, '111');
  assert.equal(result.handle, 'me');
});

test('parseFollowingResponse normalizes followed accounts and preserves protected state', () => {
  const result = parseFollowingResponse(followingPayload(), {
    now: '2026-04-19T10:00:00Z',
    sourceUserId: '111',
  });
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts[0].userId, '1');
  assert.equal(result.accounts[1].state, 'protected');
  assert.equal(result.nextToken, 'next-token');
});

test('resolveAuthenticatedXUser maps auth failures to actionable errors', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('nope', { status: 401 });

  try {
    await assert.rejects(
      () => resolveAuthenticatedXUser({ csrfToken: 'ct0', cookieHeader: 'ct0=ct0; auth_token=auth' }),
      /Refresh your X session/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('fetchFollowingPage loads one following page with browser-session auth', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify(followingPayload()), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  try {
    const page = await fetchFollowingPage('111', {
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });
    assert.equal(page.accounts.length, 2);
    assert.equal(page.accounts[0].handle, 'alice');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('syncFollowingSnapshot persists a paginated following snapshot and state', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-following-sync-'));
  process.env.FT_DATA_DIR = dir;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify(viewerPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (calls === 2) {
      return new Response(JSON.stringify(followingPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(followingLastPagePayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await syncFollowingSnapshot({
      maxPages: 2,
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });
    assert.equal(result.sourceUserId, '111');
    assert.equal(result.totalFollowing, 3);
    assert.equal(result.isComplete, true);

    const rows = await readFollowingSnapshot();
    assert.equal(rows.length, 3);
    assert.equal(rows[0].sourceUserId, '111');

    const state = await readFollowingReviewState();
    assert.equal(state.sourceUserId, '111');
    assert.equal(state.followingSnapshotComplete, true);
    assert.equal(state.totalFollowing, 3);

    const raw = await readFile(path.join(dir, 'following', 'snapshot.jsonl'), 'utf8');
    assert.match(raw, /alice/);
    assert.match(raw, /carol/);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});

test('syncFollowingSnapshot marks partial fetches as incomplete without overwriting authoritative totals', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-following-sync-partial-'));
  process.env.FT_DATA_DIR = dir;

  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) {
      return new Response(JSON.stringify(viewerPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (calls === 2) {
      return new Response(JSON.stringify(followingPayload()), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify(followingLastPagePayload()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const initial = await syncFollowingSnapshot({
      maxPages: 2,
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });
    assert.equal(initial.isComplete, true);
    assert.equal(initial.totalFollowing, 3);

    calls = 0;
    const partial = await syncFollowingSnapshot({
      maxPages: 1,
      csrfToken: 'ct0',
      cookieHeader: 'ct0=ct0; auth_token=auth',
    });
    assert.equal(partial.isComplete, false);
    assert.equal(partial.totalFollowing, 3);
    assert.equal(partial.nextToken, 'next-token');

    const rows = await readFollowingSnapshot();
    assert.equal(rows.length, 3);
    assert.ok(rows.some((row) => row.handle === 'carol'));

    const state = await readFollowingReviewState();
    assert.equal(state.followingSnapshotComplete, false);
    assert.equal(state.totalFollowing, 3);
    assert.equal(state.lastCursor, 'next-token');
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
});
