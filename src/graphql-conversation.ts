import { buildGraphqlUrl, buildXGraphqlHeaders, fetchXResource, resolveXSessionAuth, XRequestError, xGraphqlOrigin, type XSessionOptions } from './x-graphql.js';
import type {
  BookmarkAuthorSnapshot,
  FeedConversationBundle,
  FeedConversationReply,
  FeedConversationTargetKind,
  FeedRecord,
} from './types.js';

export interface FeedConversationTarget {
  rootFeedTweetId: string;
  rootFeedItemId: string;
  conversationTweetId: string;
  conversationId: string;
  targetKind: FeedConversationTargetKind;
  targetUrl: string;
}

function extractAuthor(userResult: any, now: string): BookmarkAuthorSnapshot | undefined {
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

function extractQuotedTweet(quotedResult: any): FeedConversationReply['quotedTweet'] | undefined {
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

interface ConversationFetchOptions extends XSessionOptions {
  maxReplies?: number;
  maxPages?: number;
}

const TWEET_DETAIL_QUERY_ID = 'QrLp7AR-eMyamw8D1N9l6A';
const TWEET_DETAIL_OPERATION = 'TweetDetail';

const TWEET_DETAIL_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: false,
  rweb_tipjar_consumption_enabled: true,
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

const TWEET_DETAIL_FIELD_TOGGLES = {
  withPayments: false,
  withAuxiliaryUserLabels: true,
  withArticleRichContentState: true,
  withArticlePlainText: false,
  withArticleSummaryText: false,
  withArticleVoiceOver: false,
  withGrokAnalyze: false,
  withDisallowedReplyControls: false,
};

function buildConversationDetailUrl(tweetId: string, cursor?: string): string {
  const variables = {
    focalTweetId: tweetId,
    cursor,
    referrer: 'tweet',
    with_rux_injections: false,
    rankingMode: 'Relevance',
    includePromotedContent: true,
    withCommunity: true,
    withQuickPromoteEligibilityTweetFields: true,
    withBirdwatchNotes: true,
    withVoice: true,
    isReaderMode: false,
  };
  if (!cursor) delete (variables as { cursor?: string }).cursor;
  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: JSON.stringify(TWEET_DETAIL_FEATURES),
    fieldToggles: JSON.stringify(TWEET_DETAIL_FIELD_TOGGLES),
  });
  return `${buildGraphqlUrl(TWEET_DETAIL_QUERY_ID, TWEET_DETAIL_OPERATION)}?${params}`;
}

function buildStatusUrl(tweetId: string, handle?: string): string {
  return `${xGraphqlOrigin()}/${handle ?? 'i'}/status/${tweetId}`;
}

export function resolveConversationTarget(record: Pick<FeedRecord, 'id' | 'tweetId' | 'conversationId' | 'quotedStatusId' | 'quotedTweet' | 'authorHandle' | 'url'>): FeedConversationTarget | null {
  const rootFeedTweetId = String(record.tweetId || record.id);
  const rootFeedItemId = String(record.id || record.tweetId);
  if (record.quotedTweet?.id) {
    return {
      rootFeedTweetId,
      rootFeedItemId,
      conversationTweetId: String(record.quotedTweet.id),
      conversationId: String(record.quotedStatusId ?? record.quotedTweet.id),
      targetKind: 'quoted_tweet',
      targetUrl: record.quotedTweet.url,
    };
  }

  if (!record.tweetId && !record.id) return null;
  const conversationTweetId = String(record.conversationId ?? record.tweetId ?? record.id);
  return {
    rootFeedTweetId,
    rootFeedItemId,
    conversationTweetId,
    conversationId: conversationTweetId,
    targetKind: 'feed_tweet',
    targetUrl: record.url ?? buildStatusUrl(conversationTweetId, record.authorHandle),
  };
}

export function convertConversationTweetToReply(tweetResult: any, now: string): FeedConversationReply | null {
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
  const links = (legacy?.entities?.urls ?? [])
    .map((entry: any) => entry.expanded_url ?? entry.url)
    .filter((entry: string | undefined) => entry && !entry.includes('t.co'));

  return {
    id: String(tweetId),
    tweetId: String(tweetId),
    url: buildStatusUrl(String(tweetId), authorHandle),
    text: tweet?.note_tweet?.note_tweet_results?.result?.text ?? legacy.full_text ?? legacy.text ?? '',
    authorHandle,
    authorName,
    authorProfileImageUrl,
    author: extractAuthor(userResult, now),
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
    media: mediaEntities.map((m: any) => m.media_url_https ?? m.media_url).filter(Boolean),
    mediaObjects: mediaEntities.map((m: any) => ({
      type: m.type,
      url: m.media_url_https ?? m.media_url,
      expandedUrl: m.expanded_url,
      width: m.original_info?.width,
      height: m.original_info?.height,
      altText: m.ext_alt_text,
    })),
    links,
    tags: [],
    ingestedVia: 'graphql',
  };
}

