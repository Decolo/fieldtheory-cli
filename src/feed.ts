import { pathExists, readJson, readJsonLines } from './fs.js';
import { twitterFeedCachePath, twitterFeedMetaPath, twitterFeedStatePath } from './paths.js';
import type { FeedBackfillState, FeedCacheMeta, FeedRecord } from './types.js';

export function latestFeedSyncAt(meta?: Pick<FeedCacheMeta, 'lastSyncAt'> | null): string | null {
  return meta?.lastSyncAt ?? null;
}

export async function getTwitterFeedStatus(): Promise<FeedCacheMeta & { cachePath: string; metaPath: string }> {
  const cachePath = twitterFeedCachePath();
  const metaPath = twitterFeedMetaPath();
  const statePath = twitterFeedStatePath();
  const meta = (await pathExists(metaPath))
    ? await readJson<FeedCacheMeta>(metaPath)
    : undefined;
  const state = (await pathExists(statePath))
    ? await readJson<FeedBackfillState>(statePath)
    : undefined;
  const metaUpdatedAt = latestFeedSyncAt(meta);
  const graphQlStatusIsNewer = Boolean(
    state?.lastRunAt && (!metaUpdatedAt || Date.parse(state.lastRunAt) > Date.parse(metaUpdatedAt))
  );

  if (graphQlStatusIsNewer) {
    const cache = await readJsonLines<FeedRecord>(cachePath);
    return {
      provider: 'twitter',
      schemaVersion: 1,
      lastSyncAt: state?.lastRunAt,
      totalItems: cache.length,
      totalSkippedEntries: state?.totalSkippedEntries ?? meta?.totalSkippedEntries ?? 0,
      cachePath,
      metaPath,
    };
  }

  return {
    provider: 'twitter',
    schemaVersion: 1,
    lastSyncAt: meta?.lastSyncAt,
    totalItems: meta?.totalItems ?? 0,
    totalSkippedEntries: meta?.totalSkippedEntries ?? 0,
    cachePath,
    metaPath,
  };
}
