import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  archiveItemFromBookmarkRecord,
  archiveItemFromFeedRecord,
  archiveItemFromLikeRecord,
  projectBookmarkRecord,
  projectFeedRecord,
  projectLikeRecord,
  upsertArchiveSourceAttachment,
} from '../src/archive-core.js';
import { twitterArchiveCachePath, twitterArchiveIndexPath } from '../src/paths.js';
import type { BookmarkRecord, FeedRecord, LikeRecord } from '../src/types.js';

const NOW = '2026-04-17T09:30:00.000Z';

function makeBookmarkRecord(overrides: Partial<BookmarkRecord> = {}): BookmarkRecord {
  return {
    id: 'tweet-1',
    tweetId: 'tweet-1',
    url: 'https://x.com/alice/status/tweet-1',
    text: '  Bookmark text with   spacing  ',
    authorHandle: 'alice',
    authorName: 'Alice',
    authorProfileImageUrl: 'https://img.test/alice.jpg',
    author: {
      id: 'user-1',
      handle: 'alice',
      name: 'Alice',
      bio: 'Builder',
      followerCount: 10,
      followingCount: 2,
      isVerified: true,
      snapshotAt: NOW,
    },
    postedAt: '2026-04-10T00:00:00.000Z',
    bookmarkedAt: '2026-04-15T00:00:00.000Z',
    sortIndex: '9000',
    syncedAt: NOW,
    conversationId: 'conv-1',
    inReplyToStatusId: 'reply-1',
    inReplyToUserId: 'user-2',
    quotedStatusId: 'quoted-1',
    quotedTweet: {
      id: 'quoted-1',
      text: 'Quoted',
      authorHandle: 'bob',
      url: 'https://x.com/bob/status/quoted-1',
    },
    language: 'en',
    sourceApp: 'web',
    possiblySensitive: false,
    engagement: {
      likeCount: 4,
      repostCount: 2,
      replyCount: 1,
      quoteCount: 0,
      bookmarkCount: 3,
      viewCount: 42,
    },
    media: ['https://img.test/1.jpg'],
    mediaObjects: [{ mediaUrl: 'https://img.test/1.jpg', type: 'photo', extAltText: 'sample' }],
    links: ['https://example.com/post'],
    tags: ['tag-1'],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function makeLikeRecord(overrides: Partial<LikeRecord> = {}): LikeRecord {
  return {
    id: 'tweet-2',
    tweetId: 'tweet-2',
    url: 'https://x.com/bob/status/tweet-2',
    text: 'Liked item',
    authorHandle: 'bob',
    authorName: 'Bob',
    likedAt: '2026-04-14T00:00:00.000Z',
    syncedAt: NOW,
    tags: [],
    ingestedVia: 'browser',
    ...overrides,
  };
}

function makeFeedRecord(overrides: Partial<FeedRecord> = {}): FeedRecord {
  return {
    id: 'tweet-3',
    tweetId: 'tweet-3',
    url: 'https://x.com/carol/status/tweet-3',
    text: 'Feed item',
    authorHandle: 'carol',
    authorName: 'Carol',
    syncedAt: NOW,
    sortIndex: '8000',
    fetchPage: 2,
    fetchPosition: 7,
    tags: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

test('archive core represents bookmark-only, like-only, and feed-only items', () => {
  const bookmarkItem = archiveItemFromBookmarkRecord(makeBookmarkRecord());
  const likeItem = archiveItemFromLikeRecord(makeLikeRecord());
  const feedItem = archiveItemFromFeedRecord(makeFeedRecord());

  assert.deepEqual(Object.keys(bookmarkItem.sourceAttachments), ['bookmark']);
  assert.deepEqual(Object.keys(likeItem.sourceAttachments), ['like']);
  assert.deepEqual(Object.keys(feedItem.sourceAttachments), ['feed']);
  assert.equal(bookmarkItem.normalizedText, 'Bookmark text with spacing');
});

test('archive core supports multi-source canonical items with preserved attachment metadata', () => {
  const bookmarkItem = archiveItemFromBookmarkRecord(makeBookmarkRecord({ id: 'tweet-9', tweetId: 'tweet-9' }));
  const likeItem = archiveItemFromLikeRecord(makeLikeRecord({ id: 'tweet-9', tweetId: 'tweet-9', url: bookmarkItem.url, text: bookmarkItem.text }));
  const feedItem = archiveItemFromFeedRecord(makeFeedRecord({ id: 'tweet-9', tweetId: 'tweet-9', url: bookmarkItem.url, text: bookmarkItem.text }));

  const multiSource = upsertArchiveSourceAttachment(
    upsertArchiveSourceAttachment(bookmarkItem, likeItem.sourceAttachments.like!),
    feedItem.sourceAttachments.feed!,
  );

  assert.deepEqual(Object.keys(multiSource.sourceAttachments).sort(), ['bookmark', 'feed', 'like']);
  assert.equal(multiSource.sourceAttachments.bookmark?.orderingKey, '9000');
  assert.equal(multiSource.sourceAttachments.bookmark?.sourceTimestamp, '2026-04-15T00:00:00.000Z');
  assert.equal(multiSource.sourceAttachments.like?.sourceTimestamp, '2026-04-14T00:00:00.000Z');
  assert.equal(multiSource.sourceAttachments.feed?.fetchPage, 2);
  assert.equal(multiSource.sourceAttachments.feed?.fetchPosition, 7);
  assert.deepEqual(multiSource.sourceAttachments.feed?.metadata, {
    sortIndex: '8000',
    fetchPage: 2,
    fetchPosition: 7,
  });
});

test('compatibility projections remain lossless for current bookmark, like, and feed consumers', () => {
  const bookmark = makeBookmarkRecord();
  const like = makeLikeRecord();
  const feed = makeFeedRecord();

  assert.deepEqual(projectBookmarkRecord(archiveItemFromBookmarkRecord(bookmark)), {
    ...bookmark,
    normalizedText: 'Bookmark text with spacing',
  });
  assert.deepEqual(projectLikeRecord(archiveItemFromLikeRecord(like)), {
    ...like,
    normalizedText: 'Liked item',
  });
  assert.deepEqual(projectFeedRecord(archiveItemFromFeedRecord(feed)), {
    ...feed,
    normalizedText: 'Feed item',
  });
});

test('compatibility projections preserve sparse source-specific fields as undefined', () => {
  const sparseBookmark: BookmarkRecord = {
    id: 'tweet-sparse-bookmark',
    tweetId: 'tweet-sparse-bookmark',
    url: 'https://x.com/sparse/status/tweet-sparse-bookmark',
    text: 'Sparse bookmark',
    syncedAt: NOW,
  };
  const sparseLike: LikeRecord = {
    id: 'tweet-sparse-like',
    tweetId: 'tweet-sparse-like',
    url: 'https://x.com/sparse/status/tweet-sparse-like',
    text: 'Sparse like',
    syncedAt: NOW,
  };
  const sparseFeed: FeedRecord = {
    id: 'tweet-sparse-feed',
    tweetId: 'tweet-sparse-feed',
    url: 'https://x.com/sparse/status/tweet-sparse-feed',
    text: 'Sparse feed',
    syncedAt: NOW,
  };

  const bookmarkRoundTrip = projectBookmarkRecord(archiveItemFromBookmarkRecord(sparseBookmark));
  const likeRoundTrip = projectLikeRecord(archiveItemFromLikeRecord(sparseLike));
  const feedRoundTrip = projectFeedRecord(archiveItemFromFeedRecord(sparseFeed));

  assert.deepEqual(bookmarkRoundTrip, {
    ...sparseBookmark,
    normalizedText: 'Sparse bookmark',
  });
  assert.deepEqual(likeRoundTrip, {
    ...sparseLike,
    normalizedText: 'Sparse like',
  });
  assert.deepEqual(feedRoundTrip, {
    ...sparseFeed,
    normalizedText: 'Sparse feed',
  });
  assert.equal('bookmarkedAt' in bookmarkRoundTrip, false);
  assert.equal('sortIndex' in bookmarkRoundTrip, false);
  assert.equal('likedAt' in likeRoundTrip, false);
  assert.equal('sortIndex' in feedRoundTrip, false);
  assert.equal('fetchPage' in feedRoundTrip, false);
  assert.equal('fetchPosition' in feedRoundTrip, false);
});

test('compatibility projections preserve normalizedText on round-trip', () => {
  const bookmark = makeBookmarkRecord({
    normalizedText: 'already normalized bookmark text',
  });
  const like = makeLikeRecord({
    normalizedText: 'already normalized like text',
  });
  const feed = makeFeedRecord({
    normalizedText: 'already normalized feed text',
  });

  assert.deepEqual(projectBookmarkRecord(archiveItemFromBookmarkRecord(bookmark)), bookmark);
  assert.deepEqual(projectLikeRecord(archiveItemFromLikeRecord(like)), like);
  assert.deepEqual(projectFeedRecord(archiveItemFromFeedRecord(feed)), feed);
});

test('archive path helpers add future unified cache and index locations without touching legacy paths', () => {
  process.env.FT_DATA_DIR = '/tmp/ft-archive-core-test';
  try {
    assert.equal(twitterArchiveCachePath(), path.join('/tmp/ft-archive-core-test', 'archive.jsonl'));
    assert.equal(twitterArchiveIndexPath(), path.join('/tmp/ft-archive-core-test', 'archive.db'));
  } finally {
    delete process.env.FT_DATA_DIR;
  }
});
