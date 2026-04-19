import { readFollowingSnapshot, writeFollowingSnapshot } from './following-review-state.js';
import { buildXGraphqlHeaders, fetchXResource, resolveXSessionAuth, xApiOrigin, type XSessionOptions, XRequestError } from './x-graphql.js';
import type { FollowedAccountSnapshot } from './types.js';

const USER_FIELDS = [
  'created_at',
  'description',
  'most_recent_tweet_id',
  'name',
  'profile_image_url',
  'protected',
  'public_metrics',
  'username',
  'verified',
].join(',');

export interface AuthenticatedXUser {
  userId: string;
  handle: string;
  name?: string;
}

export interface FollowingPageResult {
  accounts: FollowedAccountSnapshot[];
  nextToken?: string;
}

export interface FollowingSyncResult {
  sourceUserId: string;
  totalFollowing: number;
  snapshotPath: string;
  statePath: string;
  isComplete: boolean;
  nextToken?: string;
}

function normalizeHandle(value: string | undefined): string {
  return String(value ?? '').trim().replace(/^@+/, '').toLowerCase();
}

function buildUsersMeUrl(): string {
  return `${xApiOrigin()}/2/users/me?user.fields=username,name`;
}

function buildFollowingUrl(sourceUserId: string, options: { maxResults?: number; paginationToken?: string } = {}): string {
  const params = new URLSearchParams({
    'user.fields': USER_FIELDS,
    max_results: String(options.maxResults ?? 1000),
  });
  if (options.paginationToken) params.set('pagination_token', options.paginationToken);
  return `${xApiOrigin()}/2/users/${sourceUserId}/following?${params}`;
}

function buildXApiHeaders(options: XSessionOptions = {}): Record<string, string> {
  const session = resolveXSessionAuth(options);
  const headers = buildXGraphqlHeaders(session);
  headers.accept = 'application/json';
  headers.referer = `${xApiOrigin()}/`;
  return headers;
}

export function parseAuthenticatedUserResponse(json: any): AuthenticatedXUser {
  const data = json?.data;
  const userId = data?.id;
  const handle = data?.username;
  if (!userId || !handle) throw new Error('Authenticated user response did not include id and username.');
  return {
    userId: String(userId),
    handle: normalizeHandle(handle),
    name: data?.name ? String(data.name) : undefined,
  };
}

export function normalizeFollowedAccount(
  user: any,
  now: string,
  sourceUserId?: string,
): FollowedAccountSnapshot | null {
  const userId = user?.id;
  const handle = user?.username;
  if (!userId || !handle) return null;
  const metrics = user?.public_metrics;
  return {
    userId: String(userId),
    handle: normalizeHandle(handle),
    name: user?.name ? String(user.name) : undefined,
    description: user?.description ? String(user.description) : undefined,
    profileImageUrl: user?.profile_image_url ? String(user.profile_image_url) : undefined,
    followersCount: typeof metrics?.followers_count === 'number' ? metrics.followers_count : undefined,
    followingCount: typeof metrics?.following_count === 'number' ? metrics.following_count : undefined,
    statusesCount: typeof metrics?.tweet_count === 'number' ? metrics.tweet_count : undefined,
    verified: Boolean(user?.verified),
    protected: Boolean(user?.protected),
    state: user?.protected ? 'protected' : 'active',
    sourceUserId,
    lastPostedAt: undefined,
    lastSyncedAt: now,
  };
}

export function parseFollowingResponse(
  json: any,
  options: { now?: string; sourceUserId?: string } = {},
): FollowingPageResult {
  const now = options.now ?? new Date().toISOString();
  const data = json?.data;
  if (!Array.isArray(data)) throw new Error('Following response did not include a data array.');

  const byUserId = new Map<string, FollowedAccountSnapshot>();
  for (const user of data) {
    const snapshot = normalizeFollowedAccount(user, now, options.sourceUserId);
    if (!snapshot) continue;
    byUserId.set(snapshot.userId, snapshot);
  }

  return {
    accounts: Array.from(byUserId.values()),
    nextToken: typeof json?.meta?.next_token === 'string' ? json.meta.next_token : undefined,
  };
}

export async function resolveAuthenticatedXUser(options: XSessionOptions = {}): Promise<AuthenticatedXUser> {
  const response = await fetchXResource(buildUsersMeUrl(), {
    headers: buildXApiHeaders(options),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new XRequestError(
      response.status === 401 || response.status === 403
        ? `Authenticated user lookup unauthorized (${response.status}). Refresh your X session in the browser and retry.`
        : `Authenticated user lookup failed (${response.status}). Response: ${text.slice(0, 300)}`,
      { kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream', status: response.status },
    );
  }

  return parseAuthenticatedUserResponse(await response.json());
}

export async function fetchFollowingPage(
  sourceUserId: string,
  options: XSessionOptions & { maxResults?: number; paginationToken?: string } = {},
): Promise<FollowingPageResult> {
  const response = await fetchXResource(buildFollowingUrl(sourceUserId, options), {
    headers: buildXApiHeaders(options),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new XRequestError(
      response.status === 401 || response.status === 403
        ? `Following list fetch unauthorized (${response.status}). Refresh your X session in the browser and retry.`
        : `Following list fetch failed (${response.status}). Response: ${text.slice(0, 300)}`,
      { kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream', status: response.status },
    );
  }

  return parseFollowingResponse(await response.json(), {
    sourceUserId,
  });
}

export async function syncFollowingSnapshot(
  options: XSessionOptions & { maxPages?: number; maxResults?: number } = {},
): Promise<FollowingSyncResult> {
  const viewer = await resolveAuthenticatedXUser(options);
  const maxPages = Math.max(1, Number(options.maxPages) || 1);
  const maxResults = Math.min(1000, Math.max(1, Number(options.maxResults) || 200));
  const now = new Date().toISOString();
  const byUserId = new Map<string, FollowedAccountSnapshot>();
  let nextToken: string | undefined;

  for (let page = 0; page < maxPages; page += 1) {
    const result = await fetchFollowingPage(viewer.userId, {
      ...options,
      maxResults,
      paginationToken: nextToken,
    });
    for (const account of result.accounts) {
      byUserId.set(account.userId, {
        ...account,
        sourceUserId: viewer.userId,
        lastSyncedAt: now,
      });
    }
    nextToken = result.nextToken;
    if (!nextToken) break;
  }

  const isComplete = !nextToken;
  const mergedSnapshot = isComplete
    ? Array.from(byUserId.values())
    : (() => {
      const existingByUserId = new Map<string, FollowedAccountSnapshot>();
      return readFollowingSnapshot().then((existing) => {
        for (const account of existing) existingByUserId.set(account.userId, account);
        for (const account of byUserId.values()) existingByUserId.set(account.userId, account);
        return Array.from(existingByUserId.values());
      });
    })();
  const snapshot = await writeFollowingSnapshot(await mergedSnapshot, {
    sourceUserId: viewer.userId,
    lastSyncedAt: now,
    lastCursor: nextToken,
    complete: isComplete,
  });

  return {
    sourceUserId: viewer.userId,
    totalFollowing: snapshot.length,
    snapshotPath: 'following/snapshot.jsonl',
    statePath: 'following/review-state.json',
    isComplete,
    nextToken,
  };
}
