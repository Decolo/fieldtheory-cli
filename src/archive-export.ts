import { normalizeDateInput } from './date-utils.js';
import {
  listBookmarkProjections,
  listFeedProjections,
  listLikeProjections,
  type BookmarkProjectionItem,
  type FeedProjectionItem,
  type LikeProjectionItem,
} from './archive-projections.js';
import type {
  ArchiveExportFilters,
  ArchiveExportItem,
  ArchiveExportPayload,
} from './types.js';

function normalizeExportFilters(filters: ArchiveExportFilters = {}): ArchiveExportFilters {
  const after = filters.after ? normalizeDateInput(filters.after, 'after') : undefined;
  const before = filters.before ? normalizeDateInput(filters.before, 'before') : undefined;
  if (after && before && after > before) {
    throw new Error(`Invalid date range: after (${after}) must be on or before before (${before}).`);
  }

  const limit = filters.limit == null ? undefined : Number(filters.limit);
  if (limit != null && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error(`Invalid limit: "${String(filters.limit)}". Limit must be greater than zero.`);
  }

  return {
    query: filters.query ? String(filters.query) : undefined,
    author: filters.author ? String(filters.author) : undefined,
    after,
    before,
    limit,
  };
}

function compactFilterRecord(filters: ArchiveExportFilters): Record<string, string | number> {
  return Object.fromEntries(
    Object.entries(filters).filter(([, value]) => value !== undefined),
  ) as Record<string, string | number>;
}

function buildPayload(
  resource: ArchiveExportPayload['resource'],
  items: ArchiveExportItem[],
  filters: ArchiveExportFilters,
): ArchiveExportPayload {
  return {
    resource,
    items,
    meta: {
      count: items.length,
      generatedAt: new Date().toISOString(),
      filters: compactFilterRecord(filters),
    },
  };
}

function mapBookmarkExportItem(item: BookmarkProjectionItem): ArchiveExportItem {
  return {
    id: item.id,
    tweetId: item.tweetId,
    url: item.url,
    text: item.text,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    postedAt: item.postedAt ?? null,
    collectedAt: item.bookmarkedAt ?? item.postedAt ?? null,
    source: 'bookmark',
    sourceDetails: {
      bookmarkedAt: item.bookmarkedAt ?? null,
      githubUrls: item.githubUrls,
      links: item.links,
      mediaCount: item.mediaCount,
      linkCount: item.linkCount,
      engagement: {
        likeCount: item.likeCount ?? null,
        repostCount: item.repostCount ?? null,
        replyCount: item.replyCount ?? null,
        quoteCount: item.quoteCount ?? null,
        bookmarkCount: item.bookmarkCount ?? null,
        viewCount: item.viewCount ?? null,
      },
    },
  };
}

function mapLikeExportItem(item: LikeProjectionItem): ArchiveExportItem {
  return {
    id: item.id,
    tweetId: item.tweetId,
    url: item.url,
    text: item.text,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    postedAt: item.postedAt ?? null,
    collectedAt: item.likedAt ?? item.postedAt ?? null,
    source: 'like',
    sourceDetails: {
      likedAt: item.likedAt ?? null,
      links: item.links,
      mediaCount: item.mediaCount,
      linkCount: item.linkCount,
      engagement: {
        likeCount: item.likeCount ?? null,
        repostCount: item.repostCount ?? null,
        replyCount: item.replyCount ?? null,
        quoteCount: item.quoteCount ?? null,
        bookmarkCount: item.bookmarkCount ?? null,
        viewCount: item.viewCount ?? null,
      },
    },
  };
}

function mapFeedExportItem(item: FeedProjectionItem): ArchiveExportItem {
  return {
    id: item.id,
    tweetId: item.tweetId,
    url: item.url,
    text: item.text,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    postedAt: item.postedAt ?? null,
    collectedAt: item.syncedAt,
    source: 'feed',
    sourceDetails: {
      syncedAt: item.syncedAt,
      sortIndex: item.sortIndex ?? null,
      fetchPage: item.fetchPage ?? null,
      fetchPosition: item.fetchPosition ?? null,
      links: item.links,
      mediaCount: item.mediaCount,
      linkCount: item.linkCount,
      engagement: {
        likeCount: item.likeCount ?? null,
        repostCount: item.repostCount ?? null,
        replyCount: item.replyCount ?? null,
        quoteCount: item.quoteCount ?? null,
        bookmarkCount: item.bookmarkCount ?? null,
        viewCount: item.viewCount ?? null,
      },
    },
  };
}

export async function exportBookmarks(filters: ArchiveExportFilters = {}): Promise<ArchiveExportPayload> {
  const normalized = normalizeExportFilters(filters);
  const items = (await listBookmarkProjections({
    query: normalized.query,
    author: normalized.author,
    after: normalized.after,
    before: normalized.before,
    limit: normalized.limit,
  })).map(mapBookmarkExportItem);
  return buildPayload('bookmarks', items, normalized);
}

export async function exportLikes(filters: ArchiveExportFilters = {}): Promise<ArchiveExportPayload> {
  const normalized = normalizeExportFilters(filters);
  const items = (await listLikeProjections({
    query: normalized.query,
    author: normalized.author,
    after: normalized.after,
    before: normalized.before,
    limit: normalized.limit,
  })).map(mapLikeExportItem);
  return buildPayload('likes', items, normalized);
}

export async function exportFeed(filters: ArchiveExportFilters = {}): Promise<ArchiveExportPayload> {
  const normalized = normalizeExportFilters(filters);
  const items = (await listFeedProjections({
    query: normalized.query,
    author: normalized.author,
    after: normalized.after,
    before: normalized.before,
    limit: normalized.limit,
  })).map(mapFeedExportItem);
  return buildPayload('feed', items, normalized);
}
