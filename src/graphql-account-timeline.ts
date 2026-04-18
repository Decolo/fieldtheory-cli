import path from 'node:path';
import { ensureDir, pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from './fs.js';
import { rememberAccountHandle, normalizeAccountHandle } from './account-registry.js';
import { buildAccountTimelineIndex } from './account-timeline-db.js';
import {
  ensureDataDir,
  twitterAccountTimelineCachePath,
  twitterAccountTimelineMetaPath,
  twitterAccountTimelineStatePath,
} from './paths.js';
import { buildGraphqlUrl, buildXGraphqlHeaders, fetchXResource, resolveXSessionAuth, type XSessionOptions, XRequestError } from './x-graphql.js';
import type {
  AccountTimelineCacheMeta,
  AccountTimelineRecord,
  AccountTimelineState,
  BookmarkAuthorSnapshot,
  BookmarkMediaObject,
  QuotedTweetSnapshot,
} from './types.js';

const USER_BY_SCREEN_NAME_QUERY_ID = '1VOOyvKkiI3FMmkeDNxM9A';
const USER_BY_SCREEN_NAME_OPERATION = 'UserByScreenName';
const USER_TWEETS_AND_REPLIES_QUERY_ID = 'OAx9yEcW3JA9bPo63pcYlA';
const USER_TWEETS_AND_REPLIES_OPERATION = 'UserTweetsAndReplies';
const STALE_PAGE_LIMIT = 1;

const USER_LOOKUP_FEATURES = {
  highlights_tweets_tab_ui_enabled: true,
  hidden_profile_likes_enabled: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  hidden_profile_subscriptions_enabled: true,
  subscriptions_verification_info_verified_since_enabled: true,
  subscriptions_verification_info_is_identity_verified_enabled: false,
  responsive_web_twitter_article_notes_tab_enabled: false,
  subscriptions_feature_can_gift_premium: false,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
};

const ACCOUNT_TIMELINE_FEATURES = {
  articles_preview_enabled: false,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  communities_web_enable_tweet_community_results_fetch: true,
  creator_subscriptions_tweet_preview_api_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  longform_notetweets_consumption_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  responsive_web_enhance_cards_enabled: false,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  verified_phone_label_enabled: false,
  view_counts_everywhere_api_enabled: true,
  premium_content_api_read_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: false,
  responsive_web_jetfuel_frame: false,
  rweb_video_screen_enabled: true,
};

interface AccountTimelinePageResult {
  records: AccountTimelineRecord[];
  nextCursor?: string;
  skippedEntries: number;
}

export interface ResolvedAccount {
  userId: string;
  handle: string;
  name?: string;
}

export interface AccountTimelineSyncOptions extends XSessionOptions {
  limit?: number;
  retain?: string;
  onProgress?: (status: { fetched: number; added: number; pruned: number; pages: number }) => void;
}

export interface AccountTimelineSyncResult {
  userId: string;
  targetHandle: string;
  added: number;
  pruned: number;
  totalItems: number;
  latestChanged: boolean;
  latestTweetId?: string;
  stopReason: string;
  cachePath: string;
  metaPath: string;
  statePath: string;
  dbPath: string;
}

function extractAuthor(userResult: any): BookmarkAuthorSnapshot | undefined {
  if (!userResult) return undefined;
  const authorHandle = userResult?.core?.screen_name ?? userResult?.legacy?.screen_name;
  const authorName = userResult?.core?.name ?? userResult?.legacy?.name;
  const authorProfileImageUrl =
    userResult?.avatar?.image_url ??
    userResult?.legacy?.profile_image_url_https ??
    userResult?.legacy?.profile_image_url;

  return {
    handle: authorHandle,
    name: authorName,
    profileImageUrl: authorProfileImageUrl,
    description: userResult?.legacy?.description,
    location: userResult?.legacy?.location,
    verified: Boolean(userResult?.is_blue_verified ?? userResult?.legacy?.verified),
    followersCount: userResult?.legacy?.followers_count,
    followingCount: userResult?.legacy?.friends_count,
    statusesCount: userResult?.legacy?.statuses_count,
  };
}

function extractQuotedTweet(quotedResult: any): QuotedTweetSnapshot | undefined {
  const quotedTweet = quotedResult?.tweet ?? quotedResult;
  const quotedLegacy = quotedTweet?.legacy;
  if (!quotedLegacy) return undefined;
  const quotedTweetId = quotedLegacy.id_str ?? quotedTweet?.rest_id;
  if (!quotedTweetId) return undefined;
  const quotedUser = quotedTweet?.core?.user_results?.result;
  const authorHandle = quotedUser?.core?.screen_name ?? quotedUser?.legacy?.screen_name;
  const authorName = quotedUser?.core?.name ?? quotedUser?.legacy?.name;
  const authorProfileImageUrl =
    quotedUser?.avatar?.image_url ??
    quotedUser?.legacy?.profile_image_url_https ??
    quotedUser?.legacy?.profile_image_url;
  const mediaEntities = quotedLegacy?.extended_entities?.media ?? quotedLegacy?.entities?.media ?? [];

  return {
    id: quotedTweetId,
    text: quotedTweet?.note_tweet?.note_tweet_results?.result?.text ?? quotedLegacy.full_text ?? quotedLegacy.text ?? '',
    authorHandle,
    authorName,
    authorProfileImageUrl,
    postedAt: quotedLegacy.created_at ?? null,
    media: mediaEntities.map((m: any) => m.media_url_https ?? m.media_url).filter(Boolean),
    mediaObjects: mediaEntities.map((m: any) => ({
      type: m.type,
      url: m.media_url_https ?? m.media_url,
      expandedUrl: m.expanded_url,
      width: m.original_info?.width,
      height: m.original_info?.height,
      altText: m.ext_alt_text,
    })),
    url: `https://x.com/${authorHandle ?? '_'}/status/${quotedTweetId}`,
  };
}

function parseRetentionMs(raw: string | undefined): number {
  const value = String(raw ?? '90d').trim().toLowerCase();
  const match = value.match(/^(\d+)(m|h|d)$/);
  if (!match) throw new Error(`Invalid retention: "${raw}". Use values like 30d, 12h, or 90m.`);
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Invalid retention: "${raw}".`);
  const unit = match[2];
  if (unit === 'm') return amount * 60_000;
  if (unit === 'h') return amount * 60 * 60_000;
  return amount * 24 * 60 * 60_000;
}

function buildUserLookupUrl(handle: string): string {
  const params = new URLSearchParams({
    variables: JSON.stringify({
      screen_name: normalizeAccountHandle(handle),
      withSafetyModeUserFields: true,
    }),
    features: JSON.stringify(USER_LOOKUP_FEATURES),
  });
  return `${buildGraphqlUrl(USER_BY_SCREEN_NAME_QUERY_ID, USER_BY_SCREEN_NAME_OPERATION)}?${params}`;
}

function buildTimelineUrl(userId: string, count: number, cursor?: string): string {
  const variables: Record<string, unknown> = {
    userId,
    count,
    includePromotedContent: true,
    withCommunity: true,
    withVoice: true,
    withV2Timeline: true,
  };
  if (cursor) variables.cursor = cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(ACCOUNT_TIMELINE_FEATURES),
  });
  return `${buildGraphqlUrl(USER_TWEETS_AND_REPLIES_QUERY_ID, USER_TWEETS_AND_REPLIES_OPERATION)}?${params}`;
}

function chronologyValue(record: Pick<AccountTimelineRecord, 'postedAt' | 'syncedAt' | 'tweetId'>): number {
  const posted = record.postedAt ? Date.parse(record.postedAt) : NaN;
  if (Number.isFinite(posted)) return posted;
  const synced = Date.parse(record.syncedAt);
  if (Number.isFinite(synced)) return synced;
  return 0;
}

function compareTweetIdsDesc(leftTweetId: string, rightTweetId: string): number {
  if (/^\d+$/.test(leftTweetId) && /^\d+$/.test(rightTweetId)) {
    const left = BigInt(leftTweetId);
    const right = BigInt(rightTweetId);
    if (left === right) return 0;
    return left > right ? -1 : 1;
  }
  return rightTweetId.localeCompare(leftTweetId);
}

function compareByChronologyDesc(left: AccountTimelineRecord, right: AccountTimelineRecord): number {
  const chronologyDelta = chronologyValue(right) - chronologyValue(left);
  if (chronologyDelta !== 0) return chronologyDelta;
  return compareTweetIdsDesc(left.tweetId, right.tweetId);
}

function pruneByRetention(records: AccountTimelineRecord[], retentionMs: number, now: string): { records: AccountTimelineRecord[]; pruned: number } {
  const cutoff = Date.parse(now) - retentionMs;
  const kept = records.filter((record) => {
    const candidate = record.postedAt ? Date.parse(record.postedAt) : Date.parse(record.syncedAt);
    return !Number.isFinite(candidate) || candidate >= cutoff;
  });
  return { records: kept, pruned: records.length - kept.length };
}

export async function resolveAccountByHandleGraphQL(handle: string, options: XSessionOptions = {}): Promise<ResolvedAccount> {
  const session = resolveXSessionAuth(options);
  const response = await fetchXResource(buildUserLookupUrl(handle), {
    headers: buildXGraphqlHeaders(session),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new XRequestError(
      response.status === 401 || response.status === 403
        ? `Account lookup unauthorized (${response.status}). Refresh your X session in the browser and retry.`
        : `Account lookup failed (${response.status}). Response: ${text.slice(0, 300)}`,
      { kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream', status: response.status },
    );
  }

  const json = await response.json();
  const user = json?.data?.user?.result;
  const userId = user?.rest_id;
  const resolvedHandle = user?.core?.screen_name ?? user?.legacy?.screen_name;
  const name = user?.core?.name ?? user?.legacy?.name;
  if (!userId || !resolvedHandle) {
    throw new Error(`Account not found or unavailable: @${normalizeAccountHandle(handle)}`);
  }

  return {
    userId: String(userId),
    handle: normalizeAccountHandle(String(resolvedHandle)),
    name: name ? String(name) : undefined,
  };
}

export function convertAccountTimelineTweetToRecord(tweetResult: any, now: string, context: { targetUserId: string; targetHandle?: string; targetName?: string }): AccountTimelineRecord | null {
  const tweet = tweetResult?.tweet ?? tweetResult;
  const legacy = tweet?.legacy;
  if (!legacy) return null;

  const tweetId = legacy.id_str ?? tweet?.rest_id;
  if (!tweetId) return null;

  const userResult = tweet?.core?.user_results?.result;
  const authorUserId = userResult?.rest_id;
  if (!authorUserId || String(authorUserId) !== String(context.targetUserId)) return null;
  const authorHandle = userResult?.core?.screen_name ?? userResult?.legacy?.screen_name;
  const authorName = userResult?.core?.name ?? userResult?.legacy?.name;
  const authorProfileImageUrl =
    userResult?.avatar?.image_url ??
    userResult?.legacy?.profile_image_url_https ??
    userResult?.legacy?.profile_image_url;
  const mediaEntities = legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const media: string[] = mediaEntities.map((m: any) => m.media_url_https ?? m.media_url).filter(Boolean);
  const mediaObjects: BookmarkMediaObject[] = mediaEntities.map((m: any) => ({
    type: m.type,
    url: m.media_url_https ?? m.media_url,
    expandedUrl: m.expanded_url,
    width: m.original_info?.width,
    height: m.original_info?.height,
    altText: m.ext_alt_text,
  }));
  const links: string[] = (legacy?.entities?.urls ?? []).map((u: any) => u.expanded_url ?? u.url).filter((u: string | undefined) => u && !u.includes('t.co'));

  return {
    id: String(tweetId),
    tweetId: String(tweetId),
    targetUserId: String(context.targetUserId),
    targetHandle: context.targetHandle ?? normalizeAccountHandle(authorHandle ?? ''),
    targetName: context.targetName ?? authorName ?? undefined,
    authorHandle,
    authorName,
    authorProfileImageUrl,
    author: extractAuthor(userResult),
    url: `https://x.com/${authorHandle ?? '_'}/status/${tweetId}`,
    text: tweet?.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? legacy.text ?? '',
    postedAt: legacy.created_at ?? null,
    syncedAt: now,
    conversationId: legacy.conversation_id_str,
    inReplyToStatusId: legacy.in_reply_to_status_id_str,
    inReplyToUserId: legacy.in_reply_to_user_id_str,
    quotedStatusId: legacy.quoted_status_id_str,
    quotedTweet: extractQuotedTweet(tweet?.quoted_status_result?.result),
    language: legacy.lang,
    sourceApp: legacy.source,
    possiblySensitive: legacy.possibly_sensitive,
    engagement: {
      likeCount: legacy.favorite_count,
      repostCount: legacy.retweet_count,
      replyCount: legacy.reply_count,
      quoteCount: legacy.quote_count,
      bookmarkCount: legacy.bookmark_count,
      viewCount: tweet?.views?.count ? Number(tweet.views.count) : undefined,
    },
    media,
    mediaObjects,
    links,
    tags: [],
    ingestedVia: 'graphql',
  };
}

