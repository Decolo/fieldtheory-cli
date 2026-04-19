import { parseAccountTimelineResponse, resolveAccountByHandleGraphQL } from './graphql-account-timeline.js';
import {
  readFollowingAccountCache,
  readFollowingLabels,
  readFollowingSnapshot,
  writeFollowingAccountCache,
  writeFollowingReviewResults,
} from './following-review-state.js';
import { buildGraphqlUrl, buildXGraphqlHeaders, fetchXResource, resolveXSessionAuth, type XSessionOptions, XRequestError } from './x-graphql.js';
import type {
  AccountRelevanceLabel,
  AccountReviewResult,
  FollowedAccountSnapshot,
  FollowingAccountEvidenceCache,
} from './types.js';

const USER_TWEETS_AND_REPLIES_QUERY_ID = '6fWQaBPK51aGyC_VC7t9GQ';
const USER_TWEETS_AND_REPLIES_OPERATION = 'UserTweets';
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

export interface AccountReviewRunOptions extends XSessionOptions {
  now?: string;
  inactivityThresholdDays?: number;
  maxStage2Accounts?: number;
  timelinePageSize?: number;
  fetchEvidence?: (account: FollowedAccountSnapshot, options: AccountReviewRunOptions) => Promise<FollowingAccountEvidenceCache | null>;
}

export interface AccountReviewRunResult {
  reviewedAt: string;
  totalAccounts: number;
  stage2Count: number;
  candidateCount: number;
  results: AccountReviewResult[];
}

function buildTimelineUrl(userId: string, count: number): string {
  const params = new URLSearchParams({
    variables: JSON.stringify({
      userId,
      count,
      includePromotedContent: true,
      withCommunity: true,
      withVoice: true,
      withV2Timeline: true,
    }),
    features: JSON.stringify(ACCOUNT_TIMELINE_FEATURES),
  });
  return `${buildGraphqlUrl(USER_TWEETS_AND_REPLIES_QUERY_ID, USER_TWEETS_AND_REPLIES_OPERATION)}?${params}`;
}

