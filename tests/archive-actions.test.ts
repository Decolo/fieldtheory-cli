import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import {
  loadArchiveStore,
  rebuildArchiveStoreFromCaches,
} from '../src/archive-store.js';
import { countArchiveItems, getArchiveItemByTweetId, listArchiveSources } from '../src/archive-index.js';
import {
  removeBookmarkFromArchive,
  removeLikeFromArchive,
  removeLikesFromArchive,
  upsertBookmarkInArchive,
  upsertBookmarksInArchive,
  upsertLikeInArchive,
  upsertLikesInArchive,
} from '../src/archive-actions.js';
import { buildIndex, getBookmarkById } from '../src/bookmarks-db.js';
import { buildLikesIndex, getLikeById } from '../src/likes-db.js';
import { writeJson } from '../src/fs.js';

const BOOKMARK_FIXTURE = {
  id: 'b1',
  tweetId: 'b1',
  url: 'https://x.com/alice/status/b1',
  text: 'Saved bookmark',
  authorHandle: 'alice',
  authorName: 'Alice',
  postedAt: '2026-03-01T00:00:00Z',
  bookmarkedAt: '2026-03-02T00:00:00Z',
  syncedAt: '2026-03-02T00:00:00Z',
  links: [],
  mediaObjects: [],
  tags: [],
  ingestedVia: 'graphql',
};

const LIKE_FIXTURE = {
  id: 'l1',
  tweetId: 'l1',
  url: 'https://x.com/bob/status/l1',
  text: 'Saved like',
  authorHandle: 'bob',
  authorName: 'Bob',
  postedAt: '2026-03-01T00:00:00Z',
  likedAt: '2026-03-03T00:00:00Z',
  syncedAt: '2026-03-03T00:00:00Z',
  links: [],
  mediaObjects: [],
  tags: [],
  ingestedVia: 'graphql',
};

const FEED_FIXTURE = {
  id: 'f1',
  tweetId: 'f1',
  url: 'https://x.com/carol/status/f1',
  text: 'Saved feed item',
  authorHandle: 'carol',
  authorName: 'Carol',
  postedAt: '2026-03-01T00:00:00Z',
  syncedAt: '2026-03-04T00:00:00Z',
  sortIndex: '10',
  fetchPage: 1,
  fetchPosition: 1,
  links: [],
  mediaObjects: [],
  tags: [],
  ingestedVia: 'graphql',
};

async function withArchiveData(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-archive-actions-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await writeFile(path.join(dir, 'bookmarks.jsonl'), `${JSON.stringify(BOOKMARK_FIXTURE)}\n`);
    await writeFile(path.join(dir, 'likes.jsonl'), `${JSON.stringify(LIKE_FIXTURE)}\n`);
    await writeFile(path.join(dir, 'feed.jsonl'), `${JSON.stringify(FEED_FIXTURE)}\n`);
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalBookmarks: 1,
    });
    await writeJson(path.join(dir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalLikes: 1,
    });
    await buildIndex({ force: true });
    await buildLikesIndex({ force: true });
    await rebuildArchiveStoreFromCaches({ forceIndex: true });
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('removeLikeFromArchive deletes the cached like and rebuilds the likes index', async () => {
  await withArchiveData(async () => {
    const result = await removeLikeFromArchive('l1');
    assert.equal(result.removed, true);
    assert.equal(result.totalRemaining, 0);
    assert.equal(await getLikeById('l1'), null);
    assert.equal(await countArchiveItems(), 2);
    assert.equal(await getArchiveItemByTweetId('l1'), null);
  });
});

test('removeBookmarkFromArchive deletes the cached bookmark and rebuilds the bookmarks index', async () => {
  await withArchiveData(async () => {
    const result = await removeBookmarkFromArchive('b1');
    assert.equal(result.removed, true);
    assert.equal(result.totalRemaining, 0);
    assert.equal(await getBookmarkById('b1'), null);
    assert.equal(await countArchiveItems(), 2);
    assert.equal(await getArchiveItemByTweetId('b1'), null);
  });
});