export function parseAccountTimelineResponse(json: any, options: { now?: string; targetUserId: string; targetHandle?: string; targetName?: string } ): AccountTimelinePageResult {
  const now = options.now ?? new Date().toISOString();
  const instructions = json?.data?.user?.result?.timeline_v2?.timeline?.instructions ?? json?.data?.user?.result?.timeline?.timeline?.instructions;
  if (!Array.isArray(instructions)) {
    throw new Error('Account timeline response did not include timeline instructions.');
  }

  const entries: any[] = [];
  for (const instruction of instructions) {
    if (instruction?.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) entries.push(...instruction.entries);
    if (instruction?.type === 'TimelinePinEntry' && instruction.entry) entries.push(instruction.entry);
  }

  const records: AccountTimelineRecord[] = [];
  let skippedEntries = 0;
  let nextCursor: string | undefined;

  for (const entry of entries) {
    if (entry?.content?.cursorType === 'Bottom') {
      nextCursor = entry.content.value;
      continue;
    }
    if (typeof entry?.entryId === 'string' && entry.entryId.startsWith('promoted-')) {
      skippedEntries += 1;
      continue;
    }
    const itemType = entry?.content?.itemContent?.itemType;
    if (itemType !== 'TimelineTweet') {
      skippedEntries += 1;
      continue;
    }
    const record = convertAccountTimelineTweetToRecord(entry?.content?.itemContent?.tweet_results?.result, now, options);
    if (!record) {
      skippedEntries += 1;
      continue;
    }
    records.push(record);
  }

  return { records, nextCursor, skippedEntries };
}

