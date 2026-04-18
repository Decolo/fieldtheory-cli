import { getTwitterFeedStatus, latestFeedSyncAt } from './feed.js';
import { countFeed } from './feed-db.js';

export interface FeedStatusView {
  itemCount: number;
  skippedEntries: number;
  lastUpdated: string | null;
  mode: string;
  cachePath: string;
}

export async function getFeedStatusView(): Promise<FeedStatusView> {
  const status = await getTwitterFeedStatus();
  let itemCount = status.totalItems;
  try {
    itemCount = await countFeed();
  } catch {}
  return {
    itemCount,
    skippedEntries: status.totalSkippedEntries,
    lastUpdated: latestFeedSyncAt(status),
    mode: 'Read-only Home timeline sync via browser session',
    cachePath: status.cachePath,
  };
}

export function formatFeedStatus(view: FeedStatusView): string {
  return [
    'Feed',
    `  items: ${view.itemCount}`,
    `  skipped entries: ${view.skippedEntries}`,
    `  last updated: ${view.lastUpdated ?? 'never'}`,
    `  sync mode: ${view.mode}`,
    `  cache: ${view.cachePath}`,
  ].join('\n');
}