test('removeBookmarkFromArchive reports a missing local record without corrupting the archive', async () => {
  await withArchiveData(async () => {
    const result = await removeBookmarkFromArchive('missing');
    assert.equal(result.removed, false);
    assert.equal(result.totalRemaining, 1);
    assert.ok(await getBookmarkById('b1'));
  });
});

test('removeLikesFromArchive deletes multiple cached likes and rebuilds the index once', async () => {
  await withArchiveData(async (dir) => {
    const extra = {
      ...LIKE_FIXTURE,
      id: 'l2',
      tweetId: 'l2',
      url: 'https://x.com/bob/status/l2',
      text: 'Second saved like',
    };

    await writeFile(path.join(dir, 'likes.jsonl'), `${JSON.stringify(LIKE_FIXTURE)}\n${JSON.stringify(extra)}\n`);
    await writeJson(path.join(dir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalLikes: 2,
    });
    await buildLikesIndex({ force: true });

    const result = await removeLikesFromArchive(['l1', 'l2']);
    assert.deepEqual(result.removedIds.sort(), ['l1', 'l2']);
    assert.equal(result.totalRemaining, 0);
    assert.equal(await getLikeById('l1'), null);
    assert.equal(await getLikeById('l2'), null);
  });
});

test('removeLikesFromArchive treats tweetId matches as removed instead of missing', async () => {
  await withArchiveData(async (dir) => {
    const remapped = {
      ...LIKE_FIXTURE,
      id: 'internal-like-row',
      tweetId: 'tweet-123',
      url: 'https://x.com/bob/status/tweet-123',
    };

    await writeFile(path.join(dir, 'likes.jsonl'), `${JSON.stringify(remapped)}\n`);
    await writeJson(path.join(dir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalLikes: 1,
    });
    await buildLikesIndex({ force: true });

    const result = await removeLikesFromArchive(['tweet-123']);
    assert.deepEqual(result.removedIds, ['internal-like-row']);
    assert.deepEqual(result.missingIds, []);
    assert.equal(result.totalRemaining, 0);
  });
});

test('upsertLikeInArchive inserts a new like and rebuilds the likes index', async () => {
  await withArchiveData(async () => {
    const result = await upsertLikeInArchive({
      ...LIKE_FIXTURE,
      id: 'l2',
      tweetId: 'l2',
      url: 'https://x.com/bob/status/l2',
      text: 'New auto like',
      likedAt: '2026-03-04T00:00:00Z',
      syncedAt: '2026-03-04T00:00:00Z',
    });
    assert.equal(result.inserted, true);
    assert.equal(result.totalRecords, 2);
    assert.ok(await getLikeById('l2'));
  });
});

test('upsertBookmarkInArchive refreshes an existing bookmark instead of duplicating it', async () => {
  await withArchiveData(async () => {
    const result = await upsertBookmarkInArchive({
      ...BOOKMARK_FIXTURE,
      text: 'Updated bookmark text',
      bookmarkedAt: '2026-03-05T00:00:00Z',
      syncedAt: '2026-03-05T00:00:00Z',
    });
    assert.equal(result.inserted, false);
    const stored = await getBookmarkById('b1');
    assert.ok(stored);
    assert.equal(stored?.text, 'Updated bookmark text');
  });
});

test('upsertLikesInArchive inserts and updates likes in one rebuild', async () => {
  await withArchiveData(async () => {
    const result = await upsertLikesInArchive([
      {
        ...LIKE_FIXTURE,
        text: 'Updated saved like',
        syncedAt: '2026-03-04T00:00:00Z',
      },
      {
        ...LIKE_FIXTURE,
        id: 'l2',
        tweetId: 'l2',
        url: 'https://x.com/bob/status/l2',
        text: 'Second saved like',
        likedAt: '2026-03-04T00:00:00Z',
        syncedAt: '2026-03-04T00:00:00Z',
      },
    ]);

    assert.equal(result.insertedCount, 1);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.totalRecords, 2);
    assert.equal((await getLikeById('l1'))?.text, 'Updated saved like');
    assert.ok(await getLikeById('l2'));
  });
});

