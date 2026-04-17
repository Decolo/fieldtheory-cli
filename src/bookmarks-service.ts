import { getTwitterBookmarksStatus, latestBookmarkSyncAt } from './bookmarks.js';
import { buildIndex, countBookmarks } from './bookmarks-db.js';
import { syncBookmarks } from './bookmark-sync.js';
import type { SyncProgress } from './graphql-bookmarks.js';

export interface BookmarkEnableResult {
  synced: boolean;
  bookmarkCount: number;
  indexedCount: number;
  cachePath: string;
  messageLines: string[];
}

export interface BookmarkStatusView {
  connected: boolean;
  bookmarkCount: number;
  lastUpdated: string | null;
  mode: string;
  cachePath: string;
}

export async function enableBookmarks(): Promise<BookmarkEnableResult> {
  const syncResult = await syncBookmarks({
    onProgress: (status: SyncProgress) => {
      if (status.page % 25 === 0 || status.done) {
        process.stderr.write(
          `\r[sync] page ${status.page} | ${status.totalFetched} fetched | ${status.newAdded} new${status.done ? ` | ${status.stopReason}\n` : ''}`
        );
      }
    },
  });

  const indexResult = await buildIndex();

  return {
    synced: true,
    bookmarkCount: syncResult.totalBookmarks,
    indexedCount: indexResult.recordCount,
    cachePath: syncResult.cachePath,
    messageLines: [
      'Bookmarks enabled.',
      `- sync completed: ${syncResult.totalBookmarks} bookmarks (${syncResult.added} new)`,
      `- indexed: ${indexResult.recordCount} records → ${indexResult.dbPath}`,
      `- cache: ${syncResult.cachePath}`,
    ],
  };
}

export async function getBookmarkStatusView(): Promise<BookmarkStatusView> {
  const status = await getTwitterBookmarksStatus();
  let bookmarkCount = status.totalBookmarks;
  try {
    bookmarkCount = await countBookmarks();
  } catch {}
  return {
    connected: true,
    bookmarkCount,
    lastUpdated: latestBookmarkSyncAt(status),
    mode: 'Primary: browser-session GraphQL',
    cachePath: status.cachePath,
  };
}

export function formatBookmarkStatus(view: BookmarkStatusView): string {
  return [
    'Bookmarks',
    `  bookmarks: ${view.bookmarkCount}`,
    `  last updated: ${view.lastUpdated ?? 'never'}`,
    `  sync mode: ${view.mode}`,
    `  cache: ${view.cachePath}`,
  ].join('\n');
}

export function formatBookmarkSummary(view: BookmarkStatusView): string {
  return `bookmarks=${view.bookmarkCount} updated=${view.lastUpdated ?? 'never'} mode="${view.mode}"`;
}