function convertSearchConversationTweetToReply(
  tweet: any,
  authorById: Map<string, any>,
  mediaByKey: Map<string, any>,
  now: string,
): FeedConversationReply | null {
  const tweetId = tweet?.id;
  if (!tweetId) return null;
  const author = authorById.get(String(tweet.author_id));
  const mediaObjects = Array.isArray(tweet?.attachments?.media_keys)
    ? tweet.attachments.media_keys
        .map((key: string) => mediaByKey.get(String(key)))
        .filter(Boolean)
        .map((media: any) => ({
          type: media.type,
          url: media.url ?? media.preview_image_url,
          altText: media.alt_text,
          width: media.width,
          height: media.height,
        }))
    : [];
  const links = Array.isArray(tweet?.entities?.urls)
    ? tweet.entities.urls
        .map((entry: any) => entry.expanded_url ?? entry.url)
        .filter((entry: string | undefined) => entry && !entry.includes('t.co'))
    : [];
  const repliedTo = Array.isArray(tweet?.referenced_tweets)
    ? tweet.referenced_tweets.find((entry: any) => entry?.type === 'replied_to')
    : undefined;

  return {
    id: String(tweetId),
    tweetId: String(tweetId),
    url: buildStatusUrl(String(tweetId), author?.username),
    text: tweet?.note_tweet?.text ?? tweet?.text ?? '',
    authorHandle: author?.username,
    authorName: author?.name,
    authorProfileImageUrl: author?.profile_image_url,
    author: author ? {
      id: author.id ? String(author.id) : undefined,
      handle: author.username,
      name: author.name,
      profileImageUrl: author.profile_image_url,
      description: author.description,
      location: author.location,
      verified: Boolean(author.verified),
      followersCount: author.public_metrics?.followers_count,
      followingCount: author.public_metrics?.following_count,
      statusesCount: author.public_metrics?.tweet_count,
      snapshotAt: now,
    } : undefined,
    postedAt: tweet.created_at ?? null,
    syncedAt: now,
    conversationId: tweet.conversation_id,
    inReplyToStatusId: repliedTo?.id,
    inReplyToUserId: tweet.in_reply_to_user_id,
    language: tweet.lang,
    sourceApp: tweet.source,
    possiblySensitive: tweet.possibly_sensitive,
    engagement: tweet.public_metrics ? {
      likeCount: tweet.public_metrics.like_count,
      repostCount: tweet.public_metrics.retweet_count,
      replyCount: tweet.public_metrics.reply_count,
      quoteCount: tweet.public_metrics.quote_count,
      bookmarkCount: tweet.public_metrics.bookmark_count,
      viewCount: tweet.public_metrics.impression_count,
    } : undefined,
    media: mediaObjects.map((media: { url?: string }) => media.url).filter(Boolean),
    mediaObjects,
    links,
    tags: [],
    ingestedVia: 'graphql',
  };
}

function collectInstructionEntries(instructions: any[]): any[] {
  const entries: any[] = [];
  for (const instruction of instructions) {
    if (instruction?.type === 'TimelineAddEntries' && Array.isArray(instruction.entries)) {
      entries.push(...instruction.entries);
    }
    if (instruction?.type === 'TimelineReplaceEntry' && instruction.entry) {
      entries.push(instruction.entry);
    }
  }
  return entries;
}

function extractBottomCursor(entry: any): string | undefined {
  const content = entry?.content;
  const cursorType = content?.cursorType ?? content?.cursor_type;
  if (entry?.entryId?.includes('cursor-bottom') || cursorType === 'Bottom') {
    const value = content?.value;
    return typeof value === 'string' && value ? value : undefined;
  }
  return undefined;
}

function collectBottomCursor(instructions: any[]): string | undefined {
  for (const entry of collectInstructionEntries(instructions)) {
    const cursor = extractBottomCursor(entry);
    if (cursor) return cursor;
  }
  return undefined;
}

function collectTweetResults(entry: any): any[] {
  const direct = entry?.content?.itemContent?.tweet_results?.result;
  if (direct) return [direct];

  const moduleItems = entry?.content?.items;
  if (Array.isArray(moduleItems)) {
    return moduleItems
      .map((item) => item?.item?.itemContent?.tweet_results?.result)
      .filter(Boolean);
  }

  return [];
}