test('upsertLikeInArchive preserves richer existing records when incoming data is sparse', async () => {
  await withArchiveData(async () => {
    const result = await upsertLikeInArchive({
      id: 'l1',
      tweetId: 'l1',
      url: 'https://x.com/bob/status/l1',
      text: 'Sparse like refresh',
      authorHandle: 'bob',
      authorName: 'Bob',
      postedAt: '2026-03-01T00:00:00Z',
      likedAt: null,
      syncedAt: '2026-03-04T00:00:00Z',
      authorProfileImageUrl: 'https://img.example.com/bob.jpg',
      engagement: { likeCount: 10 },
      media: ['https://img.example.com/like.jpg'],
      mediaObjects: [{ type: 'photo', url: 'https://img.example.com/like.jpg' }],
      links: ['https://example.com/like'],
      author: { handle: 'bob', name: 'Bob' },
      language: 'en',
      quotedTweet: { id: 'ql1', text: 'Quoted like', url: 'https://x.com/q/status/ql1' },
      ingestedVia: 'graphql',
    });
    assert.equal(result.inserted, false);

    const sparseResult = await upsertLikeInArchive({
      id: 'l1',
      tweetId: 'l1',
      url: 'https://x.com/bob/status/l1',
      text: 'Sparse like refresh',
      authorHandle: 'bob',
      authorName: 'Bob',
      postedAt: '2026-03-01T00:00:00Z',
      likedAt: null,
      syncedAt: '2026-03-05T00:00:00Z',
      links: [],
      mediaObjects: [],
      tags: [],
      ingestedVia: 'browser',
    });

    assert.equal(sparseResult.inserted, false);
    const stored = await getLikeById('l1');
    assert.ok(stored);
    assert.equal(stored.text, 'Sparse like refresh');
    assert.equal(stored.likedAt, '2026-03-03T00:00:00Z');
    assert.equal(stored.mediaCount, 1);
    assert.equal(stored.linkCount, 1);
  });
});

test('upsertBookmarksInArchive inserts and updates bookmarks in one rebuild', async () => {
  await withArchiveData(async () => {
    const result = await upsertBookmarksInArchive([
      {
        ...BOOKMARK_FIXTURE,
        text: 'Updated bookmark text again',
        syncedAt: '2026-03-06T00:00:00Z',
        bookmarkedAt: '2026-03-06T00:00:00Z',
      },
      {
        ...BOOKMARK_FIXTURE,
        id: 'b2',
        tweetId: 'b2',
        url: 'https://x.com/alice/status/b2',
        text: 'Second bookmark',
        syncedAt: '2026-03-06T00:00:00Z',
        bookmarkedAt: '2026-03-06T00:00:00Z',
      },
    ]);

    assert.equal(result.insertedCount, 1);
    assert.equal(result.updatedCount, 1);
    assert.equal(result.totalRecords, 2);
    assert.equal((await getBookmarkById('b1'))?.text, 'Updated bookmark text again');
    assert.ok(await getBookmarkById('b2'));
  });
});

test('upsertBookmarkInArchive preserves richer existing records when incoming data is sparse', async () => {
  await withArchiveData(async () => {
    const result = await upsertBookmarkInArchive({
      id: 'b1',
      tweetId: 'b1',
      url: 'https://x.com/alice/status/b1',
      text: 'Sparse bookmark refresh',
      authorHandle: 'alice',
      authorName: 'Alice',
      postedAt: '2026-03-01T00:00:00Z',
      bookmarkedAt: '2026-03-05T00:00:00Z',
      syncedAt: '2026-03-05T00:00:00Z',
      authorProfileImageUrl: 'https://img.example.com/alice.jpg',
      engagement: { likeCount: 20 },
      media: ['https://img.example.com/bookmark.jpg'],
      mediaObjects: [{ type: 'photo', url: 'https://img.example.com/bookmark.jpg' }],
      links: ['https://example.com/bookmark'],
      author: { handle: 'alice', name: 'Alice' },
      language: 'en',
      quotedTweet: { id: 'qb1', text: 'Quoted bookmark', url: 'https://x.com/q/status/qb1' },
      ingestedVia: 'graphql',
    });
    assert.equal(result.inserted, false);

    const sparseResult = await upsertBookmarkInArchive({
      id: 'b1',
      tweetId: 'b1',
      url: 'https://x.com/alice/status/b1',
      text: 'Sparse bookmark refresh',
      authorHandle: 'alice',
      authorName: 'Alice',
      postedAt: '2026-03-01T00:00:00Z',
      bookmarkedAt: '2026-03-06T00:00:00Z',
      syncedAt: '2026-03-06T00:00:00Z',
      links: [],
      mediaObjects: [],
      tags: [],
      ingestedVia: 'browser',
    });

    assert.equal(sparseResult.inserted, false);
    const stored = await getBookmarkById('b1');
    assert.ok(stored);
    assert.equal(stored.text, 'Sparse bookmark refresh');
    assert.equal(stored.bookmarkedAt, '2026-03-05T00:00:00Z');
    assert.equal(stored.mediaCount, 1);
    assert.equal(stored.linkCount, 1);
  });
});

