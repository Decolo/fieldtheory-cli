import { readJsonLines, pathExists, readJson } from './fs.js';
import { fetchFeedItems } from './feed-fetcher.js';
import { consumeFeedItems, type FeedConsumeOptions, type FeedConsumeResult } from './feed-consumer.js';
import { syncSemanticIndexForRun } from './semantic-indexer.js';
import {
  twitterFeedAgentLogPath,
  twitterFeedAgentStatePath,
  twitterFeedCachePath,
} from './paths.js';
import type { FeedAgentLogEntry, FeedAgentState, FeedRecord } from './types.js';
import type { XSessionOptions } from './x-graphql.js';

const DEFAULT_LIKE_THRESHOLD = 0.62;
const DEFAULT_BOOKMARK_THRESHOLD = 0.68;

export interface FeedAgentRunOptions extends XSessionOptions {
  maxPages?: number;
  delayMs?: number;
  maxMinutes?: number;
  candidateLimit?: number;
  dryRun?: boolean;
  likeThreshold?: number;
  bookmarkThreshold?: number;
}

export interface FeedAgentRunResult extends FeedConsumeResult {
  feedSync: {
    attempted: boolean;
    added: number;
    totalItems: number;
    stopReason?: string;
  };
}

export interface FeedAgentStatusView {
  totalRuns: number;
  totalEvaluated: number;
  totalLiked: number;
  totalBookmarked: number;
  lastRunAt: string | null;
  statePath: string;
  logPath: string;
  likeThreshold: number;
  bookmarkThreshold: number;
}

async function loadState(): Promise<FeedAgentState | null> {
  if (!(await pathExists(twitterFeedAgentStatePath()))) return null;
  return readJson<FeedAgentState>(twitterFeedAgentStatePath());
}

export async function listFeedAgentLog(limit = 20): Promise<FeedAgentLogEntry[]> {
  const entries = await readJsonLines<FeedAgentLogEntry>(twitterFeedAgentLogPath());
  return entries.slice(-Math.max(0, limit)).reverse();
}

export async function getFeedAgentStatusView(
  thresholds: { likeThreshold?: number; bookmarkThreshold?: number } = {},
): Promise<FeedAgentStatusView> {
  const state = await loadState();
  return {
    totalRuns: state?.totalRuns ?? 0,
    totalEvaluated: state?.totalEvaluated ?? 0,
    totalLiked: state?.totalLiked ?? 0,
    totalBookmarked: state?.totalBookmarked ?? 0,
    lastRunAt: state?.lastRunAt ?? null,
    statePath: twitterFeedAgentStatePath(),
    logPath: twitterFeedAgentLogPath(),
    likeThreshold: thresholds.likeThreshold ?? DEFAULT_LIKE_THRESHOLD,
    bookmarkThreshold: thresholds.bookmarkThreshold ?? DEFAULT_BOOKMARK_THRESHOLD,
  };
}

export function formatFeedAgentStatus(view: FeedAgentStatusView): string {
  return [
    'Feed Agent',
    `  runs: ${view.totalRuns}`,
    `  evaluated: ${view.totalEvaluated}`,
    `  auto-liked: ${view.totalLiked}`,
    `  auto-bookmarked: ${view.totalBookmarked}`,
    `  last run: ${view.lastRunAt ?? 'never'}`,
    `  thresholds: like=${view.likeThreshold.toFixed(2)} bookmark=${view.bookmarkThreshold.toFixed(2)}`,
    `  state: ${view.statePath}`,
    `  log: ${view.logPath}`,
  ].join('\n');
}

export function formatFeedAgentLog(entries: FeedAgentLogEntry[]): string {
  if (entries.length === 0) return 'No feed agent runs recorded yet.';
  return entries.map((entry) => {
    const likeDetail = entry.actionDetails?.like;
    const bookmarkDetail = entry.actionDetails?.bookmark;
    const formatAction = (
      name: 'like' | 'bookmark',
      status: FeedAgentLogEntry['actions']['like'],
      detail?: { attempts?: number; retryable?: boolean; errorKind?: string },
    ): string => {
      const bits: string[] = [];
      if ((detail?.attempts ?? 1) > 1) bits.push(`attempts=${detail?.attempts}`);
      if (status === 'failed' && detail?.errorKind) bits.push(`kind=${detail.errorKind}`);
      if (status === 'failed' && detail?.retryable != null) bits.push(`retryable=${detail.retryable ? 'yes' : 'no'}`);
      return bits.length > 0 ? `${name}=${status}(${bits.join(',')})` : `${name}=${status}`;
    };
    const actions = `${formatAction('like', entry.actions.like, likeDetail)} ${formatAction('bookmark', entry.actions.bookmark, bookmarkDetail)}`;
    const errorLine = entry.error ? `\n  error: ${entry.error}` : '';
    return `${entry.timestamp}  ${entry.decision}  ${entry.tweetId}  ${entry.authorHandle ? `@${entry.authorHandle}` : '@?'}  like=${entry.likeScore.toFixed(2)} bookmark=${entry.bookmarkScore.toFixed(2)}  ${actions}\n  ${entry.url}${errorLine}`;
  }).join('\n\n');
}

export async function runFeedConsumer(
  items: FeedRecord[],
  options: FeedConsumeOptions = {},
): Promise<FeedConsumeResult> {
  await syncSemanticIndexForRun(items);
  return consumeFeedItems(items, options);
}

export async function runFeedAgent(options: FeedAgentRunOptions = {}): Promise<FeedAgentRunResult> {
  let feedSync = {
    attempted: false,
    added: 0,
    totalItems: 0,
    stopReason: undefined as string | undefined,
  };
  let items: FeedRecord[] = [];

  if ((options.maxPages ?? 1) > 0) {
    const fetched = await fetchFeedItems(options);
    feedSync = {
      attempted: true,
      added: fetched.added,
      totalItems: fetched.totalItems,
      stopReason: fetched.stopReason,
    };
    items = fetched.newItems;
  } else {
    items = await readJsonLines<FeedRecord>(twitterFeedCachePath());
  }

  await syncSemanticIndexForRun(items);
  const consumeResult = await consumeFeedItems(items, options);
  return {
    ...consumeResult,
    feedSync: {
      ...feedSync,
      totalItems: feedSync.totalItems || items.length,
    },
  };
}
