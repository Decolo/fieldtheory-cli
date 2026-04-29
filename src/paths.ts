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

export function likeMediaDir(): string {
  return path.join(dataDir(), 'likes-media');
}

export function likeMediaManifestPath(): string {
  return path.join(dataDir(), 'likes-media-manifest.json');
}

export function twitterBookmarksIndexPath(): string {
  return path.join(dataDir(), 'bookmarks.db');
}

export function twitterBookmarkAnalysisPath(): string {
  return path.join(dataDir(), 'bookmark-analysis.jsonl');
}

export function twitterBookmarkAnalysisMetaPath(): string {
  return path.join(dataDir(), 'bookmark-analysis-meta.json');
}

export function twitterBookmarkCurationPath(): string {
  return path.join(dataDir(), 'bookmark-curation.jsonl');
}

export function twitterBookmarkCurationMetaPath(): string {
  return path.join(dataDir(), 'bookmark-curation-meta.json');
}

export function twitterBookmarkCurationProfilePath(): string {
  return path.join(dataDir(), 'curation-profile.md');
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

export function twitterFeedContextRootDir(): string {
  return path.join(dataDir(), 'feed-context');
}

export function twitterFeedContextBundlePath(rootFeedTweetId: string): string {
  return path.join(twitterFeedContextRootDir(), `${String(rootFeedTweetId)}.json`);
}

export function twitterFeedContextStatePath(): string {
  return path.join(twitterFeedContextRootDir(), 'state.json');
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

export function isFirstRun(): boolean {
  return !fs.existsSync(twitterBookmarksCachePath());
}