test('removeBookmarkFromArchive removes only the bookmark attachment for a multi-source item', async () => {
  await withArchiveData(async (dir) => {
    const sharedBookmark = {
      ...BOOKMARK_FIXTURE,
      id: 'bookmark-row',
      tweetId: 'tweet-shared',
      url: 'https://x.com/alice/status/tweet-shared',
      text: 'Shared item',
    };
    const sharedLike = {
      ...LIKE_FIXTURE,
      id: 'like-row',
      tweetId: 'tweet-shared',
      url: 'https://x.com/alice/status/tweet-shared',
      text: 'Shared item',
    };

    await writeFile(path.join(dir, 'bookmarks.jsonl'), `${JSON.stringify(sharedBookmark)}\n`);
    await writeFile(path.join(dir, 'likes.jsonl'), `${JSON.stringify(sharedLike)}\n`);
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalBookmarks: 1,
    });
    await writeJson(path.join(dir, 'likes-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalLikes: 1,
    });
    await buildIndex({ force: true });
    await buildLikesIndex({ force: true });
    await rebuildArchiveStoreFromCaches({ forceIndex: true });

    const result = await removeBookmarkFromArchive('tweet-shared');
    const archive = await loadArchiveStore();

    assert.equal(result.removed, true);
    assert.equal(await getBookmarkById('bookmark-row'), null);
    assert.ok(await getLikeById('like-row'));
    assert.equal(archive.length, 2);

    const shared = archive.find((item) => item.tweetId === 'tweet-shared');
    const indexed = await getArchiveItemByTweetId('tweet-shared');
    const sources = await listArchiveSources('tweet-shared');
    assert.ok(shared);
    assert.ok(indexed);
    assert.equal(shared?.sourceAttachments.bookmark, undefined);
    assert.ok(shared?.sourceAttachments.like);
    assert.equal(indexed?.sourceCount, 1);
    assert.deepEqual(indexed?.sources, ['like']);
    assert.deepEqual(sources.map((entry) => entry.source), ['like']);
  });
});

test('upsert bookmark and like operations converge on one canonical multi-source item', async () => {
  await withArchiveData(async () => {
    await upsertBookmarkInArchive({
      ...BOOKMARK_FIXTURE,
      id: 'bookmark-row',
      tweetId: 'tweet-shared',
      url: 'https://x.com/alice/status/tweet-shared',
      text: 'Shared item',
    });
    await upsertLikeInArchive({
      ...LIKE_FIXTURE,
      id: 'like-row',
      tweetId: 'tweet-shared',
      url: 'https://x.com/alice/status/tweet-shared',
      text: 'Shared item',
    });

    const archive = await loadArchiveStore();
    const shared = archive.find((item) => item.tweetId === 'tweet-shared');
    const indexed = await getArchiveItemByTweetId('tweet-shared');
    const sources = await listArchiveSources('tweet-shared');

    assert.ok(shared);
    assert.ok(indexed);
    assert.deepEqual(Object.keys(shared?.sourceAttachments ?? {}).sort(), ['bookmark', 'like']);
    assert.equal(indexed?.sourceCount, 2);
    assert.deepEqual(indexed?.sources, ['bookmark', 'like']);
    assert.deepEqual(sources.map((entry) => entry.source), ['bookmark', 'like']);
  });
});