export function mergeAccountTimelineRecords(existing: AccountTimelineRecord[], incoming: AccountTimelineRecord[]): { merged: AccountTimelineRecord[]; added: number } {
  const byId = new Map(existing.map((record) => [record.id, record]));
  let added = 0;
  for (const record of incoming) {
    const prev = byId.get(record.id);
    if (!prev) added += 1;
    byId.set(record.id, prev ? { ...prev, ...record } : record);
  }
  const merged = Array.from(byId.values()).sort(compareByChronologyDesc);
  return { merged, added };
}

function updateState(prev: AccountTimelineState, input: {
  targetUserId: string;
  targetHandle: string;
  added: number;
  pruned: number;
  totalFetched: number;
  totalStored: number;
  latestTweetId?: string;
  latestTweetPostedAt?: string | null;
  latestChanged: boolean;
  seenIds: string[];
  stopReason: string;
  lastCursor?: string;
  lastRunAt: string;
}): AccountTimelineState {
  return {
    provider: 'twitter',
    schemaVersion: 1,
    targetUserId: input.targetUserId,
    targetHandle: input.targetHandle,
    lastRunAt: input.lastRunAt,
    totalRuns: prev.totalRuns + 1,
    totalFetched: prev.totalFetched + input.totalFetched,
    totalStored: input.totalStored,
    totalAdded: prev.totalAdded + input.added,
    lastAdded: input.added,
    lastPruned: input.pruned,
    latestTweetId: input.latestTweetId,
    latestTweetPostedAt: input.latestTweetPostedAt,
    latestChanged: input.latestChanged,
    lastSeenIds: input.seenIds.slice(-20),
    stopReason: input.stopReason,
    lastCursor: input.lastCursor,
  };
}

