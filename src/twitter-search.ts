import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { convertTweetToRecord, fetchTweetViaSyndication } from './graphql-bookmarks.js';
import {
  CHROME_UA,
  XRequestError,
  buildGraphqlUrl,
  buildXGraphqlHeaders,
  fetchXResource,
  resolveXSessionAuth,
  sanitizeSensitiveText,
  type XSessionOptions,
} from './x-graphql.js';

export interface RemoteTweetSearchResultItem {
  tweetId: string;
  url: string;
  text?: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  status: 'ok' | 'unavailable';
}

export interface RemoteTweetSearchOptions extends XSessionOptions {
  query: string;
  limit?: number;
  filter?: 'top' | 'live';
}

interface SearchTimelinePage {
  tweets: RemoteTweetSearchResultItem[];
  nextCursor: string | null;
}

interface SearchTimelineDeps {
  resolveAuth: typeof resolveXSessionAuth;
  fetchResource: typeof fetchXResource;
  now: () => string;
}

interface SearchRemoteTweetsDeps {
  fetchRss: (query: string) => Promise<string>;
  fetchTweet: typeof fetchTweetViaSyndication;
  resolveAuth: typeof resolveXSessionAuth;
  searchGraphql: (options: RemoteTweetSearchOptions) => Promise<RemoteTweetSearchResultItem[]>;
  writeWarning: (message: string) => void;
}

const DEFAULT_BING_RSS_BASE = 'https://www.bing.com/search?format=rss&q=';
const SEARCH_TIMELINE_QUERY_ID = 'U3QTLwGF8sZCHDuWIMSAmg';
const SEARCH_TIMELINE_OPERATION = 'SearchTimeline';
const SEARCH_TIMELINE_FIELD_TOGGLES = {
  withArticleRichContentState: true,
  withArticlePlainText: true,
  withArticleSummaryText: true,
  withArticleVoiceOver: false,
  withAuxiliaryUserLabels: false,
  withDisallowedReplyControls: false,
  withGrokAnalyze: false,
  withPayments: false,
};
const DEFAULT_SEARCH_TIMELINE_FEATURES = {
  rweb_video_screen_enabled: false,
  rweb_cashtags_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
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
  tweet_awards_web_tipping_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: false,
  responsive_web_enhance_cards_enabled: false,
};
const execFileAsync = promisify(execFile);

const DEFAULT_GRAPHQL_DEPS: SearchTimelineDeps = {
  resolveAuth: resolveXSessionAuth,
  fetchResource: fetchXResource,
  now: () => new Date().toISOString(),
};

const DEFAULT_DEPS: SearchRemoteTweetsDeps = {
  fetchRss: fetchBingRss,
  fetchTweet: fetchTweetViaSyndication,
  resolveAuth: resolveXSessionAuth,
  searchGraphql: searchTweetsGraphQL,
  writeWarning: (message: string) => process.stderr.write(`${message}\n`),
};

function tweetSearchRssBase(): string {
  return (process.env.FT_TWEET_SEARCH_RSS_BASE ?? DEFAULT_BING_RSS_BASE).trim();
}

function searchTimelineQueryId(): string {
  return (process.env.FT_X_SEARCH_TIMELINE_QUERY_ID ?? SEARCH_TIMELINE_QUERY_ID).trim();
}

function searchTimelineFeatures(): string {
  return (process.env.FT_X_SEARCH_TIMELINE_FEATURES ?? JSON.stringify(DEFAULT_SEARCH_TIMELINE_FEATURES)).trim();
}

function normalizeFilter(filter: RemoteTweetSearchOptions['filter']): 'Top' | 'Latest' {
  return filter === 'live' ? 'Latest' : 'Top';
}

