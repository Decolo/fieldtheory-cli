#!/usr/bin/env node
import { Command } from 'commander';
import { getBookmarkStatusView, formatBookmarkStatus } from './bookmarks-service.js';
import { getLikesStatusView, formatLikesStatus } from './likes-service.js';
import { getFeedStatusView, formatFeedStatus } from './feed-service.js';
import { getAccountTimelineStatusView, formatAccountTimelineStatus } from './account-timeline-service.js';
import { formatAccountReviewResults } from './account-review-service.js';
import { formatFeedDaemonStatus, getFeedDaemonState, startFeedDaemon, stopFeedDaemon } from './feed-daemon.js';
import { formatSemanticStatus, getSemanticStatusView, rebuildSemanticIndex } from './semantic-indexer.js';
import { syncLikesGraphQL, type LikesSyncProgress } from './graphql-likes.js';
import { syncFeedGraphQL, type FeedSyncProgress } from './graphql-feed.js';
import { syncAccountTimelineGraphQL } from './graphql-account-timeline.js';
import { bookmarkTweet, unfollowAccount, unlikeTweet, unbookmarkTweet } from './graphql-actions.js';
import { syncFollowingSnapshot } from './graphql-following.js';
import { fetchBookmarkRecordViaSyndication, type SyncProgress, type GapFillProgress } from './graphql-bookmarks.js';
import { syncBookmarks } from './bookmark-sync.js';
import { repairBookmarks } from './bookmark-repair.js';
import { fetchBookmarkMediaBatch } from './bookmark-media.js';
import {
  buildIndex,
  searchBookmarks,
  formatSearchResults,
  getStats,
  classifyAndRebuild,
  getCategoryCounts,
  sampleByCategory,
  getDomainCounts,
  listBookmarks,
  getBookmarkById,
} from './bookmarks-db.js';
import {
  buildLikesIndex,
  searchLikes,
  listLikes,
  getLikeById,
  formatLikeSearchResults,
} from './likes-db.js';
import { listFeed, getFeedById } from './feed-db.js';
import { listAccountTimeline, getAccountTimelineById } from './account-timeline-db.js';
import { exportAccountTimeline } from './account-export.js';
import { buildFollowingReviewIndex, getFollowingReviewItemByHandle } from './following-review-db.js';
import { runAccountReview } from './account-review.js';
import { runHybridSearch } from './hybrid-search.js';
import type { HybridSearchMode, HybridSearchResult, HybridSearchScope } from './search-types.js';
import { formatClassificationSummary } from './bookmark-classify.js';
import { classifyWithLlm, classifyDomainsWithLlm } from './bookmark-classify-llm.js';
import { resolveEngine, detectAvailableEngines } from './engine.js';
import { loadPreferences, savePreferences } from './preferences.js';
import { compileMd } from './md.js';
import { askMd } from './md-ask.js';
import { lintMd, fixLintIssues } from './md-lint.js';
import { exportBookmarks } from './md-export.js';
import { renderViz } from './bookmarks-viz.js';
import { removeBookmarkFromArchive, removeLikeFromArchive, upsertBookmarkInArchive } from './archive-actions.js';
import { reconcileUnfollowedAccount } from './following-actions.js';
import { listBrowserIds } from './browsers.js';
import {
  dataDir,
  ensureDataDir,
  isFirstRun,
  isFeedFirstRun,
  isLikesFirstRun,
  twitterAccountTimelineIndexPath,
  twitterBookmarksIndexPath,
  twitterFeedIndexPath,
  twitterLikesIndexPath,
  mdDir,
} from './paths.js';
import { resolveTrackedAccount } from './account-registry.js';
import { PromptCancelledError, promptText } from './prompt.js';
import { resolveFollowedAccountFromCache, setFollowingLabel } from './following-review-state.js';
import { skillWithFrontmatter, installSkill, uninstallSkill } from './skill.js';
import { assertWebAssetsBuilt, startWebServer } from './web.js';
import { trimLikes } from './likes-trim.js';
import { loadEnv } from './config.js';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

// ── Helpers ─────────────────────────────────────────────────────────────────

const SPINNER = ['\u280b', '\u2819', '\u2839', '\u2838', '\u283c', '\u2834', '\u2826', '\u2827', '\u2807', '\u280f'];
let spinnerIdx = 0;

/** Creates a spinner that animates independently of data callbacks. */
function createSpinner(renderLine: () => string): { update: () => void; stop: () => void } {
  let line = '';
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    const spin = SPINNER[spinnerIdx++ % SPINNER.length];
    process.stderr.write(`\r\x1b[K  ${spin} ${line}`);
  };
  const interval = setInterval(tick, 80);
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    process.stderr.write('\n');
  };

  // Graceful interrupt — stop spinner, show friendly message
  const onSigint = () => {
    stop();
    console.log('\n  Interrupted. Your data is safe \u2014 progress has been saved.');
    console.log('  Run the same command again to pick up where you left off.\n');
    process.exit(0);
  };
  process.once('SIGINT', onSigint);

  return {
    update: () => { line = renderLine(); },
    stop: () => { process.removeListener('SIGINT', onSigint); stop(); },
  };
}

export async function runWithSpinner<T>(
  spinner: { stop: () => void },
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } finally {
    spinner.stop();
  }
}

const FRIENDLY_STOP_REASONS: Record<string, string> = {
  'caught up to newest stored bookmark': 'All caught up \u2014 no new bookmarks since last sync.',
  'no new bookmarks (stale)': 'Sync complete \u2014 reached the end of new bookmarks.',
  'end of bookmarks': 'Sync complete \u2014 all bookmarks fetched.',
  'end of feed': 'Sync complete \u2014 all requested feed pages fetched.',
  'end of timeline': 'Sync complete \u2014 reached the end of the account timeline.',
  'no new tweets (stale)': 'Sync complete \u2014 no newer posts beyond your local archive.',
  'limit reached': 'Sync complete \u2014 reached the requested item limit.',
  'no tweet entries found': 'Sync complete \u2014 no supported tweet entries were returned.',
  'max runtime reached': 'Paused after 30 minutes. Run again to continue.',
  'max pages reached': 'Paused after reaching page limit. Run again to continue.',
  'target additions reached': 'Reached target bookmark count.',
};

const BOOKMARK_REPAIR_FAILURE_LOG = 'bookmark-repair-failures.json';

function friendlyStopReason(raw?: string): string {
  if (!raw) return 'Sync complete.';
  return FRIENDLY_STOP_REASONS[raw] ?? `Sync complete \u2014 ${raw}`;
}

function writeBookmarkRepairFailureLog(
  failures: Array<{ tweetId: string; reason: string; url: string }>,
): string {
  const logPath = path.join(dataDir(), BOOKMARK_REPAIR_FAILURE_LOG);
  const byReason: Record<string, number> = {};
  for (const failure of failures) {
    const reason = String(failure.reason);
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  fs.writeFileSync(logPath, JSON.stringify({ failures, summary: byReason }, null, 2));
  return logPath;
}

function formatHybridSearchResults(results: HybridSearchResult[], mode: HybridSearchMode): string {
  if (results.length === 0) return 'No results found.';

  return results
    .map((result, index) => {
      const author = result.authorHandle ? `@${result.authorHandle}` : 'unknown';
      const date = result.postedAt?.slice(0, 10) ?? '?';
      const text = result.text.length > 140 ? `${result.text.slice(0, 140)}...` : result.text;
      const score = mode === 'action' ? result.actionScore : result.topicScore;
      return `${index + 1}. [${result.sources.join('+')}] [${date}] ${author}  score=${score.toFixed(2)}\n   ${text}\n   ${result.url}`;
    })
    .join('\n\n');
}

function warnIfEmpty(totalBookmarks: number): void {
  if (totalBookmarks > 0) return;
  console.log(`  \u26a0 No bookmarks were found. This usually means:`);
  console.log(`    \u2022 The browser needs to be fully quit first (Cmd+Q / close all windows)`);
  console.log(`    \u2022 Keychain/keyring access was denied`);
  console.log(`    \u2022 You may be logged into a different profile than the one with X/Twitter`);
  console.log(`    \u2022 Try: ft bookmarks sync --cookies <ct0> <auth_token>  (paste from DevTools)\n`);
}

// ── Update checker ────────────────────────────────────────────────────────

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 1 day

function getLocalVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

function getPackageName(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require('../package.json');
    return String(pkg.name ?? 'fieldtheory-cli');
  } catch {
    return 'fieldtheory-cli';
  }
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  }
  return 0;
}

async function checkForUpdate(): Promise<void> {
  try {
    const packageName = getPackageName();
    const cacheFile = path.join(dataDir(), '.update-check');
    // Re-fetch from npm if cache is stale (>24hr)
    let needsFetch = true;
    try {
      const stat = fs.statSync(cacheFile);
      if (Date.now() - stat.mtimeMs < UPDATE_CHECK_INTERVAL_MS) needsFetch = false;
    } catch { /* file doesn't exist, fetch */ }

    if (needsFetch) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`https://registry.npmjs.org/${packageName}/latest`, {
        signal: controller.signal,
        headers: { accept: 'application/json' },
      });
      clearTimeout(timeout);

      if (res.ok) {
        const data = await res.json() as any;
        if (data?.version) fs.writeFileSync(cacheFile, data.version);
      }
    }

    // Always show notice from cache
    showCachedUpdateNotice();
  } catch { /* network error, offline, etc — silently skip */ }
}

/** Sync version — reads cached check result. Used after help output where we can't await. */
function showCachedUpdateNotice(): void {
  try {
    const cacheFile = path.join(dataDir(), '.update-check');
    const latest = fs.readFileSync(cacheFile, 'utf-8').trim();
    const local = getLocalVersion();
    const packageName = getPackageName();
    if (latest && compareVersions(latest, local) > 0) {
      console.log(`\n  \u2728 Update available: ${local} \u2192 ${latest}  \u2014  npm update -g ${packageName}`);
    }
  } catch { /* no cache yet, skip */ }
}

