import { readJsonLines } from './fs.js';
import { twitterAccountTimelineCachePath } from './paths.js';
import { resolveTrackedAccountOrThrow } from './account-timeline.js';
import { normalizeDateInput, toIsoDate } from './date-utils.js';
import type { AccountTimelineRecord } from './types.js';

export interface AccountExportFilters {
  after?: string;
  before?: string;
}

export interface AccountExportItem {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  postedAt?: string | null;
  syncedAt: string;
  targetUserId: string;
  targetHandle: string;
  targetName?: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  quotedStatusId?: string;
  quotedTweet?: AccountTimelineRecord['quotedTweet'];
  language?: string;
  sourceApp?: string;
  possiblySensitive?: boolean;
  engagement?: AccountTimelineRecord['engagement'];
  media?: string[];
  mediaObjects?: AccountTimelineRecord['mediaObjects'];
  links: string[];
}

export interface AccountExportPayload {
  exportedAt: string;
  account: {
    userId: string;
    handle: string;
    name?: string;
  };
  filters: {
    after?: string;
    before?: string;
  };
  count: number;
  items: AccountExportItem[];
}

function effectiveDate(record: Pick<AccountTimelineRecord, 'postedAt' | 'syncedAt'>): string | null {
  return toIsoDate(record.postedAt) ?? toIsoDate(record.syncedAt);
}

function withinRange(record: AccountTimelineRecord, filters: { after?: string; before?: string }): boolean {
  const candidate = effectiveDate(record);
  if (!candidate) return true;
  if (filters.after && candidate < filters.after) return false;
  if (filters.before && candidate > filters.before) return false;
  return true;
}

function sortNewestFirst(left: AccountTimelineRecord, right: AccountTimelineRecord): number {
  const leftDate = Date.parse(left.postedAt ?? left.syncedAt);
  const rightDate = Date.parse(right.postedAt ?? right.syncedAt);
  if (Number.isFinite(leftDate) && Number.isFinite(rightDate) && rightDate !== leftDate) {
    return rightDate - leftDate;
  }
  if (/^\d+$/.test(left.tweetId) && /^\d+$/.test(right.tweetId)) {
    const leftId = BigInt(left.tweetId);
    const rightId = BigInt(right.tweetId);
    if (leftId === rightId) return 0;
    return rightId > leftId ? 1 : -1;
  }
  return right.tweetId.localeCompare(left.tweetId);
}

function toExportItem(record: AccountTimelineRecord): AccountExportItem {
  return {
    id: record.id,
    tweetId: record.tweetId,
    url: record.url,
    text: record.text,
    postedAt: record.postedAt ?? null,
    syncedAt: record.syncedAt,
    targetUserId: record.targetUserId,
    targetHandle: record.targetHandle,
    targetName: record.targetName,
    authorHandle: record.authorHandle,
    authorName: record.authorName,
    authorProfileImageUrl: record.authorProfileImageUrl,
    conversationId: record.conversationId,
    inReplyToStatusId: record.inReplyToStatusId,
    inReplyToUserId: record.inReplyToUserId,
    quotedStatusId: record.quotedStatusId,
    quotedTweet: record.quotedTweet,
    language: record.language,
    sourceApp: record.sourceApp,
    possiblySensitive: record.possiblySensitive,
    engagement: record.engagement,
    media: record.media ?? [],
    mediaObjects: record.mediaObjects ?? [],
    links: record.links ?? [],
  };
}

export async function exportAccountTimeline(
  handle: string,
  filters: AccountExportFilters = {},
): Promise<AccountExportPayload> {
  const account = await resolveTrackedAccountOrThrow(handle);
  const after = filters.after ? normalizeDateInput(filters.after, 'after') : undefined;
  const before = filters.before ? normalizeDateInput(filters.before, 'before') : undefined;
  if (after && before && after > before) {
    throw new Error(`Invalid date range: after (${after}) must be on or before before (${before}).`);
  }

  const records = await readJsonLines<AccountTimelineRecord>(twitterAccountTimelineCachePath(account.userId));
  const items = records
    .filter((record) => withinRange(record, { after, before }))
    .sort(sortNewestFirst)
    .map((record) => toExportItem(record));

  return {
    exportedAt: new Date().toISOString(),
    account: {
      userId: account.userId,
      handle: account.currentHandle,
      name: account.name,
    },
    filters: {
      after,
      before,
    },
    count: items.length,
    items,
  };
}