function round(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return Math.round(value * 100) / 100;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function daysBetween(older: string | null | undefined, newer: string): number | undefined {
  if (!older) return undefined;
  const olderTs = Date.parse(older);
  const newerTs = Date.parse(newer);
  if (!Number.isFinite(olderTs) || !Number.isFinite(newerTs)) return undefined;
  return Math.max(0, Math.floor((newerTs - olderTs) / (24 * 60 * 60 * 1000)));
}

function buildEvidenceCache(
  account: FollowedAccountSnapshot,
  now: string,
  records: Array<{ postedAt?: string | null; engagement?: { likeCount?: number; replyCount?: number; viewCount?: number } }>,
): FollowingAccountEvidenceCache {
  return {
    targetUserId: account.userId,
    handle: account.handle,
    fetchedAt: now,
    recordCount: records.length,
    lastPostedAt: records[0]?.postedAt ?? null,
    avgLikeCount: round(average(records.map((record) => Number(record.engagement?.likeCount ?? 0)))),
    avgReplyCount: round(average(records.map((record) => Number(record.engagement?.replyCount ?? 0)))),
    avgViewCount: round(average(records.map((record) => Number(record.engagement?.viewCount ?? 0)))),
  };
}

function stage1NeedsDeepScan(account: FollowedAccountSnapshot, label?: AccountRelevanceLabel, cache?: FollowingAccountEvidenceCache | null): boolean {
  if (cache?.lastPostedAt) return false;
  if (label?.value === 'not-valuable') return true;
  if (account.state !== 'active') return false;
  if (account.verified) return false;
  const followers = Number(account.followersCount ?? 0);
  const statuses = Number(account.statusesCount ?? 0);
  return followers <= 250 || statuses <= 200;
}

function scoreAccount(input: {
  account: FollowedAccountSnapshot;
  label?: AccountRelevanceLabel;
  cache?: FollowingAccountEvidenceCache | null;
  now: string;
  inactivityThresholdDays: number;
}): AccountReviewResult {
  const { account, label, cache, now, inactivityThresholdDays } = input;
  const inactivityDays = daysBetween(cache?.lastPostedAt ?? account.lastPostedAt, now);
  const followerCount = account.followersCount;
  const avgLikeCount = cache?.avgLikeCount;
  const avgReplyCount = cache?.avgReplyCount;
  const avgViewCount = cache?.avgViewCount;

  let score = 0;
  let primaryReason: AccountReviewResult['primaryReason'] = 'uncertain';
  let disposition: AccountReviewResult['disposition'] = 'deferred';
  let fetchStatus: NonNullable<AccountReviewResult['evidence']['fetchStatus']> = cache ? 'cached' : 'unavailable';

  if (typeof inactivityDays === 'number' && inactivityDays >= inactivityThresholdDays) {
    score += 0.7 + Math.min(0.2, (inactivityDays - inactivityThresholdDays) / 365);
    primaryReason = 'inactive';
  }
  if ((followerCount ?? Infinity) < 250) score += 0.08;
  if ((avgLikeCount ?? Infinity) < 5) score += 0.06;
  if ((avgReplyCount ?? Infinity) < 1) score += 0.04;
  if ((avgViewCount ?? Infinity) < 100) score += 0.04;
  if (label?.value === 'not-valuable') {
    score += 0.15;
    if (primaryReason === 'uncertain') primaryReason = 'low_relevance';
  }
  if (label?.value === 'valuable') score -= 0.35;

  if (cache?.recordCount === 0) {
    disposition = 'deferred';
    primaryReason = 'uncertain';
  } else if (primaryReason === 'inactive' && score >= 0.8) disposition = 'candidate';
  else if (label?.value === 'valuable') disposition = 'healthy';
  else if (cache) disposition = score >= 0.55 ? 'candidate' : 'healthy';

  if (cache?.recordCount === 0) fetchStatus = 'failed';

  return {
    targetUserId: account.userId,
    handle: account.handle,
    name: account.name,
    stage: cache ? 'stage2' : 'stage1',
    disposition,
    primaryReason,
    score: round(score) ?? 0,
    evidence: {
      inactivityDays,
      inactivityThresholdDays,
      followerCount,
      avgLikeCount,
      avgReplyCount,
      avgViewCount,
      label: label?.value,
      fetchStatus,
      note: !cache ? 'insufficient recent timeline evidence' : undefined,
    },
    lastPostedAt: cache?.lastPostedAt ?? account.lastPostedAt,
    lastEvaluatedAt: now,
  };
}

export async function fetchFollowingAccountEvidence(
  account: FollowedAccountSnapshot,
  options: AccountReviewRunOptions = {},
): Promise<FollowingAccountEvidenceCache | null> {
  const session = resolveXSessionAuth(options);
  const resolved = await resolveAccountByHandleGraphQL(account.handle, options);
  const response = await fetchXResource(buildTimelineUrl(resolved.userId, Math.max(5, Math.min(40, Number(options.timelinePageSize) || 20))), {
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
  const page = parseAccountTimelineResponse(await response.json(), {
    targetUserId: resolved.userId,
    targetHandle: resolved.handle,
    targetName: resolved.name,
  });
  if (page.records.length === 0) return null;
  return buildEvidenceCache(account, options.now ?? new Date().toISOString(), page.records);
}

export async function runAccountReview(options: AccountReviewRunOptions = {}): Promise<AccountReviewRunResult> {
  const now = options.now ?? new Date().toISOString();
  const inactivityThresholdDays = Math.max(14, Number(options.inactivityThresholdDays) || 45);
  const maxStage2Accounts = Math.max(1, Number(options.maxStage2Accounts) || 25);
  const fetchEvidence = options.fetchEvidence ?? fetchFollowingAccountEvidence;

  const [snapshot, labels] = await Promise.all([
    readFollowingSnapshot(),
    readFollowingLabels(),
  ]);
  const cachedEvidenceEntries = await Promise.all(snapshot.map(async (account) => [account.userId, await readFollowingAccountCache(account.userId)] as const));
  const cachedEvidence = new Map(cachedEvidenceEntries);
  const stage2Targets = snapshot
    .filter((account) => stage1NeedsDeepScan(account, labels[account.userId], cachedEvidence.get(account.userId) ?? null))
    .slice(0, maxStage2Accounts);

  for (const account of stage2Targets) {
    try {
      const evidence = await fetchEvidence(account, { ...options, now, inactivityThresholdDays });
      if (evidence) {
        await writeFollowingAccountCache(evidence);
        cachedEvidence.set(account.userId, evidence);
      } else {
        cachedEvidence.set(account.userId, {
          targetUserId: account.userId,
          handle: account.handle,
          fetchedAt: now,
          recordCount: 0,
        });
      }
    } catch {
      cachedEvidence.set(account.userId, {
        targetUserId: account.userId,
        handle: account.handle,
        fetchedAt: now,
        recordCount: 0,
      });
    }
  }

  const results = snapshot
    .map((account) => scoreAccount({
      account,
      label: labels[account.userId],
      cache: cachedEvidence.get(account.userId) ?? null,
      now,
      inactivityThresholdDays,
    }))
    .sort((left, right) => right.score - left.score || left.handle.localeCompare(right.handle));

  await writeFollowingReviewResults(results, {
    reviewedAt: now,
    deepScannedUserIds: stage2Targets.map((account) => account.userId),
  });

  return {
    reviewedAt: now,
    totalAccounts: snapshot.length,
    stage2Count: stage2Targets.length,
    candidateCount: results.filter((result) => result.disposition === 'candidate').length,
    results,
  };
}