// ── What's new ────────────────────────────────────────────────────────────

const WHATS_NEW: Record<string, string[]> = {
  '1.2.2': [
    'ft bookmarks repair \u2014 backfill missing quoted tweets and expand truncated articles',
    'Quoted tweet content and full article text now captured automatically during sync',
    'Bookmark date (when you bookmarked, not just when it was posted) now tracked',
    'ft bookmarks sync --rebuild replaces --full',
    'Update notifications when a new version is available',
  ],
};

function showWhatsNew(): void {
  const version = getLocalVersion();
  const versionFile = path.join(dataDir(), '.last-version');

  let lastSeen: string | undefined;
  try { lastSeen = fs.readFileSync(versionFile, 'utf-8').trim(); } catch { /* first run */ }

  // Update the stored version
  try { fs.writeFileSync(versionFile, version); } catch { /* read-only, etc */ }

  if (!lastSeen || lastSeen === version) return;

  // Collect features from all versions newer than lastSeen
  const newFeatures: string[] = [];
  for (const [v, features] of Object.entries(WHATS_NEW)) {
    if (compareVersions(v, lastSeen) > 0 && compareVersions(v, version) <= 0) {
      newFeatures.push(...features);
    }
  }

  if (newFeatures.length === 0) return;

  console.log(`\n  \x1b[1mWhat's new in v${version}:\x1b[0m`);
  for (const feature of newFeatures) {
    console.log(`    \u2022 ${feature}`);
  }
  console.log();
}

function logo(): string {
  const v = getLocalVersion();
  const vLabel = `v${v}`;
  const innerW = 33;
  const line1 = 'F i e l d   T h e o r y';
  const line2 = 'fieldtheory.dev/cli';
  const pad1 = innerW - line1.length - 3;
  const pad2 = innerW - line2.length - vLabel.length - 4;
  return `
     \x1b[2m\u250c${'\u2500'.repeat(innerW)}\u2510\x1b[0m
     \x1b[2m\u2502\x1b[0m  \x1b[1m${line1}\x1b[0m${' '.repeat(pad1)} \x1b[2m\u2502\x1b[0m
     \x1b[2m\u2502\x1b[0m  \x1b[2m${line2}\x1b[0m${' '.repeat(Math.max(pad2, 1))}\x1b[2m${vLabel}\x1b[0m  \x1b[2m\u2502\x1b[0m
     \x1b[2m\u2514${'\u2500'.repeat(innerW)}\u2518\x1b[0m`;
}

function shouldSuppressPreActionOutput(argv: string[]): boolean {
  const args = argv.slice(2);
  const commandPath = args.filter((arg) => !arg.startsWith('-')).slice(0, 2).join(' ');
  if (commandPath === 'skill show') return true;
  if (commandPath === 'accounts export' && !args.includes('--out')) return true;
  if (args.includes('--json')) return true;
  return false;
}

export function showWelcome(): void {
  console.log(logo());
  console.log(`
  Save a local copy of your X/Twitter bookmarks and likes. Search them,
  classify bookmarks, and make them available to any AI agent.
  Your data never leaves your machine.

  Get started:

    1. Open your browser and log into x.com
    2. Run: ft bookmarks sync

  Works with Chrome, Brave, Chromium, and Firefox on macOS/Linux.
  Data will be stored at: ${dataDir()}
`);
}

export async function showDashboard(): Promise<void> {
  console.log(logo());
  try {
    const view = await getBookmarkStatusView();
    const ago = view.lastUpdated ? timeAgo(view.lastUpdated) : 'never';
    console.log(`
  \x1b[1m${view.bookmarkCount.toLocaleString()}\x1b[0m bookmarks  \x1b[2m\u2502\x1b[0m  last synced \x1b[1m${ago}\x1b[0m  \x1b[2m\u2502\x1b[0m  ${dataDir()}
`);

    if (fs.existsSync(twitterBookmarksIndexPath())) {
      const counts = await getCategoryCounts();
      const cats = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 7);
      if (cats.length > 0) {
        const catLine = cats.map(([c, n]) => `${c} (${n})`).join(' \u00b7 ');
        console.log(`  \x1b[2m${catLine}\x1b[0m`);
      }
    }

  console.log(`
  \x1b[2mSync now:\x1b[0m     ft bookmarks sync
  \x1b[2mSearch:\x1b[0m       ft bookmarks search "query"
  \x1b[2mExplore:\x1b[0m      ft bookmarks viz
  \x1b[2mWeb UI:\x1b[0m       ft web
  \x1b[2mAll commands:\x1b[0m  ft --help
`);
  } catch {
    console.log(`
  Data: ${dataDir()}

  Run: ft bookmarks sync
`);
  }
}

