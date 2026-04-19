import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { SemanticStore } from '../src/semantic-store.js';

test('SemanticStore upserts documents and searches nearest rows by source', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-semantic-store-'));
  const store = await SemanticStore.open(path.join(dir, 'semantic.lance'));

  try {
    await store.upsertDocuments([
      {
        id: 'like-1',
        source: 'likes',
        tweetId: 'like-1',
        url: 'https://x.com/alice/status/1',
        authorHandle: 'alice',
        authorName: 'Alice',
        postedAt: '2026-04-01T00:00:00Z',
        text: 'AI agents and code review',
        textHash: 'hash-1',
        embeddingVersion: 'aliyun-bailian:text-embedding-v4',
        vector: [1, 0],
      },
      {
        id: 'bookmark-1',
        source: 'bookmarks',
        tweetId: 'bookmark-1',
        url: 'https://x.com/bob/status/2',
        authorHandle: 'bob',
        authorName: 'Bob',
        postedAt: '2026-04-01T00:00:00Z',
        text: 'Databases and distributed systems',
        textHash: 'hash-2',
        embeddingVersion: 'aliyun-bailian:text-embedding-v4',
        vector: [0, 1],
      },
    ]);

    const likeHits = await store.searchDocuments([0.9, 0.1], 'likes', 3);
    const bookmarkHits = await store.searchDocuments([0.1, 0.9], 'bookmarks', 3);

    assert.equal(likeHits[0]?.id, 'like-1');
    assert.equal(bookmarkHits[0]?.id, 'bookmark-1');
    assert.equal(await store.countDocumentsBySource('likes'), 1);
    assert.equal(await store.countDocumentsBySource('bookmarks'), 1);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test('SemanticStore skips unchanged document rows and updates changed hashes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-semantic-store-'));
  const store = await SemanticStore.open(path.join(dir, 'semantic.lance'));

  try {
    await store.upsertDocuments([{
      id: 'feed-1',
      source: 'feed',
      tweetId: 'feed-1',
      url: 'https://x.com/carla/status/3',
      authorHandle: 'carla',
      authorName: 'Carla',
      postedAt: '2026-04-01T00:00:00Z',
      text: 'first text',
      textHash: 'hash-a',
      embeddingVersion: 'aliyun-bailian:text-embedding-v4',
      vector: [1, 0],
    }]);

    await store.upsertDocuments([{
      id: 'feed-1',
      source: 'feed',
      tweetId: 'feed-1',
      url: 'https://x.com/carla/status/3',
      authorHandle: 'carla',
      authorName: 'Carla',
      postedAt: '2026-04-01T00:00:00Z',
      text: 'first text',
      textHash: 'hash-a',
      embeddingVersion: 'aliyun-bailian:text-embedding-v4',
      vector: [0.5, 0.5],
    }]);

    let rows = await store.getDocumentsByIds(['feed-1']);
    assert.deepEqual(rows.get('feed-1')?.vector, [1, 0]);

    await store.upsertDocuments([{
      id: 'feed-1',
      source: 'feed',
      tweetId: 'feed-1',
      url: 'https://x.com/carla/status/3',
      authorHandle: 'carla',
      authorName: 'Carla',
      postedAt: '2026-04-01T00:00:00Z',
      text: 'second text',
      textHash: 'hash-b',
      embeddingVersion: 'aliyun-bailian:text-embedding-v4',
      vector: [0.5, 0.5],
    }]);

    rows = await store.getDocumentsByIds(['feed-1']);
    assert.equal(rows.get('feed-1')?.textHash, 'hash-b');
    assert.deepEqual(rows.get('feed-1')?.vector, [
      0.7071067690849304,
      0.7071067690849304,
    ]);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
});