async function fetchTimelinePage(sessionOptions: XSessionOptions, userId: string, count: number, cursor?: string): Promise<AccountTimelinePageResult> {
  const session = resolveXSessionAuth(sessionOptions);
  const response = await fetchXResource(buildTimelineUrl(userId, count, cursor), {
    headers: buildXGraphqlHeaders(session),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new XRequestError(
      response.status === 401 || response.status === 403
        ? `Account timeline unauthorized (${response.status}). Refresh your X session in the browser and retry.`
        : `Account timeline request failed (${response.status}). Response: ${text.slice(0, 300)}`,
      { kind: response.status === 401 || response.status === 403 ? 'auth' : 'upstream', status: response.status },
    );
  }
  return parseAccountTimelineResponse(await response.json(), { targetUserId: userId });
}

export async function syncAccountTimelineGraphQL(handle: string, options: AccountTimelineSyncOptions = {}): Promise<AccountTimelineSyncResult> {
  ensureDataDir();
  const limit = Math.max(1, Number(options.limit) || 50);
  const retain = String(options.retain ?? '90d');
  const retentionMs = parseRetentionMs(retain);

  const account = await resolveAccountByHandleGraphQL(handle, options);
  const cachePath = twitterAccountTimelineCachePath(account.userId);
  const metaPath = twitterAccountTimelineMetaPath(account.userId);
  const statePath = twitterAccountTimelineStatePath(account.userId);

  const existing = await readJsonLines<AccountTimelineRecord>(cachePath);
  const previousMeta = (await pathExists(metaPath)) ? await readJson<AccountTimelineCacheMeta>(metaPath) : undefined;
  const previousState = (await pathExists(statePath))
    ? await readJson<AccountTimelineState>(statePath)
    : {
        provider: 'twitter',
        schemaVersion: 1,
        targetUserId: account.userId,
        targetHandle: account.handle,
        totalRuns: 0,
        totalFetched: 0,
        totalStored: 0,
        totalAdded: 0,
        lastAdded: 0,
        lastPruned: 0,
        lastSeenIds: [],
      } satisfies AccountTimelineState;

  let merged = existing;
  let fetched = 0;
  let added = 0;
  let pruned = 0;
  let pages = 0;
  let stalePages = 0;
  let cursor: string | undefined;
  let stopReason = 'unknown';

  while (fetched < limit) {
    const count = Math.min(40, limit - fetched);
    const page = await fetchTimelinePage(options, account.userId, count, cursor);
    pages += 1;
    const now = new Date().toISOString();
    const records = page.records.map((record) => ({ ...record, syncedAt: now, targetHandle: account.handle, targetName: account.name }));
    fetched += records.length;
    const merge = mergeAccountTimelineRecords(merged, records);
    merged = merge.merged;
    added += merge.added;

    if (merge.added === 0) {
      stalePages += 1;
      if (stalePages >= STALE_PAGE_LIMIT) {
        stopReason = 'no new tweets (stale)';
        break;
      }
    } else {
      stalePages = 0;
    }
    if (!page.nextCursor) {
      stopReason = 'end of timeline';
      break;
    }
    cursor = page.nextCursor;
  }

  if (stopReason === 'unknown') stopReason = fetched >= limit ? 'limit reached' : 'unknown';

  const now = new Date().toISOString();
  const prunedResult = pruneByRetention(merged, retentionMs, now);
  merged = prunedResult.records;
  pruned = prunedResult.pruned;
  const latest = merged[0];
  const latestChanged = previousMeta?.latestTweetId ? previousMeta.latestTweetId !== latest?.tweetId : Boolean(latest);

  await ensureDir(path.dirname(cachePath));
  await writeJsonLines(cachePath, merged);
  await writeJson(metaPath, {
    provider: 'twitter',
    schemaVersion: 1,
    targetUserId: account.userId,
    targetHandle: account.handle,
    targetName: account.name,
    lastSyncAt: now,
    retention: retain,
    totalItems: merged.length,
    latestTweetId: latest?.tweetId,
    latestTweetPostedAt: latest?.postedAt ?? null,
    latestChanged,
  } satisfies AccountTimelineCacheMeta);
  await writeJson(statePath, updateState(previousState, {
    targetUserId: account.userId,
    targetHandle: account.handle,
    added,
    pruned,
    totalFetched: fetched,
    totalStored: merged.length,
    latestTweetId: latest?.tweetId,
    latestTweetPostedAt: latest?.postedAt ?? null,
    latestChanged,
    seenIds: merged.slice(0, 20).map((record) => record.tweetId),
    stopReason,
    lastCursor: cursor,
    lastRunAt: now,
  }));
  await rememberAccountHandle({
    userId: account.userId,
    handle: account.handle,
    name: account.name,
    lastSyncedAt: now,
  });
  const index = await buildAccountTimelineIndex(account.userId, { force: true });

  options.onProgress?.({ fetched, added, pruned, pages });

  return {
    userId: account.userId,
    targetHandle: account.handle,
    added,
    pruned,
    totalItems: merged.length,
    latestChanged,
    latestTweetId: latest?.tweetId,
    stopReason,
    cachePath,
    metaPath,
    statePath,
    dbPath: index.dbPath,
  };
}
