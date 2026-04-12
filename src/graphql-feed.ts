import { pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from './fs.js';
import { ensureDataDir, twitterFeedCachePath, twitterFeedIndexPath, twitterFeedMetaPath, twitterFeedStatePath } from './paths.js';
import { resolveXSessionAuth, buildGraphqlUrl, buildXGraphqlHeaders, fetchXResource, type XSessionOptions } from './x-graphql.js';
import type { FeedBackfillState, FeedCacheMeta, FeedRecord } from './types.js';
import { buildFeedIndex } from './feed-db.js';

const HOME_TIMELINE_QUERY_ID = 'Fb7fyZ9MMCzvf_bNtwNdXA';
const HOME_TIMELINE_OPERATION = 'HomeTimeline';

const HOME_TIMELINE_FEATURES = {
  rweb_video_screen_enabled: false,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: true,
  responsive_web_jetfuel_frame: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_grok_annotations_enabled: true,
  articles_preview_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  content_disclosure_indicator_enabled: true,
  content_disclosure_ai_generated_indicator_enabled: true,
  responsive_web_grok_show_grok_translated_post: true,
  responsive_web_grok_analysis_button_from_backend: true,
  post_ctas_fetch_enabled: true,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

interface FeedPageResult {
  records: FeedRecord[];
  nextCursor?: string;
  skippedEntries: number;
  seenTweetIds: string[];
}

export interface FeedSyncOptions extends XSessionOptions {
  maxPages?: number;
  delayMs?: number;
  maxMinutes?: number;
  pageSize?: number;
  onProgress?: (status: FeedSyncProgress) => void;
}

export interface FeedSyncProgress {
  page: number;
  totalFetched: number;
  newAdded: number;
  skippedEntries: number;
  running: boolean;
  done: boolean;
  stopReason?: string;
}

export interface FeedSyncResult {
  added: number;
  totalItems: number;
  skippedEntries: number;
  pages: number;
  stopReason: string;
  cachePath: string;
  statePath: string;
  dbPath: string;
}

function buildFirstPageUrl(count = 20): string {
  const variables = {
    count,
    includePromotedContent: true,
    requestContext: 'launch',
    withCommunity: true,
  };
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(HOME_TIMELINE_FEATURES),
  });
  return `${buildGraphqlUrl(HOME_TIMELINE_QUERY_ID, HOME_TIMELINE_OPERATION)}?${params}`;
}

function buildPageBody(cursor: string, count = 20, seenTweetIds: string[] = []): string {
  return JSON.stringify({
    variables: {
      count,
      cursor,
      includePromotedContent: true,
      withCommunity: true,
      seenTweetIds,
    },
    features: HOME_TIMELINE_FEATURES,
    queryId: HOME_TIMELINE_QUERY_ID,
  });
}

