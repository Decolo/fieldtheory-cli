import process from 'node:process';
import { appendLine, pathExists, readJson, writeJson } from './fs.js';
import { EmbeddingConfigError, EmbeddingProviderError } from './embeddings.js';
import { consumeFeedItems } from './feed-consumer.js';
import { fetchFeedItems } from './feed-fetcher.js';
import { RemoteTweetActionError } from './graphql-actions.js';
import { syncSemanticIndexForRun } from './semantic-indexer.js';
import { twitterFeedDaemonLogPath, twitterFeedDaemonStatePath } from './paths.js';
import type { FeedDaemonErrorKind, FeedDaemonLastTick, FeedDaemonStage, FeedDaemonState } from './types.js';
import { XRequestError, sanitizeSensitiveText, type XSessionOptions } from './x-graphql.js';

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

function formatLogValue(value: string | number | boolean): string {
  return typeof value === 'string' && /\s/.test(value) ? JSON.stringify(value) : String(value);
}

function formatLogEvent(fields: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${formatLogValue(value as string | number | boolean)}`)
    .join(' ');
}

async function writeDaemonLog(fields: Record<string, string | number | boolean | undefined>): Promise<void> {
  await appendLine(
    twitterFeedDaemonLogPath(),
    `${new Date().toISOString()} ${formatLogEvent(fields)}`,
  );
}

function summarizeError(error: unknown): { kind: FeedDaemonErrorKind; summary: string } {
  if (error instanceof XRequestError) {
    return { kind: error.kind, summary: sanitizeSensitiveText(error.summary) };
  }
  if (error instanceof EmbeddingConfigError) {
    return { kind: 'config', summary: error.message };
  }
  if (error instanceof EmbeddingProviderError) {
    return { kind: 'semantic', summary: error.message };
  }
  if (error instanceof RemoteTweetActionError) {
    if (error.status === 401 || error.status === 403) return { kind: 'auth', summary: sanitizeSensitiveText(error.message) };
    if (error.status === 429) return { kind: 'rate_limit', summary: sanitizeSensitiveText(error.message) };
    if (typeof error.status === 'number' && error.status >= 500) return { kind: 'upstream', summary: sanitizeSensitiveText(error.message) };
    return { kind: 'action', summary: sanitizeSensitiveText(error.message) };
  }
  const message = sanitizeSensitiveText(error instanceof Error ? error.message : String(error));
  return { kind: 'unknown', summary: message || 'Unknown daemon error.' };
}

function buildLastTick(input: {
  tickId: string;
  startedAt: string;
  finishedAt: string;
  stage: FeedDaemonStage;
  outcome: 'success' | 'error';
  errorKind?: FeedDaemonErrorKind;
  summary?: string;
  fetchAdded?: number;
  fetchTotalItems?: number;
  consumed?: number;
  liked?: number;
  bookmarked?: number;
  failed?: number;
}): FeedDaemonLastTick {
  return {
    tickId: input.tickId,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    stage: input.stage,
    outcome: input.outcome,
    errorKind: input.errorKind,
    summary: input.summary,
    durationMs: Math.max(0, Date.parse(input.finishedAt) - Date.parse(input.startedAt)),
    fetchAdded: input.fetchAdded,
    fetchTotalItems: input.fetchTotalItems,
    consumed: input.consumed,
    liked: input.liked,
    bookmarked: input.bookmarked,
    failed: input.failed,
  };
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
  const lastTick = state.lastTick;
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
    `  last stage: ${lastTick?.stage ?? 'unknown'}`,
    `  last outcome: ${lastTick?.outcome ?? 'unknown'}`,
    `  last error kind: ${lastTick?.errorKind ?? 'none'}`,
    `  last summary: ${lastTick?.summary ?? (state.lastError ? sanitizeSensitiveText(state.lastError) : 'none')}`,
    `  last duration: ${lastTick?.durationMs != null ? `${lastTick.durationMs}ms` : 'unknown'}`,
    `  state: ${twitterFeedDaemonStatePath()}`,
    `  log: ${twitterFeedDaemonLogPath()}`,
  ].join('\n');
}

export async function stopFeedDaemon(): Promise<{ stopped: boolean; pid?: number }> {
  const state = await getFeedDaemonState();
  if (!isPidRunning(state.pid)) return { stopped: false, pid: state.pid };
  process.kill(state.pid!, 'SIGTERM');
  await updateDaemonState({ pid: undefined });
  await writeDaemonLog({ event: 'stop_requested', pid: state.pid });
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
    lastTick: undefined,
  });
  await writeDaemonLog({ event: 'started', pid: process.pid, interval_ms: options.everyMs });

  while (true) {
    const tickStartedAt = new Date().toISOString();
    const tickId = `${Date.now()}-${process.pid}`;
    let currentStage: FeedDaemonStage = 'fetch';
    await updateDaemonState({ lastTickStartedAt: tickStartedAt });
    await writeDaemonLog({ event: 'tick_start', tick_id: tickId, pid: process.pid });
    try {
      currentStage = 'fetch';
      await writeDaemonLog({ event: 'fetch_start', tick_id: tickId });
      const fetched = await fetchFeedItems(options);
      await writeDaemonLog({
        event: 'fetch_ok',
        tick_id: tickId,
        fetch_added: fetched.added,
        total_items: fetched.totalItems,
      });

      currentStage = 'semantic';
      await writeDaemonLog({ event: 'semantic_start', tick_id: tickId, items: fetched.newItems.length });
      await syncSemanticIndexForRun(fetched.newItems);
      await writeDaemonLog({ event: 'semantic_ok', tick_id: tickId, items: fetched.newItems.length });

      currentStage = 'consume';
      await writeDaemonLog({ event: 'consume_start', tick_id: tickId, items: fetched.newItems.length });
      const consumed = await consumeFeedItems(fetched.newItems, options);
      const tickFinishedAt = new Date().toISOString();
      const lastTick = buildLastTick({
        tickId,
        startedAt: tickStartedAt,
        finishedAt: tickFinishedAt,
        stage: 'tick',
        outcome: 'success',
        summary: 'Feed daemon tick completed successfully.',
        fetchAdded: fetched.added,
        fetchTotalItems: fetched.totalItems,
        consumed: consumed.evaluated,
        liked: consumed.liked,
        bookmarked: consumed.bookmarked,
        failed: consumed.failed,
      });
      await updateDaemonState({
        lastTickFinishedAt: tickFinishedAt,
        lastFetchAdded: fetched.added,
        lastFetchTotalItems: fetched.totalItems,
        lastConsumed: consumed.evaluated,
        lastLiked: consumed.liked,
        lastBookmarked: consumed.bookmarked,
        lastFailed: consumed.failed,
        lastError: undefined,
        lastTick,
      });
      await writeDaemonLog(
        {
          event: 'consume_ok',
          tick_id: tickId,
          consumed: consumed.evaluated,
          liked: consumed.liked,
          bookmarked: consumed.bookmarked,
          failed: consumed.failed,
          action_retries: consumed.actionRetries,
        },
      );
      await writeDaemonLog({
        event: 'tick_finish',
        tick_id: tickId,
        outcome: 'success',
        duration_ms: lastTick.durationMs,
      });
    } catch (error) {
      const { kind, summary } = summarizeError(error);
      const tickFinishedAt = new Date().toISOString();
      const lastTick = buildLastTick({
        tickId,
        startedAt: tickStartedAt,
        finishedAt: tickFinishedAt,
        stage: currentStage,
        outcome: 'error',
        errorKind: kind,
        summary,
      });
      await updateDaemonState({
        lastTickFinishedAt: tickFinishedAt,
        lastError: summary,
        lastTick,
      });
      await writeDaemonLog({
        event: `${currentStage}_error`,
        tick_id: tickId,
        kind,
        summary,
      });
      await writeDaemonLog({
        event: 'tick_finish',
        tick_id: tickId,
        outcome: 'error',
        stage: currentStage,
        kind,
        duration_ms: lastTick.durationMs,
      });
    }

    const shouldContinue = await waitFor(options.everyMs);
    if (!shouldContinue) {
      await writeDaemonLog({ event: 'stopped', pid: process.pid });
      await updateDaemonState({ pid: undefined });
      return;
    }
  }
}
