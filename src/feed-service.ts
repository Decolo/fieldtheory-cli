import { getTwitterFeedStatus, latestFeedSyncAt } from './feed.js';
import { countFeed } from './feed-db.js';
import type { FeedConversationBundle } from './types.js';

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

function summarizeReplyText(text: string, limit = 100): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length > limit ? `${compact.slice(0, limit - 3)}...` : compact;
}

export function formatFeedConversationSummary(bundle: FeedConversationBundle | null): string[] {
  if (!bundle) {
    return [
      'Conversation context',
      '  status: not collected',
    ];
  }

  const lines = [
    'Conversation context',
    `  status: ${bundle.outcome}`,
    `  target: ${bundle.targetKind === 'quoted_tweet' ? 'quoted tweet' : 'feed tweet'} ${bundle.conversationTweetId}`,
    `  replies: ${bundle.replies.length}`,
    `  fetched at: ${bundle.fetchedAt}`,
  ];
  if (bundle.unavailableReason) lines.push(`  unavailable reason: ${bundle.unavailableReason}`);
  if (bundle.summary) lines.push(`  summary: ${bundle.summary}`);
  if (bundle.replies.length > 0) {
    lines.push('  sample replies:');
    for (const reply of bundle.replies.slice(0, 3)) {
      lines.push(`    - @${reply.authorHandle ?? '?'} ${(reply.postedAt ?? reply.syncedAt)?.slice(0, 10) ?? '?'}`);
      lines.push(`      ${summarizeReplyText(reply.text)}`);
    }
  }
  return lines;
}