function parseSnowflake(value?: string | null): bigint | null {
  if (!value || !/^\d+$/.test(value)) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function scoreRecord(record: FeedRecord): number {
  let score = 0;
  if (record.postedAt) score += 2;
  if (record.authorProfileImageUrl) score += 2;
  if (record.author) score += 3;
  if (record.engagement) score += 3;
  if ((record.mediaObjects?.length ?? 0) > 0) score += 3;
  if ((record.links?.length ?? 0) > 0) score += 2;
  return score;
}

export function mergeFeedRecord(existing: FeedRecord | undefined, incoming: FeedRecord): FeedRecord {
  if (!existing) return incoming;
  const richer = scoreRecord(incoming) >= scoreRecord(existing)
    ? { ...existing, ...incoming }
    : { ...incoming, ...existing };
  return {
    ...richer,
    syncedAt: incoming.syncedAt,
    sortIndex: incoming.sortIndex ?? richer.sortIndex ?? null,
    fetchPage: incoming.fetchPage ?? richer.fetchPage ?? null,
    fetchPosition: incoming.fetchPosition ?? richer.fetchPosition ?? null,
  };
}

function compareFeedOrderDesc(a: FeedRecord, b: FeedRecord): number {
  const syncA = Date.parse(a.syncedAt);
  const syncB = Date.parse(b.syncedAt);
  if (Number.isFinite(syncA) && Number.isFinite(syncB) && syncA !== syncB) return syncB - syncA;

  const sortA = parseSnowflake(a.sortIndex);
  const sortB = parseSnowflake(b.sortIndex);
  if (sortA != null && sortB != null && sortA !== sortB) return sortA > sortB ? -1 : 1;

  const pageA = a.fetchPage ?? Number.MAX_SAFE_INTEGER;
  const pageB = b.fetchPage ?? Number.MAX_SAFE_INTEGER;
  if (pageA !== pageB) return pageA - pageB;

  const posA = a.fetchPosition ?? Number.MAX_SAFE_INTEGER;
  const posB = b.fetchPosition ?? Number.MAX_SAFE_INTEGER;
  if (posA !== posB) return posA - posB;

  const idA = parseSnowflake(a.tweetId ?? a.id);
  const idB = parseSnowflake(b.tweetId ?? b.id);
  if (idA != null && idB != null && idA !== idB) return idA > idB ? -1 : 1;

  return String(a.id).localeCompare(String(b.id));
}

export function mergeFeedRecords(existing: FeedRecord[], incoming: FeedRecord[]): { merged: FeedRecord[]; added: number } {
  const byId = new Map(existing.map((r) => [r.id, r]));
  let added = 0;
  for (const record of incoming) {
    const prev = byId.get(record.id);
    if (!prev) added += 1;
    byId.set(record.id, mergeFeedRecord(prev, record));
  }
  const merged = Array.from(byId.values());
  merged.sort(compareFeedOrderDesc);
  return { merged, added };
}

function extractAuthor(userResult: any, now: string) {
  if (!userResult) return undefined;
  const authorHandle = userResult?.core?.screen_name ?? userResult?.legacy?.screen_name;
  const authorName = userResult?.core?.name ?? userResult?.legacy?.name;
  const authorProfileImageUrl =
    userResult?.avatar?.image_url ??
    userResult?.legacy?.profile_image_url_https ??
    userResult?.legacy?.profile_image_url;

  return {
    id: userResult.rest_id,
    handle: authorHandle,
    name: authorName,
    profileImageUrl: authorProfileImageUrl,
    bio: userResult?.legacy?.description,
    followerCount: userResult?.legacy?.followers_count,
    followingCount: userResult?.legacy?.friends_count,
    isVerified: Boolean(userResult?.is_blue_verified ?? userResult?.legacy?.verified),
    location:
      typeof userResult?.location === 'object'
        ? userResult.location.location
        : userResult?.legacy?.location,
    snapshotAt: now,
  };
}

function extractQuotedTweet(quotedResult: any): FeedRecord['quotedTweet'] | undefined {
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

export function convertHomeTimelineTweetToRecord(tweetResult: any, now: string, ordering: { sortIndex?: string | null; fetchPage: number; fetchPosition: number }): FeedRecord | null {
  const tweet = tweetResult?.tweet ?? tweetResult;
  const legacy = tweet?.legacy;
  if (!legacy) return null;

  const tweetId = legacy.id_str ?? tweet?.rest_id;
  if (!tweetId) return null;

  const userResult = tweet?.core?.user_results?.result;
  const authorHandle = userResult?.core?.screen_name ?? userResult?.legacy?.screen_name;
  const authorName = userResult?.core?.name ?? userResult?.legacy?.name;
  const authorProfileImageUrl =
    userResult?.avatar?.image_url ??
    userResult?.legacy?.profile_image_url_https ??
    userResult?.legacy?.profile_image_url;

  const mediaEntities = legacy?.extended_entities?.media ?? legacy?.entities?.media ?? [];
  const media: string[] = mediaEntities
    .map((m: any) => m.media_url_https ?? m.media_url)
    .filter(Boolean);
  const mediaObjects = mediaEntities.map((m: any) => ({
    type: m.type,
    url: m.media_url_https ?? m.media_url,
    expandedUrl: m.expanded_url,
    width: m.original_info?.width,
    height: m.original_info?.height,
    altText: m.ext_alt_text,
    videoVariants: Array.isArray(m.video_info?.variants)
      ? m.video_info.variants
          .filter((v: any) => v.content_type === 'video/mp4')
          .map((v: any) => ({
            url: v.url,
            contentType: v.content_type,
            bitrate: v.bitrate,
          }))
      : undefined,
  }));
  const links: string[] = (legacy?.entities?.urls ?? [])
    .map((u: any) => u.expanded_url ?? u.url)
    .filter((u: string | undefined) => u && !u.includes('t.co'));
  const quotedTweet = extractQuotedTweet(tweet?.quoted_status_result?.result);

  return {
    id: tweetId,
    tweetId,
    url: `https://x.com/${authorHandle ?? '_'}/status/${tweetId}`,
    text: tweet?.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? legacy.text ?? '',
    authorHandle,
    authorName,
    authorProfileImageUrl,
    author: extractAuthor(userResult, now),
    postedAt: legacy.created_at ?? null,
    syncedAt: now,
    sortIndex: ordering.sortIndex ?? null,
    fetchPage: ordering.fetchPage,
    fetchPosition: ordering.fetchPosition,
    conversationId: legacy.conversation_id_str,
    inReplyToStatusId: legacy.in_reply_to_status_id_str,
    inReplyToUserId: legacy.in_reply_to_user_id_str,
    quotedStatusId: legacy.quoted_status_id_str,
    quotedTweet,
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

export function parseHomeTimelineResponse(json: any, options: { now?: string; fetchPage?: number } = {}): FeedPageResult {
  const ts = options.now ?? new Date().toISOString();
  const fetchPage = options.fetchPage ?? 1;
  const instructions = json?.data?.home?.home_timeline_urt?.instructions;
  if (!Array.isArray(instructions)) {
    throw new Error('Home timeline response did not include data.home.home_timeline_urt.instructions.');
  }

  const entries: any[] = [];
  for (const instruction of instructions) {
    if (instruction?.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
      entries.push(...instruction.entries);
    }
  }

  const records: FeedRecord[] = [];
  const seenTweetIds: string[] = [];
  let skippedEntries = 0;
  let nextCursor: string | undefined;

  for (const [index, entry] of entries.entries()) {
    if (entry?.content?.cursorType === 'Bottom') {
      nextCursor = entry.content.value;
      continue;
    }

    const itemType = entry?.content?.itemContent?.itemType;
    if (itemType !== 'TimelineTweet') {
      skippedEntries += 1;
      continue;
    }

    if (typeof entry?.entryId === 'string' && entry.entryId.startsWith('promoted-')) {
      skippedEntries += 1;
      continue;
    }

    const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
    const record = convertHomeTimelineTweetToRecord(tweetResult, ts, {
      sortIndex: typeof entry?.sortIndex === 'string' ? entry.sortIndex : null,
      fetchPage,
      fetchPosition: index,
    });
    if (!record) {
      skippedEntries += 1;
      continue;
    }
    records.push(record);
    seenTweetIds.push(record.tweetId);
  }

  return { records, nextCursor, skippedEntries, seenTweetIds };
}

async function fetchPageWithRetry(
  headers: Record<string, string>,
  cursor?: string,
  pageSize = 20,
  seenTweetIds: string[] = [],
): Promise<FeedPageResult> {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < 4; attempt++) {
    const response = cursor
      ? await fetchXResource(buildGraphqlUrl(HOME_TIMELINE_QUERY_ID, HOME_TIMELINE_OPERATION), {
          method: 'POST',
          headers,
          body: buildPageBody(cursor, pageSize, seenTweetIds),
        })
      : await fetchXResource(buildFirstPageUrl(pageSize), { headers });

    if (response.status === 429) {
      const waitSec = Math.min(15 * Math.pow(2, attempt), 120);
      lastError = new Error(`Rate limited (429) on attempt ${attempt + 1}`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      continue;
    }

    if (response.status >= 500) {
      lastError = new Error(`Server error (${response.status}) on attempt ${attempt + 1}`);
      await new Promise((r) => setTimeout(r, 5000 * (attempt + 1)));
      continue;
    }

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Home timeline API returned ${response.status}.\n` +
        `Response: ${text.slice(0, 300)}\n\n` +
        (response.status === 401 || response.status === 403
          ? 'Fix: Your X session may have expired. Open your browser, go to https://x.com, and make sure you are logged in. Then retry.'
          : 'This may be a temporary issue. Try again in a few minutes.')
      );
    }

    const json = await response.json();
    return parseHomeTimelineResponse(json);
  }

  throw lastError ?? new Error('Home timeline API: all retry attempts failed. Try again later.');
}

function updateState(
  prev: FeedBackfillState,
  input: { fetched: number; stored: number; skippedEntries: number; seenIds: string[]; stopReason: string; lastCursor?: string; lastRunAt?: string },
): FeedBackfillState {
  return {
    provider: 'twitter',
    lastRunAt: input.lastRunAt ?? new Date().toISOString(),
    totalRuns: prev.totalRuns + 1,
    totalFetched: prev.totalFetched + input.fetched,
    totalStored: input.stored,
    totalSkippedEntries: input.skippedEntries,
    lastSeenIds: input.seenIds.slice(-20),
    stopReason: input.stopReason,
    lastCursor: input.lastCursor,
  };
}

export async function syncFeedGraphQL(options: FeedSyncOptions = {}): Promise<FeedSyncResult> {
  const maxPages = options.maxPages ?? 5;
  const delayMs = options.delayMs ?? 600;
  const maxMinutes = options.maxMinutes ?? 5;
  const pageSize = options.pageSize ?? 20;

  const session = resolveXSessionAuth(options);
  const headers = buildXGraphqlHeaders(session);
  ensureDataDir();

  const cachePath = twitterFeedCachePath();
  const metaPath = twitterFeedMetaPath();
  const statePath = twitterFeedStatePath();
  const existing = await readJsonLines<FeedRecord>(cachePath);
  const previousMeta = (await pathExists(metaPath))
    ? await readJson<FeedCacheMeta>(metaPath)
    : undefined;
  const prevState: FeedBackfillState = (await pathExists(statePath))
    ? await readJson<FeedBackfillState>(statePath)
    : { provider: 'twitter', totalRuns: 0, totalFetched: 0, totalStored: 0, totalSkippedEntries: 0, lastSeenIds: [] };

  const started = Date.now();
  let page = 0;
  let totalAdded = 0;
  let totalFetched = 0;
  let totalSkipped = 0;
  let cursor: string | undefined;
  let merged = existing;
  let stopReason = 'unknown';
  let seenTweetIds: string[] = prevState.lastSeenIds.slice(-5);

  while (page < maxPages) {
    if (Date.now() - started > maxMinutes * 60_000) {
      stopReason = 'max runtime reached';
      break;
    }

    const result = await fetchPageWithRetry(headers, cursor, pageSize, seenTweetIds);
    page += 1;

    const pageNow = new Date().toISOString();
    const recordsWithPage = result.records.map((record) => ({ ...record, syncedAt: pageNow, fetchPage: page }));
    const mergeResult = mergeFeedRecords(merged, recordsWithPage);
    merged = mergeResult.merged;
    totalAdded += mergeResult.added;
    totalFetched += recordsWithPage.length;
    totalSkipped += result.skippedEntries;
    seenTweetIds = result.seenTweetIds.slice(-5);

    options.onProgress?.({
      page,
      totalFetched,
      newAdded: totalAdded,
      skippedEntries: totalSkipped,
      running: true,
      done: false,
    });

    if (!result.nextCursor) {
      stopReason = recordsWithPage.length === 0 ? 'no tweet entries found' : 'end of feed';
      break;
    }

    cursor = result.nextCursor;
    if (page < maxPages) await new Promise((r) => setTimeout(r, delayMs));
  }

  if (stopReason === 'unknown') stopReason = page >= maxPages ? 'max pages reached' : 'unknown';

  const syncedAt = new Date().toISOString();
  await writeJsonLines(cachePath, merged);
  await writeJson(metaPath, {
    provider: 'twitter',
    schemaVersion: 1,
    lastSyncAt: syncedAt,
    totalItems: merged.length,
    totalSkippedEntries: totalSkipped,
  } satisfies FeedCacheMeta);
  await writeJson(statePath, updateState(prevState, {
    fetched: totalFetched,
    stored: merged.length,
    skippedEntries: totalSkipped,
    seenIds: seenTweetIds,
    stopReason,
    lastCursor: cursor,
    lastRunAt: syncedAt,
  }));
  const indexResult = await buildFeedIndex({ force: true });

  options.onProgress?.({
    page,
    totalFetched,
    newAdded: totalAdded,
    skippedEntries: totalSkipped,
    running: false,
    done: true,
    stopReason,
  });

  return {
    added: totalAdded,
    totalItems: merged.length,
    skippedEntries: totalSkipped,
    pages: page,
    stopReason,
    cachePath,
    statePath,
    dbPath: indexResult.dbPath ?? twitterFeedIndexPath(),
  };
}
