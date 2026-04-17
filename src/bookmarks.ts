import { pathExists, readJson, readJsonLines } from './fs.js';
import { twitterBackfillStatePath, twitterBookmarksCachePath, twitterBookmarksMetaPath } from './paths.js';
import type { BookmarkBackfillState, BookmarkCacheMeta, BookmarkRecord } from './types.js';

type BookmarkApiTweet = {
  id: string;
  text?: string;
  author_id?: string;
  entities?: {
    urls?: Array<{ expanded_url?: string; url?: string }>;
  };
};

type BookmarkApiResponse = {
  data?: BookmarkApiTweet[];
  includes?: {
    users?: Array<{ id: string; username?: string; name?: string }>;
  };
};

function makeBookmark(record: Partial<BookmarkRecord> & Pick<BookmarkRecord, 'id' | 'tweetId' | 'url' | 'text'>): BookmarkRecord {
  return {
    id: record.id,
    tweetId: record.tweetId,
    url: record.url,
    text: record.text,
    authorHandle: record.authorHandle,
    authorName: record.authorName,
    bookmarkedAt: record.bookmarkedAt,
    syncedAt: record.syncedAt ?? new Date().toISOString(),
    media: record.media ?? [],
    links: record.links ?? [],
    tags: record.tags ?? [],
  };
}

export function normalizeBookmarkPage(page: BookmarkApiResponse, syncedAt: string): BookmarkRecord[] {
  const userMap = new Map<string, { username?: string; name?: string }>();
  for (const user of page.includes?.users ?? []) {
    userMap.set(String(user.id), { username: user.username, name: user.name });
  }

  return (page.data ?? []).map((tweet) => {
    const user = tweet.author_id ? userMap.get(String(tweet.author_id)) : undefined;
    const tweetId = String(tweet.id);
    return makeBookmark({
      id: tweetId,
      tweetId,
      url: `https://x.com/${user?.username ?? 'i'}/status/${tweetId}`,
      text: tweet.text ?? '',
      authorHandle: user?.username,
      authorName: user?.name,
      bookmarkedAt: null,
      syncedAt,
      links: (tweet.entities?.urls ?? []).map((u) => u.expanded_url ?? u.url ?? '').filter(Boolean),
    });
  });
}

export function latestBookmarkSyncAt(
  meta?: Pick<BookmarkCacheMeta, 'lastIncrementalSyncAt' | 'lastFullSyncAt'> | null,
): string | null {
  let latestValue: string | null = null;
  let latestTs = Number.NEGATIVE_INFINITY;

  for (const candidate of [meta?.lastIncrementalSyncAt, meta?.lastFullSyncAt]) {
    if (!candidate) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isFinite(parsed) || parsed <= latestTs) continue;
    latestTs = parsed;
    latestValue = candidate;
  }

  return latestValue;
}

export async function getTwitterBookmarksStatus(): Promise<BookmarkCacheMeta & { cachePath: string; metaPath: string }> {
  const cachePath = twitterBookmarksCachePath();
  const metaPath = twitterBookmarksMetaPath();
  const statePath = twitterBackfillStatePath();
  const meta = (await pathExists(metaPath))
    ? await readJson<BookmarkCacheMeta>(metaPath)
    : undefined;
  const state = (await pathExists(statePath))
    ? await readJson<BookmarkBackfillState>(statePath)
    : undefined;
  const metaUpdatedAt = latestBookmarkSyncAt(meta);
  const graphQlStatusIsNewer = Boolean(
    state?.lastRunAt && (!metaUpdatedAt || Date.parse(state.lastRunAt) > Date.parse(metaUpdatedAt))
  );

  if (!meta || graphQlStatusIsNewer) {
    const totalBookmarks = (await readJsonLines<BookmarkRecord>(cachePath)).length;
    return {
      provider: 'twitter',
      schemaVersion: meta?.schemaVersion ?? 1,
      lastFullSyncAt: meta?.lastFullSyncAt,
      lastIncrementalSyncAt: state?.lastRunAt ?? meta?.lastIncrementalSyncAt,
      totalBookmarks,
      cachePath,
      metaPath,
    };
  }

  return {
    ...meta,
    cachePath,
    metaPath,
  };
}
