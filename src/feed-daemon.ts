import process from 'node:process';
import { appendLine, pathExists, readJson, writeJson } from './fs.js';
import { consumeFeedItems } from './feed-consumer.js';
import { fetchFeedItems } from './feed-fetcher.js';
import { syncSemanticIndexForRun } from './semantic-indexer.js';
import { twitterFeedDaemonLogPath, twitterFeedDaemonStatePath } from './paths.js';
import type { FeedDaemonState } from './types.js';
import type { XSessionOptions } from './x-graphql.js';

const FEED_DAEMON_SCHEMA_VERSION = 1;

export interface FeedDaemonRunOptions extends XSessionOptions {
  everyMs: number;
  maxPages?: number;
  candidateLimit?: number;
  likeThreshold?: number;
  bookmarkThreshold?: number;
  dryRun?: boolean;
}

function defaultState(): FeedDaemonState {
  return { schemaVersion: FEED_DAEMON_SCHEMA_VERSION };
}

async function writeDaemonLog(message: string): Promise<void> {
  await appendLine(twitterFeedDaemonLogPath(), `${new Date().toISOString()} ${message}`);
}

export async function getFeedDaemonState(): Promise<FeedDaemonState> {
  if (!(await pathExists(twitterFeedDaemonStatePath()))) return defaultState();
  return readJson<FeedDaemonState>(twitterFeedDaemonStatePath());
}

async function updateDaemonState(patch: Partial<FeedDaemonState>): Promise<FeedDaemonState> {
  const state = { ...(await getFeedDaemonState()), ...patch };
  await writeJson(twitterFeedDaemonStatePath(), state);
  return state;
}

async function waitFor(ms: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, ms);
    const stop = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', stop);
      process.removeListener('SIGTERM', stop);
    };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

function isPidRunning(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function formatFeedDaemonStatus(): Promise<string> {
  const state = await getFeedDaemonState();
  const running = isPidRunning(state.pid);
  return [
    'Feed Daemon',
    `  running: ${running ? 'yes' : 'no'}`,
    `  pid: ${state.pid ?? 'none'}`,
    `  interval: ${state.intervalMs ? `${Math.round(state.intervalMs / 1000)}s` : 'unknown'}`,
    `  started: ${state.startedAt ?? 'never'}`,
    `  last tick start: ${state.lastTickStartedAt ?? 'never'}`,
    `  last tick finish: ${state.lastTickFinishedAt ?? 'never'}`,
    `  last fetch added: ${state.lastFetchAdded ?? 0}`,
    `  last consumed: ${state.lastConsumed ?? 0}`,
    `  last auto-liked: ${state.lastLiked ?? 0}`,
    `  last auto-bookmarked: ${state.lastBookmarked ?? 0}`,
    `  last failed: ${state.lastFailed ?? 0}`,
    `  last error: ${state.lastError ?? 'none'}`,
    `  state: ${twitterFeedDaemonStatePath()}`,
    `  log: ${twitterFeedDaemonLogPath()}`,
  ].join('\n');
}

export async function stopFeedDaemon(): Promise<{ stopped: boolean; pid?: number }> {
  const state = await getFeedDaemonState();
  if (!isPidRunning(state.pid)) return { stopped: false, pid: state.pid };
  process.kill(state.pid!, 'SIGTERM');
  await updateDaemonState({ pid: undefined });
  await writeDaemonLog(`stop requested for pid=${state.pid}`);
  return { stopped: true, pid: state.pid };
}

export async function startFeedDaemon(options: FeedDaemonRunOptions): Promise<void> {
  if (isPidRunning((await getFeedDaemonState()).pid)) {
    throw new Error('Feed daemon is already running.');
  }

  await updateDaemonState({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    intervalMs: options.everyMs,
    lastError: undefined,
  });
  await writeDaemonLog(`started pid=${process.pid} intervalMs=${options.everyMs}`);

  while (true) {
    const tickStartedAt = new Date().toISOString();
    await updateDaemonState({ lastTickStartedAt: tickStartedAt });
    try {
      const fetched = await fetchFeedItems(options);
      await syncSemanticIndexForRun(fetched.newItems);
      const consumed = await consumeFeedItems(fetched.newItems, options);
      const tickFinishedAt = new Date().toISOString();
      await updateDaemonState({
        lastTickFinishedAt: tickFinishedAt,
        lastFetchAdded: fetched.added,
        lastFetchTotalItems: fetched.totalItems,
        lastConsumed: consumed.evaluated,
        lastLiked: consumed.liked,
        lastBookmarked: consumed.bookmarked,
        lastFailed: consumed.failed,
        lastError: undefined,
      });
      await writeDaemonLog(
        `tick ok fetch_added=${fetched.added} consumed=${consumed.evaluated} liked=${consumed.liked} bookmarked=${consumed.bookmarked} failed=${consumed.failed}`,
      );
    } catch (error) {
      const message = (error as Error).message;
      await updateDaemonState({
        lastTickFinishedAt: new Date().toISOString(),
        lastError: message,
      });
      await writeDaemonLog(`tick error ${message}`);
    }

    const shouldContinue = await waitFor(options.everyMs);
    if (!shouldContinue) {
      await writeDaemonLog(`stopped pid=${process.pid}`);
      await updateDaemonState({ pid: undefined });
      return;
    }
  }
}