function timeAgo(dateStr: string): string {
  const ms = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

function showSyncWelcome(): void {
  const browsers = listBrowserIds().join(', ');
  console.log(`
  Make sure your browser is open and logged into x.com.
  Your browser session is used to authenticate \u2014 no passwords
  are stored or transmitted.

  Browser ids: ${browsers}
  Use --browser <name> to choose.
  Default auto-detect prefers installed Chrome-family browsers.
  Firefox on Windows requires Node.js 22.5+ or sqlite3 on PATH.
`);
}

/** Check that bookmarks have been synced. Returns true if data exists. */
function requireData(): boolean {
  if (isFirstRun()) {
    console.log(`
  No bookmarks synced yet.

  Get started:

    1. Open your browser and log into x.com
    2. Run: ft bookmarks sync
`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

/** Check that the search index exists. Returns true if it does. */
function requireIndex(): boolean {
  if (!requireData()) return false;
  if (!fs.existsSync(twitterBookmarksIndexPath())) {
    console.log(`
  Search index not built yet.

  Run: ft bookmarks index
`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function requireLikesData(): boolean {
  if (isLikesFirstRun()) {
    console.log(`
  No likes synced yet.

  Run: ft likes sync
`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function requireLikesIndex(): boolean {
  if (!requireLikesData()) return false;
  if (!fs.existsSync(twitterLikesIndexPath())) {
    console.log(`
  Likes search index not built yet.

  Run: ft likes index
`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function requireFeedData(): boolean {
  if (isFeedFirstRun()) {
    console.log(`
  No feed items synced yet.

  Run: ft feed sync
`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

function requireFeedIndex(): boolean {
  if (!requireFeedData()) return false;
  if (!fs.existsSync(twitterFeedIndexPath())) {
    console.log(`
  Feed index not built yet.

  Run: ft feed sync
`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

async function requireTrackedAccount(handle: string): Promise<{ userId: string; currentHandle: string; name?: string } | null> {
  const account = await resolveTrackedAccount(handle);
  if (!account) {
    console.log(`\n  No local archive found for ${handle}.\n\n  Run: ft accounts sync ${handle}\n`);
    process.exitCode = 1;
    return null;
  }
  return account;
}

async function requireAccountIndex(handle: string): Promise<{ userId: string; currentHandle: string; name?: string } | null> {
  const account = await requireTrackedAccount(handle);
  if (!account) return null;
  if (!fs.existsSync(twitterAccountTimelineIndexPath(account.userId))) {
    console.log(`\n  Account index not built yet.\n\n  Run: ft accounts sync @${account.currentHandle}\n`);
    process.exitCode = 1;
    return null;
  }
  return account;
}

async function requireFollowedAccount(handle: string): Promise<{ userId: string; handle: string; name?: string } | null> {
  const account = await resolveFollowedAccountFromCache(handle);
  if (!account) {
    console.log(`\n  No reviewed follow cache found for ${handle}.\n\n  Run: ft accounts review\n`);
    process.exitCode = 1;
    return null;
  }
  return {
    userId: account.userId,
    handle: account.handle,
    name: account.name,
  };
}

/** Wrap an async action with graceful error handling. */
function safe(fn: (...args: any[]) => Promise<void>): (...args: any[]) => Promise<void> {
  return async (...args: any[]) => {
    try {
      await fn(...args);
    } catch (err) {
      if (err instanceof PromptCancelledError) {
        console.log(`\n  ${err.message}\n`);
        process.exitCode = err.exitCode;
        return;
      }
      const msg = (err as Error).message;
      console.error(`\n  Error: ${msg}\n`);
      process.exitCode = 1;
    }
  };
}

export function parseIntervalMs(raw: string): number {
  const value = String(raw).trim().toLowerCase();
  const match = value.match(/^(\d+)(s|m|h)$/);
  if (!match) {
    throw new Error(`Invalid interval: "${raw}". Use forms like 30s, 5m, or 2h.`);
  }

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid interval: "${raw}". Interval must be greater than zero.`);
  }

  const unit = match[2];
  if (unit === 's') return amount * 1000;
  if (unit === 'm') return amount * 60 * 1000;
  return amount * 60 * 60 * 1000;
}

async function waitForNextRun(intervalMs: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve(true);
    }, intervalMs);

    const onSignal = () => {
      cleanup();
      resolve(false);
    };

    const cleanup = () => {
      clearTimeout(timer);
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
    };

    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  });
}

// ── CLI ─────────────────────────────────────────────────────────────────────

export function buildCli() {
  loadEnv();
  const program = new Command();

  async function runBookmarkRepairCommand(
    options: { delayMs?: number },
  ): Promise<void> {
    const startTime = Date.now();
    process.stderr.write('  Repairing bookmark enrichment gaps (quoted tweets, truncated text, invalid dates)...\n');
    let lastProgress: GapFillProgress = { done: 0, total: 0, quotedFetched: 0, textExpanded: 0, failed: 0 };
    const spinner = createSpinner(() => {
      const p = lastProgress;
      const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      return `${p.done}/${p.total} (${pct}%) \u2502 ${p.quotedFetched} quoted \u2502 ${p.textExpanded} expanded \u2502 ${p.failed} failed \u2502 ${elapsed}s`;
    });
    const result = await runWithSpinner(spinner, () => repairBookmarks({
      delayMs: Number(options.delayMs) || 300,
      onProgress: (progress: GapFillProgress) => {
        lastProgress = progress;
        spinner.update();
      },
    }));

    if (result.total === 0 && result.bookmarkedAtRepaired === 0) {
      console.log('  No repair needed \u2014 bookmarks are already fully enriched.');
      return;
    }

    if (result.quotedTweetsFilled > 0) console.log(`  \u2713 ${result.quotedTweetsFilled} quoted tweets repaired`);
    if (result.textExpanded > 0) console.log(`  \u2713 ${result.textExpanded} truncated texts expanded`);
    if (result.bookmarkedAtRepaired > 0) {
      console.log(`  \u2713 ${result.bookmarkedAtRepaired} invalid bookmark dates cleared`);
      await rebuildIndex();
    }
    if (result.failed > 0) {
      const logPath = writeBookmarkRepairFailureLog(result.failures);
      const summary = JSON.parse(fs.readFileSync(logPath, 'utf-8')) as { summary: Record<string, number> };

      console.log(`  ${result.failed} unavailable:`);
      for (const [reason, count] of Object.entries(summary.summary)) {
        console.log(`    \u2022 ${count} ${reason}`);
      }
      console.log(`  Details: ${logPath}`);
    }
    if (result.bookmarkedAtMissing > 0) {
      console.log(`  ${result.bookmarkedAtMissing} bookmarks still missing a reliable bookmark date`);
    }
  }

  async function rebuildIndex(): Promise<number> {
    process.stderr.write('  Building search index...\n');
    const idx = await buildIndex();
    process.stderr.write(`  \u2713 ${idx.recordCount} bookmarks indexed (${idx.newRecords} new)\n`);
    return idx.newRecords;
  }

  async function classifyNew(): Promise<void> {
    const engine = await resolveEngine();

    const start = Date.now();
    process.stderr.write('  Classifying new bookmarks (categories)...\n');
    const catResult = await classifyWithLlm({
      engine,
      onBatch: (done: number, total: number) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stderr.write(`  Categories: ${done}/${total} (${pct}%) \u2502 ${elapsed}s elapsed\n`);
      },
    });
    if (catResult.classified > 0) {
      process.stderr.write(`  \u2713 ${catResult.classified} categorized\n`);
    }

    const domStart = Date.now();
    process.stderr.write('  Classifying new bookmarks (domains)...\n');
    const domResult = await classifyDomainsWithLlm({
      engine,
      all: false,
      onBatch: (done: number, total: number) => {
        const pct = total > 0 ? Math.round((done / total) * 100) : 0;
        const elapsed = Math.round((Date.now() - domStart) / 1000);
        process.stderr.write(`  Domains: ${done}/${total} (${pct}%) \u2502 ${elapsed}s elapsed\n`);
      },
    });
    if (domResult.classified > 0) {
      process.stderr.write(`  \u2713 ${domResult.classified} domains assigned\n`);
    }
  }

  program
    .name('ft')
    .description('Self-custody for your X/Twitter bookmarks, likes, and feed. Sync, search, classify bookmarks, and explore locally.')
    .version(getLocalVersion())
    .showHelpAfterError()
    .hook('preAction', () => {
      if (shouldSuppressPreActionOutput(process.argv)) return;
      console.log(logo());
      showWhatsNew();
    });

  // ── bookmarks ───────────────────────────────────────────────────────────

  const bookmarks = program
    .command('bookmarks')
    .description('Sync, query, and manage your bookmarks archive');

  bookmarks
    .command('sync')
    .description('Sync bookmarks from X into your local archive')
    .option('--rebuild', 'Full re-crawl of all bookmarks', false)
    .option('--yes', 'Skip confirmation prompts', false)
    .option('--classify', 'Classify new bookmarks with LLM after syncing', false)
    .option('--max-pages <n>', 'Max pages to fetch (default: unlimited)', (v: string) => Number(v))
    .option('--target-adds <n>', 'Stop after N new bookmarks', (v: string) => Number(v))
    .option('--delay-ms <n>', 'Delay between requests in ms', (v: string) => Number(v), 600)
    .option('--max-minutes <n>', 'Max runtime in minutes', (v: string) => Number(v), 30)
    .option('--browser <name>', 'Browser to read session from (chrome, chromium, brave, firefox, ...)')
    .option('--cookies <values...>', 'Pass ct0 and auth_token directly (skips browser extraction)')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory')
    .action(async (options) => {
      const firstRun = isFirstRun();
      if (firstRun) showSyncWelcome();
      ensureDataDir();

      try {
        // ── rebuild confirmation ──
        if (options.rebuild) {
          const dir = dataDir();
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
          const backupDir = `${dir}-backup-${timestamp}`;

          console.log(`  \u26a0 Rebuild will re-crawl all bookmarks from X.`);
          console.log(`  Your existing data will be merged (not deleted), but`);
          console.log(`  this is a full re-sync and may take a while.\n`);
          console.log(`  To back up first, run:`);
          console.log(`    cp -r ${dir} ${backupDir}\n`);

          // Allow --yes to skip confirmation
          if (!options.yes) {
            const answer = await promptText('  Continue? (y/N) ', { output: process.stdout });
            if (answer.kind === 'interrupt') {
              throw new PromptCancelledError('Cancelled. Rebuild aborted.', 130);
            }
            if (answer.kind !== 'answer' || answer.value.toLowerCase() !== 'y') {
              console.log('  Aborted.');
              return;
            }
          }
        }

        const startTime = Date.now();
        let lastSync: SyncProgress = { page: 0, totalFetched: 0, newAdded: 0, running: true, done: false };
        const spinner = createSpinner(() => {
          const elapsed = Math.round((Date.now() - startTime) / 1000);
          if (lastSync.stopReason && lastSync.running) {
            return `${lastSync.stopReason}  \u2502  ${lastSync.newAdded} new  \u2502  ${elapsed}s`;
          }
          return `Syncing bookmarks...  ${lastSync.newAdded} new  \u2502  page ${lastSync.page}  \u2502  ${elapsed}s`;
        });
        let csrfToken: string | undefined;
        let cookieHeader: string | undefined;
        if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
          csrfToken = String(options.cookies[0]);
          const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
          const parts = [`ct0=${csrfToken}`];
          if (authToken) parts.push(`auth_token=${authToken}`);
          cookieHeader = parts.join('; ');
        }

        const result = await runWithSpinner(spinner, () => syncBookmarks({
          rebuild: Boolean(options.rebuild),
          maxPages: options.maxPages != null ? Number(options.maxPages) : undefined,
          targetAdds: typeof options.targetAdds === 'number' && !Number.isNaN(options.targetAdds) ? options.targetAdds : undefined,
          delayMs: Number(options.delayMs) || 600,
          maxMinutes: Number(options.maxMinutes) || 30,
          browser: options.browser ? String(options.browser) : undefined,
          csrfToken,
          cookieHeader,
          chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
          chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
          firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
          onProgress: (status: SyncProgress) => {
            lastSync = status;
            spinner.update();
          },
        }));

        console.log(`\n  \u2713 ${result.added} new bookmarks synced (${result.totalBookmarks} total)`);
        console.log(`  ${friendlyStopReason(result.stopReason)}`);
        if (result.bookmarkedAtRepaired > 0) {
          console.log(`  \u2713 ${result.bookmarkedAtRepaired} invalid bookmark dates cleared`);
        }
        if (result.bookmarkedAtMissing > 0) {
          console.log(`  ${result.bookmarkedAtMissing} bookmarks missing a reliable bookmark date`);
        }
        console.log(`  \u2713 Data: ${dataDir()}\n`);

        warnIfEmpty(result.totalBookmarks);

        const newCount = await rebuildIndex();
        if (options.classify && newCount > 0) {
          await classifyNew();
        }

        if (firstRun) {
          console.log(`\n  Next steps:`);
          console.log(`        ft bookmarks classify              Classify by category and domain (LLM)`);
          console.log(`        ft bookmarks classify --regex      Classify by category (simple)`);
          console.log(`\n  Explore:`);
          console.log(`        ft bookmarks search "machine learning"`);
          console.log(`        ft bookmarks viz`);
          console.log(`        ft web`);
          console.log(`        ft bookmarks categories`);
          console.log(`\n  You can also just tell Claude to use the ft CLI to search and`);
          console.log(`  explore your bookmarks. It already knows how.\n`);
        }

      } catch (err) {
        const msg = (err as Error).message;
        if (firstRun && (msg.includes('cookie') || msg.includes('Cookie') || msg.includes('Keychain') || msg.includes('Safe Storage'))) {
          console.log(`
  Couldn't connect to your browser session.

  To sync your bookmarks:

    1. Open your browser and log into x.com
    2. Run: ft bookmarks sync

  Options:
    ft bookmarks sync --browser brave           Use a specific browser
    ft bookmarks sync --browser firefox         Use Firefox
    ft bookmarks sync --cookies <ct0> <auth>    Pass cookies directly
    ft bookmarks sync --chrome-profile-directory "Profile 1"
`);
        } else {
          console.error(`\n  Error: ${msg}\n`);
        }
        process.exitCode = 1;
      }
    });

  // ── search ──────────────────────────────────────────────────────────────

  bookmarks
    .command('search')
    .description('Full-text search across bookmarks')
    .argument('<query>', 'Search query (supports FTS5 syntax: AND, OR, NOT, "exact phrase")')
    .option('--author <handle>', 'Filter by author handle')
    .option('--after <date>', 'Bookmarks posted after this date (YYYY-MM-DD)')
    .option('--before <date>', 'Bookmarks posted before this date (YYYY-MM-DD)')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 20)
    .action(safe(async (query: string, options) => {
      if (!requireIndex()) return;
      const results = await searchBookmarks({
        query,
        author: options.author ? String(options.author) : undefined,
        after: options.after ? String(options.after) : undefined,
        before: options.before ? String(options.before) : undefined,
        limit: Number(options.limit) || 20,
      });
      console.log(formatSearchResults(results));
    }));

  program
    .command('search-all')
    .description('Hybrid search across feed, likes, and bookmarks')
    .argument('<query>', 'Search query in plain language or keywords')
    .option('--mode <mode>', 'Ranking mode: topic or action', 'topic')
    .option('--scope <scope>', 'Scope: all, bookmarks, likes, or feed', 'all')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 20)
    .option('--summary', 'Add a result-set summary after the ranked items')
    .option('--json', 'JSON output')
    .action(safe(async (query: string, options) => {
      const rawMode = String(options.mode ?? 'topic');
      if (rawMode !== 'topic' && rawMode !== 'action') {
        throw new Error(`Invalid search mode: "${rawMode}". Use "topic" or "action".`);
      }
      const mode = rawMode as HybridSearchMode;
      const rawScope = String(options.scope ?? 'all');
      if (!['all', 'bookmarks', 'likes', 'feed'].includes(rawScope)) {
        throw new Error(`Invalid search scope: "${rawScope}". Use "all", "bookmarks", "likes", or "feed".`);
      }
      const scope = rawScope as HybridSearchScope;
      const result = await runHybridSearch({
        query,
        mode,
        scope,
        limit: Number(options.limit) || 20,
        summary: Boolean(options.summary),
      });

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(formatHybridSearchResults(result.results, mode));
      if (result.summary) {
        console.log('\nSummary');
        console.log(result.summary);
      }
    }));

  // ── list ────────────────────────────────────────────────────────────────

  bookmarks
    .command('list')
    .description('List bookmarks with filters')
    .option('--query <query>', 'Text query (FTS5 syntax)')
    .option('--author <handle>', 'Filter by author handle')
    .option('--after <date>', 'Posted after (YYYY-MM-DD)')
    .option('--before <date>', 'Posted before (YYYY-MM-DD)')
    .option('--category <category>', 'Filter by category')
    .option('--domain <domain>', 'Filter by domain')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 30)
    .option('--offset <n>', 'Offset into results', (v: string) => Number(v), 0)
    .option('--json', 'JSON output')
    .action(safe(async (options) => {
      if (!requireIndex()) return;
      const items = await listBookmarks({
        query: options.query ? String(options.query) : undefined,
        author: options.author ? String(options.author) : undefined,
        after: options.after ? String(options.after) : undefined,
        before: options.before ? String(options.before) : undefined,
        category: options.category ? String(options.category) : undefined,
        domain: options.domain ? String(options.domain) : undefined,
        limit: Number(options.limit) || 30,
        offset: Number(options.offset) || 0,
      });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      for (const item of items) {
        const tags = [item.primaryCategory, item.primaryDomain].filter(Boolean).join(' \u00b7 ');
        const summary = item.text.length > 120 ? `${item.text.slice(0, 117)}...` : item.text;
        console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${item.postedAt?.slice(0, 10) ?? '?'}${tags ? `  ${tags}` : ''}`);
        console.log(`  ${summary}`);
        console.log(`  ${item.url}`);
        console.log();
      }
    }));

  // ── show ─────────────────────────────────────────────────────────────────

  bookmarks
    .command('show')
    .description('Show one bookmark in detail')
    .argument('<id>', 'Bookmark id')
    .option('--json', 'JSON output')
    .action(safe(async (id: string, options) => {
      if (!requireIndex()) return;
      const item = await getBookmarkById(String(id));
      if (!item) {
        console.log(`  Bookmark not found: ${String(id)}`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(`${item.id} \u00b7 ${item.authorHandle ? `@${item.authorHandle}` : '@?'}`);
      console.log(item.url);
      console.log(item.text);
      if (item.links.length) console.log(`links: ${item.links.join(', ')}`);
      if (item.categories) console.log(`categories: ${item.categories}`);
      if (item.domains) console.log(`domains: ${item.domains}`);
    }));

  // ── stats ───────────────────────────────────────────────────────────────

  bookmarks
    .command('stats')
    .description('Aggregate statistics from your bookmarks')
    .action(safe(async () => {
      if (!requireIndex()) return;
      const stats = await getStats();
      console.log(`Bookmarks: ${stats.totalBookmarks}`);
      console.log(`Unique authors: ${stats.uniqueAuthors}`);
      console.log(`Date range: ${stats.dateRange.earliest?.slice(0, 10) ?? '?'} to ${stats.dateRange.latest?.slice(0, 10) ?? '?'}`);
      console.log(`\nTop authors:`);
      for (const a of stats.topAuthors) console.log(`  @${a.handle}: ${a.count}`);
      console.log(`\nLanguages:`);
      for (const l of stats.languageBreakdown) console.log(`  ${l.language}: ${l.count}`);
    }));

  // ── viz ─────────────────────────────────────────────────────────────────

  bookmarks
    .command('viz')
    .description('Visual dashboard of your bookmarking patterns')
    .action(safe(async () => {
      if (!requireIndex()) return;
      console.log(await renderViz());
    }));

  // ── web ─────────────────────────────────────────────────────────────────

  program
    .command('web')
    .description('Serve a local web UI for hybrid search plus archive browsing')
    .option('--host <host>', 'Host interface to bind', '127.0.0.1')
    .option('--port <n>', 'Port to listen on', (v: string) => Number(v), 3147)
    .option('--open', 'Open the web UI in your default browser')
    .action(safe(async (options) => {
      assertWebAssetsBuilt();
      const requestedPort = typeof options.port === 'number' && !Number.isNaN(options.port)
        ? options.port
        : 3147;
      const server = await startWebServer({
        host: String(options.host),
        port: requestedPort,
        open: Boolean(options.open),
      });

      console.log(`  Field Theory web UI`);
      console.log(`  URL: ${server.url}`);
      console.log(`  Press Ctrl+C to stop.\n`);

      await new Promise<void>((resolve) => {
        const shutdown = async () => {
          process.removeListener('SIGINT', shutdown);
          process.removeListener('SIGTERM', shutdown);
          await server.close();
          resolve();
        };
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
      });
    }));

  // ── classify ────────────────────────────────────────────────────────────

  bookmarks
    .command('classify')
    .description('Classify bookmarks by category and domain using LLM (requires claude or codex CLI)')
    .option('--regex', 'Use simple regex classification instead of LLM')
    .action(safe(async (options) => {
      if (!requireData()) return;
      if (options.regex) {
        process.stderr.write('Classifying bookmarks (regex)...\n');
        const result = await classifyAndRebuild();
        console.log(`Indexed ${result.recordCount} bookmarks \u2192 ${result.dbPath}`);
        console.log(formatClassificationSummary(result.summary));
      } else {
        const engine = await resolveEngine();

        let catStart = Date.now();
        process.stderr.write('Classifying categories with LLM (batches of 50, ~2 min per batch)...\n');
        const catResult = await classifyWithLlm({
          engine,
          onBatch: (done: number, total: number) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const elapsed = Math.round((Date.now() - catStart) / 1000);
            process.stderr.write(`  Categories: ${done}/${total} (${pct}%) \u2502 ${elapsed}s elapsed\n`);
          },
        });
        console.log(`\nEngine: ${catResult.engine}`);
        console.log(`Categories: ${catResult.classified}/${catResult.totalUnclassified} classified`);

        let domStart = Date.now();
        process.stderr.write('\nClassifying domains with LLM (batches of 50, ~2 min per batch)...\n');
        const domResult = await classifyDomainsWithLlm({
          engine,
          all: false,
          onBatch: (done: number, total: number) => {
            const pct = total > 0 ? Math.round((done / total) * 100) : 0;
            const elapsed = Math.round((Date.now() - domStart) / 1000);
            process.stderr.write(`  Domains: ${done}/${total} (${pct}%) \u2502 ${elapsed}s elapsed\n`);
          },
        });
        console.log(`\nDomains: ${domResult.classified}/${domResult.totalUnclassified} classified`);
      }
    }));

  // ── classify-domains ────────────────────────────────────────────────────

  bookmarks
    .command('classify-domains')
    .description('Classify bookmarks by subject domain using LLM (ai, finance, etc.)')
    .option('--all', 'Re-classify all bookmarks, not just missing')
    .action(safe(async (options) => {
      if (!requireData()) return;
      const engine = await resolveEngine();
      const start = Date.now();
      process.stderr.write('Classifying bookmark domains with LLM (batches of 50, ~2 min per batch)...\n');
      const result = await classifyDomainsWithLlm({
        engine,
        all: options.all ?? false,
        onBatch: (done: number, total: number) => {
          const pct = total > 0 ? Math.round((done / total) * 100) : 0;
          const elapsed = Math.round((Date.now() - start) / 1000);
          process.stderr.write(`  Domains: ${done}/${total} (${pct}%) \u2502 ${elapsed}s elapsed\n`);
        },
      });
      console.log(`\nDomains: ${result.classified}/${result.totalUnclassified} classified`);
    }));

  // ── model ───────────────────────────────────────────────────────────────

  bookmarks
    .command('model')
    .description('View or change the default LLM engine for classification')
    .argument('[engine]', 'Set default engine directly (e.g. claude, codex)')
    .action(safe(async (engineArg?: string) => {
      const available = detectAvailableEngines();
      const prefs = loadPreferences();

      if (available.length === 0) {
        console.log('  No LLM engines found on PATH.');
        console.log('  Install one of:');
        console.log('    - Claude Code: https://docs.anthropic.com/en/docs/claude-code');
        console.log('    - Codex CLI:   https://github.com/openai/codex');
        return;
      }

      // Direct set: ft model claude
      if (engineArg) {
        if (!available.includes(engineArg)) {
          console.log(`  "${engineArg}" is not available. Found: ${available.join(', ')}`);
          process.exitCode = 1;
          return;
        }
        savePreferences({ ...prefs, defaultEngine: engineArg });
        console.log(`  \u2713 Default model set to ${engineArg}`);
        return;
      }

      // Interactive picker
      console.log('  Available engines:\n');
      for (const name of available) {
        const marker = name === prefs.defaultEngine ? ' (default)' : '';
        console.log(`    ${name}${marker}`);
      }
      console.log();

      if (!process.stdin.isTTY) {
        if (prefs.defaultEngine) console.log(`  Current default: ${prefs.defaultEngine}`);
        console.log('  Set with: ft bookmarks model <engine>');
        return;
      }

      const answer = await promptText('  Select default: ');
      if (answer.kind === 'interrupt') {
        throw new PromptCancelledError('Cancelled. No default model saved.', 130);
      }
      if (answer.kind === 'close' || !answer.value) {
        console.log('  No default model saved.');
        return;
      }

      if (available.includes(answer.value)) {
        savePreferences({ ...prefs, defaultEngine: answer.value });
        console.log(`  \u2713 Default model set to ${answer.value}`);
      } else {
        console.log(`  "${answer.value}" is not available. Found: ${available.join(', ')}`);
        process.exitCode = 1;
      }
    }));

  // ── categories ──────────────────────────────────────────────────────────

  bookmarks
    .command('categories')
    .description('Show category distribution')
    .action(safe(async () => {
      if (!requireIndex()) return;
      const counts = await getCategoryCounts();
      if (Object.keys(counts).length === 0) {
        console.log('  No categories found. Run: ft bookmarks classify');
        return;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [cat, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`  ${cat.padEnd(14)} ${String(count).padStart(5)}  (${pct}%)`);
      }
    }));

  // ── domains ─────────────────────────────────────────────────────────────

  bookmarks
    .command('domains')
    .description('Show domain distribution')
    .action(safe(async () => {
      if (!requireIndex()) return;
      const counts = await getDomainCounts();
      if (Object.keys(counts).length === 0) {
        console.log('  No domains found. Run: ft bookmarks classify-domains');
        return;
      }
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      for (const [dom, count] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
        const pct = ((count / total) * 100).toFixed(1);
        console.log(`  ${dom.padEnd(20)} ${String(count).padStart(5)}  (${pct}%)`);
      }
    }));

  // ── index ───────────────────────────────────────────────────────────────

  bookmarks
    .command('index')
    .description('Rebuild the SQLite search index from the JSONL cache')
    .option('--force', 'Drop and rebuild from scratch (loses classifications)')
    .action(safe(async (options) => {
      if (!requireData()) return;
      process.stderr.write('Building search index...\n');
      const result = await buildIndex({ force: Boolean(options.force) });
      console.log(`Indexed ${result.recordCount} bookmarks (${result.newRecords} new) \u2192 ${result.dbPath}`);
    }));

  // ── status ──────────────────────────────────────────────────────────────

  bookmarks
    .command('add')
    .description('Create one bookmark on X')
    .argument('<id>', 'Post id')
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (id: string, options) => {
      let csrfToken: string | undefined;
      let cookieHeader: string | undefined;
      if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
        csrfToken = String(options.cookies[0]);
        const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
        const parts = [`ct0=${csrfToken}`];
        if (authToken) parts.push(`auth_token=${authToken}`);
        cookieHeader = parts.join('; ');
      }

      const result = await bookmarkTweet(String(id), {
        browser: options.browser ? String(options.browser) : undefined,
        csrfToken,
        cookieHeader,
        chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
        chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
        firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
      });

      const localRecord = await fetchBookmarkRecordViaSyndication(String(id));
      const local = localRecord ? await upsertBookmarkInArchive(localRecord) : null;

      console.log(`\n  ✓ Created bookmark on X: ${result.tweetId}`);
      console.log(`  Attempts: ${result.attempts}\n`);
      if (local) {
        console.log(`  Local archive: ${local.inserted ? 'cached new record' : 'updated cached record'}`);
        console.log(`  Cached bookmarks: ${local.totalRecords}`);
        console.log(`  Cache: ${local.cachePath}`);
        console.log(`  Index: ${local.dbPath}\n`);
      } else {
        console.log('  Local archive: bookmark created remotely, but local metadata fetch was unavailable.');
        console.log('  Run `ft bookmarks sync` if you want to pull it into the local archive immediately.\n');
      }
    }));

  bookmarks
    .command('status')
    .description('Show sync status and data location')
    .action(safe(async () => {
      if (!requireData()) return;
      const view = await getBookmarkStatusView();
      console.log(formatBookmarkStatus(view));
    }));

  bookmarks
    .command('unbookmark')
    .description('Remove one bookmark on X and reconcile the local archive')
    .argument('<id>', 'Bookmarked post id')
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (id: string, options) => {
      let csrfToken: string | undefined;
      let cookieHeader: string | undefined;
      if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
        csrfToken = String(options.cookies[0]);
        const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
        const parts = [`ct0=${csrfToken}`];
        if (authToken) parts.push(`auth_token=${authToken}`);
        cookieHeader = parts.join('; ');
      }

      await unbookmarkTweet(String(id), {
        browser: options.browser ? String(options.browser) : undefined,
        csrfToken,
        cookieHeader,
        chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
        chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
        firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
      });

      try {
        const local = await removeBookmarkFromArchive(String(id));
        console.log(`\n  ✓ Removed bookmark on X: ${id}`);
        console.log(`  Local archive: ${local.removed ? 'removed cached record' : 'record not found locally'}`);
        console.log(`  Remaining bookmarks: ${local.totalRemaining}`);
        console.log(`  Cache: ${local.cachePath}`);
        console.log(`  Index: ${local.dbPath}\n`);
      } catch (error) {
        throw new Error(
          `Removed bookmark on X, but failed to update the local archive.\n` +
          `Recovery: run ft bookmarks sync or ft bookmarks index.\n` +
          `Details: ${(error as Error).message}`
        );
      }
    }));

  bookmarks
    .command('repair')
    .description('Repair bookmark enrichment gaps in existing local data')
    .option('--delay-ms <n>', 'Delay between repair requests in ms', (v: string) => Number(v), 300)
    .action(safe(async (options) => {
      await runBookmarkRepairCommand(options);
    }));

  // ── likes ───────────────────────────────────────────────────────────────

  const likes = program
    .command('likes')
    .description('Sync and query your liked posts as a separate local archive');

  likes
    .command('sync')
    .description('Sync liked posts from X into your local likes archive')
    .option('--max-pages <n>', 'Max pages to fetch', (v: string) => Number(v), 500)
    .option('--delay-ms <n>', 'Delay between requests in ms', (v: string) => Number(v), 600)
    .option('--max-minutes <n>', 'Max runtime in minutes', (v: string) => Number(v), 30)
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (options) => {
      const firstRun = isLikesFirstRun();
      if (firstRun) showSyncWelcome();
      ensureDataDir();

      const startTime = Date.now();
      let lastSync: LikesSyncProgress = { page: 0, totalFetched: 0, newAdded: 0, running: true, done: false };
      const spinner = createSpinner(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        return `Syncing likes...  ${lastSync.newAdded} new  │  page ${lastSync.page}  │  ${elapsed}s`;
      });

      let csrfToken: string | undefined;
      let cookieHeader: string | undefined;
      if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
        csrfToken = String(options.cookies[0]);
        const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
        const parts = [`ct0=${csrfToken}`];
        if (authToken) parts.push(`auth_token=${authToken}`);
        cookieHeader = parts.join('; ');
      }

      const result = await runWithSpinner(spinner, () => syncLikesGraphQL({
        maxPages: Number(options.maxPages) || 500,
        delayMs: Number(options.delayMs) || 600,
        maxMinutes: Number(options.maxMinutes) || 30,
        browser: options.browser ? String(options.browser) : undefined,
        csrfToken,
        cookieHeader,
        chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
        chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
        firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
        onProgress: (status: LikesSyncProgress) => {
          lastSync = status;
          spinner.update();
        },
      }));

      console.log(`\n  ✓ ${result.added} new likes synced (${result.totalLikes} total)`);
      console.log(`  ${friendlyStopReason(result.stopReason)}`);
      console.log(`  ✓ Data: ${dataDir()}\n`);

      if (result.added > 0) {
        process.stderr.write('  Building likes search index...\n');
        const idx = await buildLikesIndex();
        process.stderr.write(`  ✓ ${idx.recordCount} likes indexed (${idx.newRecords} new)\n`);
      }
    }));

  likes
    .command('unlike')
    .description('Unlike one post on X and reconcile the local likes archive')
    .argument('<id>', 'Liked post id')
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (id: string, options) => {
      let csrfToken: string | undefined;
      let cookieHeader: string | undefined;
      if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
        csrfToken = String(options.cookies[0]);
        const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
        const parts = [`ct0=${csrfToken}`];
        if (authToken) parts.push(`auth_token=${authToken}`);
        cookieHeader = parts.join('; ');
      }

      await unlikeTweet(String(id), {
        browser: options.browser ? String(options.browser) : undefined,
        csrfToken,
        cookieHeader,
        chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
        chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
        firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
      });

      try {
        const local = await removeLikeFromArchive(String(id));
        console.log(`\n  ✓ Unliked on X: ${id}`);
        console.log(`  Local archive: ${local.removed ? 'removed cached record' : 'record not found locally'}`);
        console.log(`  Remaining likes: ${local.totalRemaining}`);
        console.log(`  Cache: ${local.cachePath}`);
        console.log(`  Index: ${local.dbPath}\n`);
      } catch (error) {
        throw new Error(
          `Unliked on X, but failed to update the local archive.\n` +
          `Recovery: run ft likes sync or ft likes index.\n` +
          `Details: ${(error as Error).message}`
        );
      }
    }));

  likes
    .command('trim')
    .description('Keep only the latest likes and unlike older posts on X in throttled batches')
    .option('--keep <n>', 'Number of newest likes to keep locally and remotely', (v: string) => Number(v), 200)
    .option('--batch-size <n>', 'How many likes to unlike per batch', (v: string) => Number(v), 25)
    .option('--pause-seconds <n>', 'Seconds to pause between batches', (v: string) => Number(v), 45)
    .option('--rate-limit-backoff-seconds <n>', 'Seconds to wait before retrying a 429 response', (v: string) => Number(v), 300)
    .option('--max-rate-limit-retries <n>', 'How many times to retry the same like after a 429', (v: string) => Number(v), 3)
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (options) => {
      if (!requireLikesData()) return;

      let csrfToken: string | undefined;
      let cookieHeader: string | undefined;
      if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
        csrfToken = String(options.cookies[0]);
        const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
        const parts = [`ct0=${csrfToken}`];
        if (authToken) parts.push(`auth_token=${authToken}`);
        cookieHeader = parts.join('; ');
      }

      const keep = Math.max(0, Number(options.keep) || 0);
      const batchSize = Math.max(1, Number(options.batchSize) || 25);
      const pauseSeconds = Math.max(0, Number(options.pauseSeconds) || 0);
      const rateLimitBackoffSeconds = Math.max(1, Number(options.rateLimitBackoffSeconds) || 300);
      const maxRateLimitRetries = Math.max(0, Number(options.maxRateLimitRetries) || 0);

      console.log(`\n  Trimming likes archive`);
      console.log(`  Keep newest: ${keep}`);
      console.log(`  Batch size: ${batchSize}`);
      console.log(`  Pause: ${pauseSeconds}s\n`);

      const result = await trimLikes({
        keep,
        batchSize,
        pauseSeconds,
        rateLimitBackoffSeconds,
        maxRateLimitRetries,
        browser: options.browser ? String(options.browser) : undefined,
        csrfToken,
        cookieHeader,
        chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
        chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
        firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
        onProgress: (progress) => {
          if (progress.currentTweetId) {
            if (progress.pausedSeconds) {
              process.stderr.write(
                `  Rate limited on ${progress.currentTweetId} · ` +
                `${progress.completed}/${progress.totalToRemove} complete · ` +
                `retrying in ${progress.pausedSeconds}s\n`,
              );
              return;
            }
            process.stderr.write(
              `  Batch ${progress.batchNumber}/${progress.batchTotal} · ` +
              `${progress.completed}/${progress.totalToRemove} complete · ` +
              `unliking ${progress.currentTweetId}\n`,
            );
            return;
          }

          if (progress.pausedSeconds) {
            process.stderr.write(
              `  Batch ${progress.batchNumber}/${progress.batchTotal} complete · ` +
              `${progress.completed}/${progress.totalToRemove} done · ` +
              `pausing ${progress.pausedSeconds}s\n`,
            );
          }
        },
      });

      if (result.removed === 0) {
        console.log(`  No trim needed. Likes already at or below ${keep}.`);
        console.log(`  Current likes: ${result.totalAfter}\n`);
        return;
      }

      console.log(`  ✓ Removed ${result.removed} old likes on X`);
      console.log(`  Remaining likes: ${result.totalAfter}`);
      if (result.keepBoundaryId) console.log(`  Oldest kept like: ${result.keepBoundaryId}`);
      if (result.cachePath) console.log(`  Cache: ${result.cachePath}`);
      if (result.dbPath) console.log(`  Index: ${result.dbPath}`);
      console.log();
    }));

  likes
    .command('status')
    .description('Show likes sync status and data location')
    .action(safe(async () => {
      if (!requireLikesData()) return;
      const view = await getLikesStatusView();
      console.log(formatLikesStatus(view));
    }));

  likes
    .command('search')
    .description('Full-text search across liked posts')
    .argument('<query>', 'Search query (supports FTS5 syntax: AND, OR, NOT, "exact phrase")')
    .option('--author <handle>', 'Filter by author handle')
    .option('--after <date>', 'Likes after this date (YYYY-MM-DD)')
    .option('--before <date>', 'Likes before this date (YYYY-MM-DD)')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 20)
    .action(safe(async (query: string, options) => {
      if (!requireLikesIndex()) return;
      const results = await searchLikes({
        query,
        author: options.author ? String(options.author) : undefined,
        after: options.after ? String(options.after) : undefined,
        before: options.before ? String(options.before) : undefined,
        limit: Number(options.limit) || 20,
      });
      console.log(formatLikeSearchResults(results));
    }));

  likes
    .command('list')
    .description('List liked posts with filters')
    .option('--query <query>', 'Text query (FTS5 syntax)')
    .option('--author <handle>', 'Filter by author handle')
    .option('--after <date>', 'Liked after (YYYY-MM-DD)')
    .option('--before <date>', 'Liked before (YYYY-MM-DD)')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 30)
    .option('--offset <n>', 'Offset into results', (v: string) => Number(v), 0)
    .option('--json', 'JSON output')
    .action(safe(async (options) => {
      if (!requireLikesIndex()) return;
      const items = await listLikes({
        query: options.query ? String(options.query) : undefined,
        author: options.author ? String(options.author) : undefined,
        after: options.after ? String(options.after) : undefined,
        before: options.before ? String(options.before) : undefined,
        limit: Number(options.limit) || 30,
        offset: Number(options.offset) || 0,
      });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      for (const item of items) {
        const summary = item.text.length > 120 ? `${item.text.slice(0, 117)}...` : item.text;
        console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${(item.likedAt ?? item.postedAt)?.slice(0, 10) ?? '?'}`);
        console.log(`  ${summary}`);
        console.log(`  ${item.url}`);
        console.log();
      }
    }));

  likes
    .command('show')
    .description('Show one liked post in detail')
    .argument('<id>', 'Liked post id')
    .option('--json', 'JSON output')
    .action(safe(async (id: string, options) => {
      if (!requireLikesIndex()) return;
      const item = await getLikeById(String(id));
      if (!item) {
        console.log(`  Like not found: ${String(id)}`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${(item.likedAt ?? item.postedAt)?.slice(0, 10) ?? '?'}`);
      console.log(item.text);
      console.log(`\n${item.url}`);
    }));

  likes
    .command('index')
    .description('Rebuild the SQLite search index from the likes JSONL cache')
    .option('--force', 'Drop and rebuild from scratch')
    .action(safe(async (options) => {
      if (!requireLikesData()) return;
      process.stderr.write('Building likes search index...\n');
      const result = await buildLikesIndex({ force: Boolean(options.force) });
      console.log(`Indexed ${result.recordCount} likes (${result.newRecords} new) → ${result.dbPath}`);
    }));

  const resolveBrowserSessionOptions = (options: Record<string, unknown>) => {
    let csrfToken: string | undefined;
    let cookieHeader: string | undefined;
    if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
      csrfToken = String(options.cookies[0]);
      const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
      const parts = [`ct0=${csrfToken}`];
      if (authToken) parts.push(`auth_token=${authToken}`);
      cookieHeader = parts.join('; ');
    }

    return {
      browser: options.browser ? String(options.browser) : undefined,
      csrfToken,
      cookieHeader,
      chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
      chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
      firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
    };
  };

  // ── accounts ──────────────────────────────────────────────────────────

  const accounts = program
    .command('accounts')
    .description('Review followed accounts and manage tracked public-account timelines');

  accounts
    .command('sync')
    .description('Fetch one public account timeline into a separate local archive')
    .argument('<handle>', 'Public X handle, with or without @')
    .option('--limit <n>', 'Max tweets to fetch this run', (v: string) => Number(v), 50)
    .option('--retain <value>', 'Retention window like 90d, 24h, or 180m', '90d')
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (handle: string, options) => {
      ensureDataDir();
      const result = await syncAccountTimelineGraphQL(handle, {
        limit: Number(options.limit) || 50,
        retain: String(options.retain ?? '90d'),
        ...resolveBrowserSessionOptions(options),
      });

      console.log(`\n  ✓ synced @${result.targetHandle}`);
      console.log(`  added: ${result.added}`);
      console.log(`  pruned: ${result.pruned}`);
      console.log(`  total: ${result.totalItems}`);
      console.log(`  latest changed: ${result.latestChanged ? 'yes' : 'no'}`);
      if (result.latestTweetId) console.log(`  latest tweet: ${result.latestTweetId}`);
      console.log(`  ${friendlyStopReason(result.stopReason)}`);
      console.log(`  ✓ Data: ${dataDir()}\n`);
    }));

  accounts
    .command('review')
    .description('Review your current following list and surface conservative unfollow candidates')
    .option('--max-pages <n>', 'Max following-list pages to fetch', (v: string) => Number(v), 1)
    .option('--max-results <n>', 'Max accounts per following page', (v: string) => Number(v), 200)
    .option('--max-stage2 <n>', 'Max accounts to deep-scan before scoring', (v: string) => Number(v), 25)
    .option('--timeline-page-size <n>', 'How many recent posts to inspect per deep-scanned account', (v: string) => Number(v), 20)
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (options) => {
      ensureDataDir();
      const session = resolveBrowserSessionOptions(options);
      const sync = await syncFollowingSnapshot({
        maxPages: Number(options.maxPages) || 1,
        maxResults: Number(options.maxResults) || 200,
        ...session,
      });
      const review = await runAccountReview({
        maxStage2Accounts: Number(options.maxStage2) || 25,
        timelinePageSize: Number(options.timelinePageSize) || 20,
        ...session,
      });
      await buildFollowingReviewIndex({ force: true });

      console.log(`\n  Reviewed ${review.totalAccounts} followed accounts`);
      if (!sync.isComplete) {
        console.log(`  Note: following snapshot is partial (${review.totalAccounts} fetched; more pages remain)`);
      }
      console.log(`  Deep scanned: ${review.stage2Count}`);
      console.log(`  Candidates: ${review.candidateCount}\n`);
      console.log(formatAccountReviewResults(review.results));
      console.log();
    }));

  accounts
    .command('label')
    .description('Store a manual value label for a followed account in the review cache')
    .argument('<handle>', 'Followed account handle, with or without @')
    .argument('<value>', 'Label: valuable, not-valuable, or neutral')
    .action(safe(async (handle: string, value: string) => {
      const account = await requireFollowedAccount(handle);
      if (!account) return;
      const normalized = String(value).trim().toLowerCase();
      if (!['valuable', 'not-valuable', 'neutral'].includes(normalized)) {
        throw new Error('Invalid label. Use: valuable, not-valuable, or neutral.');
      }
      const label = await setFollowingLabel({
        targetUserId: account.userId,
        handle: account.handle,
        value: normalized as 'valuable' | 'not-valuable' | 'neutral',
      });
      await buildFollowingReviewIndex({ force: true });
      console.log(`\n  Saved label for @${account.handle}: ${label.value}\n`);
    }));

  accounts
    .command('unfollow')
    .description('Unfollow one reviewed account on X and reconcile the local review cache')
    .argument('<handle>', 'Followed account handle, with or without @')
    .option('--yes', 'Skip confirmation prompt', false)
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (handle: string, options) => {
      const account = await requireFollowedAccount(handle);
      if (!account) return;
      const reviewItem = await getFollowingReviewItemByHandle(account.handle);
      if (!options.yes) {
        console.log(`\n  About to unfollow @${account.handle}${account.name ? ` (${account.name})` : ''}`);
        if (reviewItem?.primaryReason) {
          console.log(`  Latest review reason: ${reviewItem.primaryReason}`);
        }
        const answer = await promptText('  Continue? (y/N) ', { output: process.stdout });
        if (answer.kind === 'interrupt') {
          throw new PromptCancelledError('Cancelled. Unfollow aborted.', 130);
        }
        if (answer.kind !== 'answer' || answer.value.toLowerCase() !== 'y') {
          console.log('  Aborted.');
          return;
        }
      }

      await unfollowAccount(account.userId, resolveBrowserSessionOptions(options));
      const reconciled = await reconcileUnfollowedAccount(account.userId);
      console.log(`\n  Unfollowed on X: @${account.handle}`);
      console.log(`  Local review cache: ${reconciled.removedFromSnapshot ? 'updated' : 'no matching snapshot row'}`);
      console.log(`  Remaining followed accounts in cache: ${reconciled.totalFollowing}\n`);
    }));

  accounts
    .command('export')
    .description('Export cached tweets for one tracked account as JSON')
    .argument('<handle>', 'Tracked handle, with or without @')
    .option('--after <date>', 'Posted after (YYYY-MM-DD)')
    .option('--before <date>', 'Posted before (YYYY-MM-DD)')
    .option('--out <path>', 'Write JSON to this file instead of stdout')
    .action(safe(async (handle: string, options) => {
      const payload = await exportAccountTimeline(handle, {
        after: options.after ? String(options.after) : undefined,
        before: options.before ? String(options.before) : undefined,
      });
      const json = JSON.stringify(payload, null, 2);
      if (!options.out) {
        console.log(json);
        return;
      }

      const outputPath = path.resolve(String(options.out));
      fs.mkdirSync(path.dirname(outputPath), { recursive: true });
      fs.writeFileSync(outputPath, `${json}\n`);
      console.log(`\n  Exported ${payload.count} tweets for @${payload.account.handle}`);
      console.log(`  Output: ${outputPath}\n`);
    }));

  accounts
    .command('status')
    .description('Show one tracked account archive status')
    .argument('<handle>', 'Tracked handle, with or without @')
    .action(safe(async (handle: string) => {
      const account = await requireTrackedAccount(handle);
      if (!account) return;
      console.log(formatAccountTimelineStatus(await getAccountTimelineStatusView(`@${account.currentHandle}`)));
    }));

  accounts
    .command('list')
    .description('List cached tweets for one tracked account')
    .argument('<handle>', 'Tracked handle, with or without @')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 30)
    .option('--offset <n>', 'Offset into results', (v: string) => Number(v), 0)
    .option('--json', 'JSON output')
    .action(safe(async (handle: string, options) => {
      const account = await requireAccountIndex(handle);
      if (!account) return;
      const items = await listAccountTimeline(account.userId, {
        limit: Number(options.limit) || 30,
        offset: Number(options.offset) || 0,
      });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      for (const item of items) {
        const summary = item.text.length > 120 ? `${item.text.slice(0, 117)}...` : item.text;
        console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${(item.postedAt ?? item.syncedAt)?.slice(0, 10) ?? '?'}`);
        console.log(`  ${summary}`);
        console.log(`  ${item.url}`);
        console.log();
      }
    }));

  accounts
    .command('show')
    .description('Show one cached tracked-account tweet in detail')
    .argument('<handle>', 'Tracked handle, with or without @')
    .argument('<id>', 'Tweet id')
    .option('--json', 'JSON output')
    .action(safe(async (handle: string, id: string, options) => {
      const account = await requireAccountIndex(handle);
      if (!account) return;
      const item = await getAccountTimelineById(account.userId, String(id));
      if (!item) {
        console.log(`  Account timeline item not found: ${String(id)}`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${(item.postedAt ?? item.syncedAt)?.slice(0, 10) ?? '?'}`);
      if (item.authorName) console.log(item.authorName);
      console.log(item.text);
      console.log(`\n${item.url}`);
    }));

  // ── feed ───────────────────────────────────────────────────────────────

  const feed = program
    .command('feed')
    .description('Sync and browse your X Home timeline as a local read-only archive');

  feed
    .command('sync')
    .description('Fetch Home timeline tweets from X into your local feed archive')
    .option('--max-pages <n>', 'Max pages to fetch', (v: string) => Number(v), 5)
    .option('--delay-ms <n>', 'Delay between requests in ms', (v: string) => Number(v), 600)
    .option('--max-minutes <n>', 'Max runtime in minutes', (v: string) => Number(v), 5)
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (options) => {
      const firstRun = isFeedFirstRun();
      if (firstRun) showSyncWelcome();
      ensureDataDir();

      const startTime = Date.now();
      let lastSync: FeedSyncProgress = { page: 0, totalFetched: 0, newAdded: 0, skippedEntries: 0, running: true, done: false };
      const spinner = createSpinner(() => {
        const elapsed = Math.round((Date.now() - startTime) / 1000);
        return `Syncing feed...  ${lastSync.newAdded} new  │  ${lastSync.skippedEntries} skipped  │  page ${lastSync.page}  │  ${elapsed}s`;
      });

      let csrfToken: string | undefined;
      let cookieHeader: string | undefined;
      if (options.cookies && Array.isArray(options.cookies) && options.cookies.length > 0) {
        csrfToken = String(options.cookies[0]);
        const authToken = options.cookies.length > 1 ? String(options.cookies[1]) : undefined;
        const parts = [`ct0=${csrfToken}`];
        if (authToken) parts.push(`auth_token=${authToken}`);
        cookieHeader = parts.join('; ');
      }

      const result = await runWithSpinner(spinner, () => syncFeedGraphQL({
        maxPages: Number(options.maxPages) || 5,
        delayMs: Number(options.delayMs) || 600,
        maxMinutes: Number(options.maxMinutes) || 5,
        browser: options.browser ? String(options.browser) : undefined,
        csrfToken,
        cookieHeader,
        chromeUserDataDir: options.chromeUserDataDir ? String(options.chromeUserDataDir) : undefined,
        chromeProfileDirectory: options.chromeProfileDirectory ? String(options.chromeProfileDirectory) : undefined,
        firefoxProfileDir: options.firefoxProfileDir ? String(options.firefoxProfileDir) : undefined,
        onProgress: (status: FeedSyncProgress) => {
          lastSync = status;
          spinner.update();
        },
      }));

      console.log(`\n  ✓ ${result.added} new feed items synced (${result.totalItems} total)`);
      console.log(`  Skipped non-tweet entries: ${result.skippedEntries}`);
      console.log(`  ${friendlyStopReason(result.stopReason)}`);
      console.log(`  ✓ Data: ${dataDir()}\n`);
    }));

  feed
    .command('status')
    .description('Show feed sync status and data location')
    .action(safe(async () => {
      if (!requireFeedData()) return;
      const view = await getFeedStatusView();
      console.log(formatFeedStatus(view));
    }));

  feed
    .command('list')
    .description('List cached Home timeline tweets')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 30)
    .option('--offset <n>', 'Offset into results', (v: string) => Number(v), 0)
    .option('--json', 'JSON output')
    .action(safe(async (options) => {
      if (!requireFeedIndex()) return;
      const items = await listFeed({
        limit: Number(options.limit) || 30,
        offset: Number(options.offset) || 0,
      });
      if (options.json) {
        console.log(JSON.stringify(items, null, 2));
        return;
      }
      for (const item of items) {
        const summary = item.text.length > 120 ? `${item.text.slice(0, 117)}...` : item.text;
        console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${(item.postedAt ?? item.syncedAt)?.slice(0, 10) ?? '?'}`);
        console.log(`  ${summary}`);
        console.log(`  ${item.url}`);
        console.log();
      }
    }));

  feed
    .command('show')
    .description('Show one cached feed item in detail')
    .argument('<id>', 'Feed item id')
    .option('--json', 'JSON output')
    .action(safe(async (id: string, options) => {
      if (!requireFeedIndex()) return;
      const item = await getFeedById(String(id));
      if (!item) {
        console.log(`  Feed item not found: ${String(id)}`);
        process.exitCode = 1;
        return;
      }
      if (options.json) {
        console.log(JSON.stringify(item, null, 2));
        return;
      }
      console.log(`${item.id}  ${item.authorHandle ? `@${item.authorHandle}` : '@?'}  ${(item.postedAt ?? item.syncedAt)?.slice(0, 10) ?? '?'}`);
      if (item.authorName) console.log(item.authorName);
      console.log(item.text);
      console.log(`\n${item.url}`);
      console.log(`sortIndex: ${item.sortIndex ?? 'unknown'}  page: ${item.fetchPage ?? '?'}  position: ${item.fetchPosition ?? '?'}`);
    }));

  const feedDaemon = feed
    .command('daemon')
    .description('Run recurring feed collection and local semantic indexing');

  feedDaemon
    .command('start')
    .description('Start the recurring feed daemon')
    .requiredOption('--every <interval>', 'Repeat with an interval like 30s, 5m, or 2h')
    .option('--max-pages <n>', 'How many feed pages to sync on each tick', (v: string) => Number(v), 1)
    .option('--browser <id>', 'Browser to read cookies from (chrome, brave, chromium, firefox)')
    .option('--cookies <value...>', 'Pass cookies directly: <ct0> [auth_token]')
    .option('--chrome-user-data-dir <path>', 'Chrome-family user-data directory')
    .option('--chrome-profile-directory <name>', 'Chrome-family profile directory name')
    .option('--firefox-profile-dir <path>', 'Firefox profile directory path')
    .action(safe(async (options) => {
      ensureDataDir();
      const intervalMs = parseIntervalMs(String(options.every));
      console.log(`Feed daemon: every ${String(options.every)}`);
      console.log('  Each tick: refresh feed -> refresh semantic index');
      await startFeedDaemon({
        everyMs: intervalMs,
        maxPages: options.maxPages != null ? Number(options.maxPages) : 1,
        ...resolveBrowserSessionOptions(options),
      });
    }));

  feedDaemon
    .command('status')
    .description('Show daemon status and the last tick result')
    .action(safe(async () => {
      console.log(await formatFeedDaemonStatus());
    }));

  feedDaemon
    .command('stop')
    .description('Stop the recurring feed daemon')
    .action(safe(async () => {
      const result = await stopFeedDaemon();
      if (!result.stopped) {
        console.log(`Feed daemon is not running${result.pid ? ` (stale pid ${result.pid})` : ''}.`);
        return;
      }
      console.log(`Stopped feed daemon pid=${result.pid}`);
    }));

  feedDaemon
    .command('log')
    .description('Show daemon activity summary')
    .action(safe(async () => {
      const state = await getFeedDaemonState();
      console.log(await formatFeedDaemonStatus());
      if (state.pid) console.log('\n  Use your shell or tail on the daemon log for live follow-up.');
    }));

  const feedSemantic = feed
    .command('semantic')
    .description('Inspect and rebuild the local semantic retrieval index');

  feedSemantic
    .command('status')
    .description('Show semantic provider config and local vector coverage')
    .action(safe(async () => {
      console.log(formatSemanticStatus(await getSemanticStatusView()));
    }));

  feedSemantic
    .command('rebuild')
    .description('Rebuild semantic vectors for feed, likes, and bookmarks')
    .action(safe(async () => {
      ensureDataDir();
      const meta = await rebuildSemanticIndex();
      console.log(formatSemanticStatus(await getSemanticStatusView()));
      console.log(`\nSemantic rebuild complete at ${meta.updatedAt}.`);
    }));

  // ── path ────────────────────────────────────────────────────────────────

  program
    .command('path')
    .description('Print the data directory path')
    .action(() => { console.log(dataDir()); });

  // ── sample ──────────────────────────────────────────────────────────────

  bookmarks
    .command('sample')
    .description('Sample bookmarks by category')
    .argument('<category>', 'Category: tool, security, technique, launch, research, opinion, commerce')
    .option('--limit <n>', 'Max results', (v: string) => Number(v), 10)
    .action(safe(async (category: string, options) => {
      if (!requireIndex()) return;
      const results = await sampleByCategory(category, Number(options.limit) || 10);
      if (results.length === 0) {
        console.log(`  No bookmarks found with category "${category}". Run: ft bookmarks classify`);
        return;
      }
      for (const r of results) {
        const text = r.text.length > 120 ? r.text.slice(0, 120) + '...' : r.text;
        console.log(`[@${r.authorHandle ?? '?'}] ${text}`);
        console.log(`  ${r.url}  [${r.categories}]`);
        if (r.githubUrls) console.log(`  github: ${r.githubUrls}`);
        console.log();
      }
    }));

  // ── fetch-media ─────────────────────────────────────────────────────────

  bookmarks
    .command('fetch-media')
    .description('Download media assets for bookmarks (static images only)')
    .option('--limit <n>', 'Max bookmarks to process', (v: string) => Number(v), 100)
    .option('--max-bytes <n>', 'Per-asset byte limit', (v: string) => Number(v), 50 * 1024 * 1024)
    .action(safe(async (options) => {
      if (!requireData()) return;
      const result = await fetchBookmarkMediaBatch({
        limit: Number(options.limit) || 100,
        maxBytes: Number(options.maxBytes) || 50 * 1024 * 1024,
      });
      console.log(JSON.stringify(result, null, 2));
    }));

  // ── ft md ── Export bookmarks as markdown files ────────────────────────

  program
    .command('md')
    .description('Export bookmarks as individual markdown files')
    .option('--force', 'Re-export all bookmarks (overwrite existing files)')
    .action(safe(async (options) => {
      if (!requireIndex()) return;
      let lastLine = '';
      const spinner = createSpinner(() => lastLine);
      const result = await exportBookmarks({
        force: options.force,
        onProgress: (s) => {
          lastLine = s;
          spinner.update();
        },
      });
      spinner.stop();
      const skippedNote = result.skipped > 0 ? ` (${result.skipped} already existed)` : '';
      console.log(`Exported ${result.exported}/${result.total} bookmarks${skippedNote}`);
      console.log(`  ${result.elapsed}s elapsed`);
      console.log(`\n  Open in your markdown viewer:\n  ${mdDir()}`);
    }));

  // ── ft wiki ── Compile Karpathy-style knowledge base ────────────────────

  program
    .command('wiki')
    .description('Compile Karpathy-style markdown wiki from bookmarks')
    .option('--full', 'Recompile all pages (ignore incremental cache)')
    .action(safe(async (options) => {
      if (!requireIndex()) return;
      const start = Date.now();
      let lastLine = '';
      const spinner = createSpinner(() => lastLine);
      const result = await compileMd({
        full: options.full,
        onProgress: (s) => {
          lastLine = s;
          spinner.update();
        },
      });
      spinner.stop();
      const elapsed = ((Date.now() - start) / 1000).toFixed(1);
      const failed = result.pagesFailed > 0 ? ` failed=${result.pagesFailed}` : '';
      console.log(`Done (${elapsed}s) — engine=${result.engine} created=${result.pagesCreated} updated=${result.pagesUpdated} skipped=${result.pagesSkipped}${failed} total=${result.totalPages}`);
      if (result.pagesFailed > 0) {
        console.log(`\n  ${result.pagesFailed} page(s) failed — re-run ft wiki to retry them.`);
      }
      console.log(`\n  Open in your markdown viewer:\n  ${mdDir()}`);
    }));

  // ── ft ask ── Q&A against the knowledge base ──────────────────────────

  program
    .command('ask')
    .description('Ask a question against the markdown knowledge base')
    .argument('<question>', 'The question to answer')
    .option('--save', 'Save the answer as a concept page')
    .option('--json', 'Output JSON instead of text')
    .action(safe(async (question, options) => {
      if (!requireIndex()) return;
      let lastLine = '';
      const spinner = createSpinner(() => lastLine);
      const result = await askMd(question, {
        save: options.save,
        onProgress: (s) => {
          lastLine = s;
          spinner.update();
        },
      });
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`\n${result.answer}`);
        if (result.pagesRead.length > 0) {
          console.log(`\nSources: ${result.pagesRead.join(', ')}`);
        }
        if (result.wikiUpdates.length > 0) {
          console.log('\nSuggested updates:');
          for (const u of result.wikiUpdates) console.log(`  - ${u}`);
        }
        if (result.savedAs) {
          console.log(`\nSaved to: ${result.savedAs}`);
        }
      }
    }));

  // ── ft lint ── Health-check the markdown wiki ─────────────────────────

  program
    .command('lint')
    .description('Health-check the markdown knowledge base')
    .option('--fix', 'Auto-fix fixable issues with targeted recompile')
    .option('--json', 'Output JSON instead of text')
    .action(safe(async (options) => {
      if (!requireIndex()) return;
      const result = await lintMd();

      if (options.fix && result.issues.some((i) => i.fixable)) {
        console.log('Fixing issues...');
        const fixed = await fixLintIssues(result.issues);
        console.log(`Fixed ${fixed} pages.`);
        return;
      }

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(`Pages: ${result.stats.totalPages}  Links: ${result.stats.totalLinks}  Health: ${result.stats.healthScore}%`);
      if (result.issues.length === 0) {
        console.log('No issues found.');
      } else {
        for (const issue of result.issues) {
          const page = issue.page ? ` ${issue.page}` : '';
          const fix = issue.fixable ? ' (fixable)' : '';
          console.log(`  [${issue.type}]${page}: ${issue.detail}${fix}`);
        }
      }
    }));

  // ── skill ──────────────────────────────────────────────────────────────

  const skill = program
    .command('skill')
    .description('Install the /fieldtheory skill for AI coding agents');

  skill
    .command('install')
    .description('Install skill for detected agents (Claude Code, Codex)')
    .action(safe(async () => {
      const results = await installSkill();
      if (results.length === 0) {
        console.log('  No agents detected. Use `ft skill show` to copy manually.');
        return;
      }
      const labels: Record<string, string> = {
        installed: 'Installed',
        updated: 'Updated',
        'up-to-date': 'Already up to date',
      };
      for (const r of results) {
        console.log(`  ${labels[r.action] ?? r.action} for ${r.agent}: ${r.path}`);
      }
      if (results.some((r) => r.action === 'installed' || r.action === 'updated')) {
        console.log(`\n  Try: /fieldtheory in Claude Code, or ask about your bookmarks in Codex.`);
      }
    }));

  skill
    .command('show')
    .description('Print skill content to stdout')
    .action(() => {
      process.stdout.write(skillWithFrontmatter());
    });

  skill
    .command('uninstall')
    .description('Remove installed skill files')
    .action(safe(async () => {
      const results = uninstallSkill();
      if (results.length === 0) {
        console.log('  No installed skills found.');
        return;
      }
      for (const r of results) {
        console.log(`  Removed from ${r.agent}: ${r.path}`);
      }
    }));

  program.on('afterHelp', showCachedUpdateNotice);

  return program;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const program = buildCli();
  program.hook('postAction', async () => { await checkForUpdate(); });
  await program.parseAsync(process.argv);
}
