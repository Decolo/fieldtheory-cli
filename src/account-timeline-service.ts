import { getAccountTimelineStatus } from './account-timeline.js';

export interface AccountTimelineStatusView {
  userId: string;
  handle: string;
  name?: string;
  totalItems: number;
  retention: string;
  lastUpdated: string | null;
  latestTweetId?: string;
  latestChanged: boolean;
  cachePath: string;
}

export async function getAccountTimelineStatusView(handle: string): Promise<AccountTimelineStatusView> {
  const status = await getAccountTimelineStatus(handle);
  return {
    userId: status.account.userId,
    handle: status.meta?.targetHandle ?? status.account.currentHandle,
    name: status.meta?.targetName ?? status.account.name,
    totalItems: status.meta?.totalItems ?? 0,
    retention: status.meta?.retention ?? '90d',
    lastUpdated: status.meta?.lastSyncAt ?? status.state?.lastRunAt ?? null,
    latestTweetId: status.meta?.latestTweetId,
    latestChanged: Boolean(status.meta?.latestChanged),
    cachePath: status.cachePath,
  };
}

export function formatAccountTimelineStatus(view: AccountTimelineStatusView): string {
  return [
    'Account timeline',
    `  account: @${view.handle}${view.name ? ` (${view.name})` : ''}`,
    `  user id: ${view.userId}`,
    `  total items: ${view.totalItems}`,
    `  retention: ${view.retention}`,
    `  last updated: ${view.lastUpdated ?? 'never'}`,
    `  latest tweet: ${view.latestTweetId ?? 'none'}`,
    `  latest changed: ${view.latestChanged ? 'yes' : 'no'}`,
    `  cache: ${view.cachePath}`,
  ].join('\n');
}