function unavailableBundle(target: FeedConversationTarget, now: string, reason: string, summary: string): FeedConversationBundle {
  return {
    schemaVersion: 1,
    rootFeedTweetId: target.rootFeedTweetId,
    rootFeedItemId: target.rootFeedItemId,
    conversationTweetId: target.conversationTweetId,
    conversationId: target.conversationId,
    targetKind: target.targetKind,
    targetUrl: target.targetUrl,
    fetchedAt: now,
    outcome: 'unavailable',
    unavailableReason: reason,
    summary,
    replies: [],
  };
}

export function parseConversationResponse(json: any, options: { now?: string; target: FeedConversationTarget }): FeedConversationBundle {
  const now = options.now ?? new Date().toISOString();
  const searchData = Array.isArray(json?.data) ? json.data : undefined;
  if (searchData) {
    const authorById = new Map<string, any>((json?.includes?.users ?? []).map((user: any) => [String(user.id), user]));
    const mediaByKey = new Map<string, any>((json?.includes?.media ?? []).map((media: any) => [String(media.media_key), media]));
    const replies = searchData
      .map((tweet: any) => convertSearchConversationTweetToReply(tweet, authorById, mediaByKey, now))
      .filter((reply: FeedConversationReply | null): reply is FeedConversationReply => Boolean(reply))
      .filter((reply: FeedConversationReply) => reply.tweetId !== options.target.conversationTweetId)
      .filter((reply: FeedConversationReply) => !reply.conversationId || reply.conversationId === options.target.conversationId);

    return {
      schemaVersion: 1,
      rootFeedTweetId: options.target.rootFeedTweetId,
      rootFeedItemId: options.target.rootFeedItemId,
      conversationTweetId: options.target.conversationTweetId,
      conversationId: options.target.conversationId,
      targetKind: options.target.targetKind,
      targetUrl: options.target.targetUrl,
      fetchedAt: now,
      outcome: 'success',
      summary: replies.length === 0
        ? 'Conversation fetched successfully with no replies returned.'
        : `Conversation fetched successfully with ${replies.length} repl${replies.length === 1 ? 'y' : 'ies'}.`,
      replies,
    };
  }

  const instructions =
    json?.data?.threaded_conversation_with_injections_v2?.instructions ??
    json?.data?.threaded_conversation_with_injections?.instructions;

  if (!Array.isArray(instructions)) {
    const message = String(json?.errors?.[0]?.message ?? '').toLowerCase();
    if (message.includes('not found') || message.includes('deleted')) {
      return unavailableBundle(options.target, now, 'deleted', 'Conversation target is unavailable or deleted.');
    }
    if (message.includes('protected') || message.includes('authorization')) {
      return unavailableBundle(options.target, now, 'protected', 'Conversation target is protected or unavailable to this session.');
    }
    throw new Error('Conversation response did not include threaded conversation instructions.');
  }

  const replies = new Map<string, FeedConversationReply>();
  for (const entry of collectInstructionEntries(instructions)) {
    for (const tweetResult of collectTweetResults(entry)) {
      const reply = convertConversationTweetToReply(tweetResult, now);
      if (!reply) continue;
      if (reply.tweetId === options.target.conversationTweetId) continue;
      if (reply.conversationId && reply.conversationId !== options.target.conversationId) continue;
      replies.set(reply.tweetId, reply);
    }
  }

  return {
    schemaVersion: 1,
    rootFeedTweetId: options.target.rootFeedTweetId,
    rootFeedItemId: options.target.rootFeedItemId,
    conversationTweetId: options.target.conversationTweetId,
    conversationId: options.target.conversationId,
    targetKind: options.target.targetKind,
    targetUrl: options.target.targetUrl,
    fetchedAt: now,
    outcome: 'success',
    summary: replies.size === 0
      ? 'Conversation fetched successfully with no replies returned.'
      : `Conversation fetched successfully with ${replies.size} repl${replies.size === 1 ? 'y' : 'ies'}.`,
    replies: Array.from(replies.values()),
  };
}

function parseConversationPage(json: any, options: { now: string; target: FeedConversationTarget }): { bundle: FeedConversationBundle; nextCursor?: string } {
  const bundle = parseConversationResponse(json, options);
  const instructions =
    json?.data?.threaded_conversation_with_injections_v2?.instructions ??
    json?.data?.threaded_conversation_with_injections?.instructions;
  return {
    bundle,
    nextCursor: Array.isArray(instructions) ? collectBottomCursor(instructions) : undefined,
  };
}