function buildBingQueries(query: string): string[] {
  return [
    `site:x.com/status ${query}`,
    `site:x.com "${query}"`,
    `${query} site:x.com/status`,
    `${query} site:x.com`,
  ];
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractTweetUrlsFromRss(xml: string): string[] {
  const links = Array.from(xml.matchAll(/<link>(https:\/\/x\.com\/[^<\s]+\/status\/\d+)<\/link>/g))
    .map((match) => decodeXmlEntities(match[1] ?? ''))
    .filter(Boolean);
  return Array.from(new Set(links));
}

export function extractTweetIdFromUrl(url: string): string | null {
  const match = url.match(/status\/(\d+)/);
  return match?.[1] ?? null;
}

function buildSearchTimelineUrl(options: RemoteTweetSearchOptions, count: number, cursor?: string): string {
  const variables: Record<string, unknown> = {
    rawQuery: options.query,
    count,
    querySource: 'typed_query',
    product: normalizeFilter(options.filter),
  };
  if (cursor) variables.cursor = cursor;

  const params = new URLSearchParams({
    variables: JSON.stringify(variables),
    features: searchTimelineFeatures(),
    fieldToggles: JSON.stringify(SEARCH_TIMELINE_FIELD_TOGGLES),
  });
  return `${buildGraphqlUrl(searchTimelineQueryId(), SEARCH_TIMELINE_OPERATION)}?${params}`;
}

function cursorFromContent(content: any): { type?: string; value?: string } | null {
  if (!content || typeof content !== 'object') return null;

  const directType = typeof content.cursorType === 'string' ? content.cursorType : undefined;
  const directValue = typeof content.value === 'string' ? content.value : undefined;
  if (directType || directValue) return { type: directType, value: directValue };

  const operationCursor = content.operation?.cursor;
  if (operationCursor && typeof operationCursor === 'object') {
    return {
      type: typeof operationCursor.cursorType === 'string' ? operationCursor.cursorType : undefined,
      value: typeof operationCursor.value === 'string' ? operationCursor.value : undefined,
    };
  }

  return null;
}

function flattenTimelineEntries(entries: any[]): any[] {
  const flattened: any[] = [];

  for (const entry of entries) {
    flattened.push(entry);
    const items = entry?.content?.items;
    if (Array.isArray(items)) {
      for (const item of items) {
        flattened.push({
          ...item,
          content: item?.item?.itemContent
            ? { itemContent: item.item.itemContent }
            : item?.itemContent
              ? { itemContent: item.itemContent }
              : item?.content,
        });
      }
    }
  }

  return flattened;
}

function collectInstructionEntries(instructions: any[]): any[] {
  const entries: any[] = [];
  for (const instruction of instructions) {
    if (Array.isArray(instruction?.entries)) {
      entries.push(...flattenTimelineEntries(instruction.entries));
    }
    if (instruction?.type === 'TimelineReplaceEntry' && instruction.entry) {
      entries.push(instruction.entry);
    }
  }
  return entries;
}

function mapTweetResultToRemoteItem(tweetResult: any, now: string): RemoteTweetSearchResultItem | null {
  const record = convertTweetToRecord(tweetResult, now);
  if (!record) return null;

  return {
    tweetId: record.tweetId,
    url: record.url,
    text: record.text,
    authorHandle: record.authorHandle,
    authorName: record.authorName,
    postedAt: record.postedAt ?? null,
    status: 'ok',
  };
}

function parseSearchTimelineResponse(json: any, now: string): SearchTimelinePage {
  const timeline = json?.data?.search_by_raw_query?.search_timeline?.timeline;
  if (!timeline) {
    throw new Error('SearchTimeline response missing data.search_by_raw_query.search_timeline.timeline.');
  }

  const instructions = Array.isArray(timeline.instructions) ? timeline.instructions : [];
  const tweets: RemoteTweetSearchResultItem[] = [];
  let nextCursor: string | null = null;

  for (const entry of collectInstructionEntries(instructions)) {
      const tweetResult = entry?.content?.itemContent?.tweet_results?.result;
      if (tweetResult) {
        const item = mapTweetResultToRemoteItem(tweetResult, now);
        if (item) tweets.push(item);
      }

      const cursor = cursorFromContent(entry?.content);
      const cursorType = cursor?.type?.toLowerCase();
      if (cursor?.value && (!cursorType || cursorType === 'bottom')) {
        nextCursor = cursor.value;
      } else if (
        typeof entry?.entryId === 'string' &&
        /cursor-bottom/i.test(entry.entryId) &&
        cursor?.value
      ) {
        nextCursor = cursor.value;
      }
  }

  return { tweets, nextCursor };
}

async function fetchBingRss(query: string): Promise<string> {
  const url = `${tweetSearchRssBase()}${encodeURIComponent(query)}`;
  try {
    const { stdout } = await execFileAsync(
      'curl',
      [
        '-L',
        '--connect-timeout',
        '10',
        '--max-time',
        '30',
        '-A',
        CHROME_UA,
        '-H',
        'accept: application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
        url,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    );
    return stdout;
  } catch (error) {
    const detail = [
      error instanceof Error ? error.message : String(error),
      typeof (error as any)?.stderr === 'string' ? (error as any).stderr : '',
      typeof (error as any)?.stdout === 'string' ? (error as any).stdout : '',
    ].filter(Boolean).join('\n');
    throw new Error(`Remote tweet search failed. ${sanitizeSensitiveText(detail).slice(0, 500)}`);
  }
}

async function fetchSearchTimelinePage(
  options: RemoteTweetSearchOptions,
  count: number,
  cursor: string | undefined,
  deps: SearchTimelineDeps,
): Promise<SearchTimelinePage> {
  const session = deps.resolveAuth(options);
  const response = await deps.fetchResource(buildSearchTimelineUrl(options, count, cursor), {
    headers: buildXGraphqlHeaders(session),
  });

  if (!response.ok) {
    const text = await response.text();
    const isAuthFailure = response.status === 401 || response.status === 403;
    const isRateLimited = response.status === 429;
    throw new XRequestError(
      isAuthFailure
        ? `SearchTimeline unauthorized (${response.status}). Refresh your X session in the browser and retry.`
        : isRateLimited
          ? `SearchTimeline rate limited (${response.status}). Retry later or fall back to Bing RSS.`
          : `SearchTimeline request failed (${response.status}). Response: ${text.slice(0, 300)}`,
      { kind: isAuthFailure ? 'auth' : isRateLimited ? 'rate_limit' : 'upstream', status: response.status },
    );
  }

  return parseSearchTimelineResponse(await response.json(), deps.now());
}

export async function searchTweetsGraphQL(
  options: RemoteTweetSearchOptions,
  deps: SearchTimelineDeps = DEFAULT_GRAPHQL_DEPS,
): Promise<RemoteTweetSearchResultItem[]> {
  const limit = Math.max(1, Number(options.limit) || 15);
  const seenIds = new Set<string>();
  const tweets: RemoteTweetSearchResultItem[] = [];
  let cursor: string | undefined;

  while (tweets.length < limit) {
    const remaining = limit - tweets.length;
    const page = await fetchSearchTimelinePage(options, Math.min(20, remaining), cursor, deps);

    for (const item of page.tweets) {
      if (seenIds.has(item.tweetId)) continue;
      seenIds.add(item.tweetId);
      tweets.push(item);
      if (tweets.length >= limit) break;
    }

    if (!page.nextCursor || page.nextCursor === cursor) break;
    cursor = page.nextCursor;
  }

  return tweets;
}

async function searchRemoteTweetsViaBing(
  options: RemoteTweetSearchOptions,
  deps: Pick<SearchRemoteTweetsDeps, 'fetchRss' | 'fetchTweet'>,
): Promise<RemoteTweetSearchResultItem[]> {
  const limit = Math.max(1, Number(options.limit) || 15);
  const urls: string[] = [];

  for (const candidateQuery of buildBingQueries(options.query)) {
    const xml = await deps.fetchRss(candidateQuery);
    for (const url of extractTweetUrlsFromRss(xml)) {
      if (!urls.includes(url)) urls.push(url);
      if (urls.length >= limit) break;
    }
    if (urls.length >= limit) break;
  }

  const results: RemoteTweetSearchResultItem[] = [];

  for (const url of urls) {
    const tweetId = extractTweetIdFromUrl(url);
    if (!tweetId) continue;

    const result = await deps.fetchTweet(tweetId);
    if (!result.snapshot) {
      results.push({
        tweetId,
        url,
        status: 'unavailable',
      });
      continue;
    }

    results.push({
      tweetId,
      url,
      text: result.snapshot.text,
      authorHandle: result.snapshot.authorHandle,
      authorName: result.snapshot.authorName,
      postedAt: result.snapshot.postedAt ?? null,
      status: 'ok',
    });
  }

  return results;
}

function shouldWarnAboutGraphqlFallback(error: unknown): boolean {
  return error instanceof XRequestError && (error.kind === 'rate_limit' || error.status === 429);
}

function shouldFallbackToBing(error: unknown): boolean {
  if (!(error instanceof XRequestError)) return true;
  return error.kind !== 'auth';
}

export async function searchRemoteTweets(
  options: RemoteTweetSearchOptions,
  deps: SearchRemoteTweetsDeps = DEFAULT_DEPS,
): Promise<RemoteTweetSearchResultItem[]> {
  let authAvailable = false;
  try {
    deps.resolveAuth(options);
    authAvailable = true;
  } catch {
    authAvailable = false;
  }

  if (authAvailable) {
    try {
      return await deps.searchGraphql(options);
    } catch (error) {
      if (shouldWarnAboutGraphqlFallback(error)) {
        deps.writeWarning('GraphQL search rate-limited, falling back to Bing RSS; retry later');
      }
      if (!shouldFallbackToBing(error)) throw error;
    }
  }

  return searchRemoteTweetsViaBing(options, deps);
}
