import { pathExists, readJson } from './fs.js';
import { resolveTrackedAccount } from './account-registry.js';
import { twitterAccountTimelineCachePath, twitterAccountTimelineMetaPath, twitterAccountTimelineStatePath } from './paths.js';
import type { AccountTimelineCacheMeta, AccountTimelineState } from './types.js';

export interface ResolvedTrackedAccount {
  userId: string;
  currentHandle: string;
  name?: string;
}

export async function resolveTrackedAccountOrThrow(handle: string): Promise<ResolvedTrackedAccount> {
  const resolved = await resolveTrackedAccount(handle);
  if (!resolved) throw new Error(`No local archive found for ${handle}. Run: ft accounts sync ${handle}`);
  return resolved;
}

export async function getAccountTimelineStatus(handle: string): Promise<{
  account: ResolvedTrackedAccount;
  meta?: AccountTimelineCacheMeta;
  state?: AccountTimelineState;
  cachePath: string;
  metaPath: string;
}> {
  const account = await resolveTrackedAccountOrThrow(handle);
  const cachePath = twitterAccountTimelineCachePath(account.userId);
  const metaPath = twitterAccountTimelineMetaPath(account.userId);
  const statePath = twitterAccountTimelineStatePath(account.userId);

  const meta = (await pathExists(metaPath)) ? await readJson<AccountTimelineCacheMeta>(metaPath) : undefined;
  const state = (await pathExists(statePath)) ? await readJson<AccountTimelineState>(statePath) : undefined;

  return { account, meta, state, cachePath, metaPath };
}
