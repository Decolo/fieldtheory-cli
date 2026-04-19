import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

export function dataDir(): string {
  const override = process.env.FT_DATA_DIR;
  if (override) return override;
  return path.join(os.homedir(), '.ft-bookmarks');
}

function ensureDirSync(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
}

export function ensureDataDir(): string {
  const dir = dataDir();
  ensureDirSync(dir);
  return dir;
}

export function twitterBookmarksCachePath(): string {
  return path.join(dataDir(), 'bookmarks.jsonl');
}

export function twitterBookmarksMetaPath(): string {
  return path.join(dataDir(), 'bookmarks-meta.json');
}

export function twitterBackfillStatePath(): string {
  return path.join(dataDir(), 'bookmarks-backfill-state.json');
}

export function bookmarkMediaDir(): string {
  return path.join(dataDir(), 'media');
}

export function bookmarkMediaManifestPath(): string {
  return path.join(dataDir(), 'media-manifest.json');
}

export function twitterBookmarksIndexPath(): string {
  return path.join(dataDir(), 'bookmarks.db');
}

export function twitterLikesCachePath(): string {
  return path.join(dataDir(), 'likes.jsonl');
}

export function twitterLikesMetaPath(): string {
  return path.join(dataDir(), 'likes-meta.json');
}

export function twitterLikesBackfillStatePath(): string {
  return path.join(dataDir(), 'likes-backfill-state.json');
}

export function twitterLikesIndexPath(): string {
  return path.join(dataDir(), 'likes.db');
}

export function isLikesFirstRun(): boolean {
  return !fs.existsSync(twitterLikesCachePath());
}

export function twitterFeedCachePath(): string {
  return path.join(dataDir(), 'feed.jsonl');
}

export function twitterFeedMetaPath(): string {
  return path.join(dataDir(), 'feed-meta.json');
}

export function twitterFeedStatePath(): string {
  return path.join(dataDir(), 'feed-state.json');
}

export function twitterFeedIndexPath(): string {
  return path.join(dataDir(), 'feed.db');
}

export function twitterArchiveCachePath(): string {
  return path.join(dataDir(), 'archive.jsonl');
}

export function twitterArchiveIndexPath(): string {
  return path.join(dataDir(), 'archive.db');
}

export function isFeedFirstRun(): boolean {
  return !fs.existsSync(twitterFeedCachePath());
}

export function twitterFeedDaemonStatePath(): string {
  return path.join(dataDir(), 'feed-daemon-state.json');
}

export function twitterFeedDaemonLogPath(): string {
  return path.join(dataDir(), 'feed-daemon.log');
}

export function twitterSemanticStorePath(): string {
  return path.join(dataDir(), 'semantic.lance');
}

export function twitterSemanticMetaPath(): string {
  return path.join(dataDir(), 'semantic-meta.json');
}

export function twitterAccountsRootDir(): string {
  return path.join(dataDir(), 'accounts');
}

export function twitterAccountsRegistryPath(): string {
  return path.join(dataDir(), 'accounts-registry.json');
}

export function twitterAccountDir(userId: string): string {
  return path.join(twitterAccountsRootDir(), String(userId));
}

export function twitterAccountTimelineCachePath(userId: string): string {
  return path.join(twitterAccountDir(userId), 'timeline.jsonl');
}

export function twitterAccountTimelineMetaPath(userId: string): string {
  return path.join(twitterAccountDir(userId), 'timeline-meta.json');
}

export function twitterAccountTimelineStatePath(userId: string): string {
  return path.join(twitterAccountDir(userId), 'timeline-state.json');
}

export function twitterAccountTimelineIndexPath(userId: string): string {
  return path.join(twitterAccountDir(userId), 'timeline.db');
}

export function twitterFollowingRootDir(): string {
  return path.join(dataDir(), 'following');
}

export function twitterFollowingSnapshotPath(): string {
  return path.join(twitterFollowingRootDir(), 'snapshot.jsonl');
}

export function twitterFollowingLabelsPath(): string {
  return path.join(twitterFollowingRootDir(), 'labels.json');
}

export function twitterFollowingReviewResultsPath(): string {
  return path.join(twitterFollowingRootDir(), 'review-results.jsonl');
}

export function twitterFollowingReviewStatePath(): string {
  return path.join(twitterFollowingRootDir(), 'review-state.json');
}

export function twitterFollowingReviewIndexPath(): string {
  return path.join(twitterFollowingRootDir(), 'review.db');
}

export function twitterFollowingAccountCacheDir(): string {
  return path.join(twitterFollowingRootDir(), 'accounts');
}

export function twitterFollowingAccountCachePath(userId: string): string {
  return path.join(twitterFollowingAccountCacheDir(), `${String(userId)}.json`);
}

export function preferencesPath(): string {
  return path.join(dataDir(), '.preferences');
}

export function isFirstRun(): boolean {
  return !fs.existsSync(twitterBookmarksCachePath());
}

// ── Markdown wiki paths ──────────────────────────────────────────────────

export function mdDir(): string {
  return path.join(dataDir(), 'md');
}

export function mdIndexPath(): string {
  return path.join(mdDir(), 'index.md');
}

export function mdLogPath(): string {
  return path.join(mdDir(), 'log.md');
}

export function mdStatePath(): string {
  return path.join(mdDir(), 'md-state.json');
}

export function mdSchemaPath(): string {
  return path.join(dataDir(), 'schema.md');
}

export function mdCategoriesDir(): string {
  return path.join(mdDir(), 'categories');
}

export function mdDomainsDir(): string {
  return path.join(mdDir(), 'domains');
}

export function mdEntitiesDir(): string {
  return path.join(mdDir(), 'entities');
}

export function mdConceptsDir(): string {
  return path.join(mdDir(), 'concepts');
}