function emptyBundle(target: FeedConversationTarget, now: string): FeedConversationBundle {
  return {
    schemaVersion: 1,
    rootFeedTweetId: target.rootFeedTweetId,
    rootFeedItemId: target.rootFeedItemId,
    conversationTweetId: target.conversationTweetId,
    conversationId: target.conversationId,
    targetKind: target.targetKind,
    targetUrl: target.targetUrl,
    fetchedAt: now,
    outcome: 'success',
    summary: 'Conversation fetched successfully with no replies returned.',
    replies: [],
  };
}

function normalizePositiveInteger(value: unknown): number | undefined {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) return undefined;
  return Math.floor(numberValue);
}

export async function fetchConversationContext(record: FeedRecord, options: ConversationFetchOptions = {}): Promise<FeedConversationBundle> {
  const target = resolveConversationTarget(record);
  const now = new Date().toISOString();
  if (!target) {
    return {
      schemaVersion: 1,
      rootFeedTweetId: String(record.tweetId || record.id),
      rootFeedItemId: String(record.id || record.tweetId),
      conversationTweetId: String(record.tweetId || record.id),
      conversationId: String(record.conversationId ?? record.tweetId ?? record.id),
      targetKind: 'feed_tweet',
      targetUrl: record.url,
      fetchedAt: now,
      outcome: 'unsupported',
      summary: 'Feed item does not have a usable conversation target.',
      replies: [],
    };
  }

  const session = resolveXSessionAuth(options);
  const maxReplies = normalizePositiveInteger(options.maxReplies);
  const maxPages = normalizePositiveInteger(options.maxPages);
  const replies = new Map<string, FeedConversationReply>();
  let nextToken: string | undefined;
  let fetchedPages = 0;
  let stoppedByLimit = false;

  do {
    const response = await fetchXResource(buildConversationDetailUrl(target.conversationTweetId, nextToken), {
      headers: buildXGraphqlHeaders(session, { referer: target.targetUrl }),
    });

    if (!response.ok) {
      const text = await response.text();
      if (response.status === 401 || response.status === 403) {
        throw new XRequestError(
          `Conversation request unauthorized (${response.status}). Refresh your X session in the browser and retry.`,
          { kind: 'auth', status: response.status },
        );
      }
      if (response.status === 404) {
        return unavailableBundle(target, now, 'deleted', 'Conversation target is unavailable or deleted.');
      }
      throw new XRequestError(`Conversation request failed (${response.status}). Response: ${text.slice(0, 300)}`, {
        kind: response.status >= 500 ? 'upstream' : 'unknown',
        status: response.status,
      });
    }

    const json = await response.json();
    fetchedPages += 1;
    const { bundle: pageBundle, nextCursor } = parseConversationPage(json, { now, target });
    if (pageBundle.outcome === 'unavailable') return pageBundle;

    for (const [replyIndex, reply] of pageBundle.replies.entries()) {
      if (!replies.has(reply.tweetId)) replies.set(reply.tweetId, reply);
      if (maxReplies && replies.size >= maxReplies) {
        stoppedByLimit = Boolean(nextCursor) || replyIndex < pageBundle.replies.length - 1;
        break;
      }
    }

    nextToken = nextCursor;
    if (maxReplies && replies.size >= maxReplies) break;
    if (maxPages && fetchedPages >= maxPages && nextToken) {
      stoppedByLimit = true;
      break;
    }
  } while (nextToken);

  const replyList = Array.from(replies.values());
  return {
    schemaVersion: 1,
    rootFeedTweetId: target.rootFeedTweetId,
    rootFeedItemId: target.rootFeedItemId,
    conversationTweetId: target.conversationTweetId,
    conversationId: target.conversationId,
    targetKind: target.targetKind,
    targetUrl: target.targetUrl,
    fetchedAt: now,
    outcome: stoppedByLimit ? 'partial' : 'success',
    summary: replyList.length === 0
      ? 'Conversation fetched successfully with no replies returned.'
      : stoppedByLimit
        ? `Conversation fetched partially across ${fetchedPages} page${fetchedPages === 1 ? '' : 's'} with ${replyList.length} replies stored.`
        : `Conversation fetched successfully across ${fetchedPages} page${fetchedPages === 1 ? '' : 's'} with ${replyList.length} repl${replyList.length === 1 ? 'y' : 'ies'}.`,
    replies: replyList,
  };
}
