import type {
  BookmarkAuthorSnapshot,
  BookmarkEngagementSnapshot,
  BookmarkMediaObject,
  BookmarkRecord,
  FeedRecord,
  LikeRecord,
  QuotedTweetSnapshot,
} from './types.js';

export type ArchiveSourceKind = 'bookmark' | 'like' | 'feed';
export type ArchiveIngestMode = 'api' | 'browser' | 'graphql';
export type ArchiveAttachmentMetadataValue = string | number | boolean | null;

export interface ArchiveSourceAttachment {
  source: ArchiveSourceKind;
  sourceTimestamp?: string | null;
  orderingKey?: string | null;
  fetchPage?: number | null;
  fetchPosition?: number | null;
  ingestedVia?: ArchiveIngestMode;
  syncedAt: string;
  metadata?: Record<string, ArchiveAttachmentMetadataValue>;
}

export type ArchiveSourceAttachments = Partial<Record<ArchiveSourceKind, ArchiveSourceAttachment>>;

export interface ArchiveRecordBase {
  id: string;
  tweetId: string;
  authorHandle?: string;
  authorName?: string;
  authorProfileImageUrl?: string;
  author?: BookmarkAuthorSnapshot;
  url: string;
  text: string;
  normalizedText?: string;
  postedAt?: string | null;
  syncedAt: string;
  conversationId?: string;
  inReplyToStatusId?: string;
  inReplyToUserId?: string;
  quotedStatusId?: string;
  quotedTweet?: QuotedTweetSnapshot;
  language?: string;
  sourceApp?: string;
  possiblySensitive?: boolean;
  engagement?: BookmarkEngagementSnapshot;
  media?: string[];
  mediaObjects?: BookmarkMediaObject[];
  links?: string[];
  tags?: string[];
  ingestedVia?: ArchiveIngestMode;
}

export interface ArchiveItem extends ArchiveRecordBase {
  sourceAttachments: ArchiveSourceAttachments;
}

export function normalizeArchiveText(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function omitUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function metadataRecord(value: Record<string, ArchiveAttachmentMetadataValue | undefined>): Record<string, ArchiveAttachmentMetadataValue> {
  return omitUndefined(value) as Record<string, ArchiveAttachmentMetadataValue>;
}

function baseArchiveItem(record: ArchiveRecordBase): Omit<ArchiveItem, 'sourceAttachments'> {
  return {
    ...record,
    normalizedText: record.normalizedText ?? normalizeArchiveText(record.text),
  };
}

export function upsertArchiveSourceAttachment(
  item: ArchiveItem,
  attachment: ArchiveSourceAttachment,
): ArchiveItem {
  return {
    ...item,
    sourceAttachments: {
      ...item.sourceAttachments,
      [attachment.source]: attachment,
    },
  };
}

export function getArchiveSourceAttachment(
  item: ArchiveItem,
  source: ArchiveSourceKind,
): ArchiveSourceAttachment | undefined {
  return item.sourceAttachments[source];
}

export function archiveItemFromBookmarkRecord(record: BookmarkRecord): ArchiveItem {
  return {
    ...baseArchiveItem(record),
    sourceAttachments: {
      bookmark: {
        source: 'bookmark',
        sourceTimestamp: record.bookmarkedAt,
        orderingKey: record.sortIndex,
        ingestedVia: record.ingestedVia,
        syncedAt: record.syncedAt,
        metadata: metadataRecord({
          bookmarkedAt: record.bookmarkedAt,
          sortIndex: record.sortIndex,
        }),
      },
    },
  };
}

export function archiveItemFromLikeRecord(record: LikeRecord): ArchiveItem {
  return {
    ...baseArchiveItem(record),
    sourceAttachments: {
      like: {
        source: 'like',
        sourceTimestamp: record.likedAt,
        ingestedVia: record.ingestedVia,
        syncedAt: record.syncedAt,
        metadata: metadataRecord({
          likedAt: record.likedAt,
        }),
      },
    },
  };
}

export function archiveItemFromFeedRecord(record: FeedRecord): ArchiveItem {
  return {
    ...baseArchiveItem(record),
    sourceAttachments: {
      feed: {
        source: 'feed',
        orderingKey: record.sortIndex,
        fetchPage: record.fetchPage,
        fetchPosition: record.fetchPosition,
        ingestedVia: record.ingestedVia,
        syncedAt: record.syncedAt,
        metadata: metadataRecord({
          sortIndex: record.sortIndex,
          fetchPage: record.fetchPage,
          fetchPosition: record.fetchPosition,
        }),
      },
    },
  };
}

function requireAttachment(item: ArchiveItem, source: ArchiveSourceKind): ArchiveSourceAttachment {
  const attachment = item.sourceAttachments[source];
  if (!attachment) {
    throw new Error(`Archive item ${item.id} is missing the ${source} attachment`);
  }
  return attachment;
}

function baseCompatibilityRecord(item: ArchiveItem): ArchiveRecordBase {
  return {
    id: item.id,
    tweetId: item.tweetId,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    authorProfileImageUrl: item.authorProfileImageUrl,
    author: item.author,
    url: item.url,
    text: item.text,
    normalizedText: item.normalizedText,
    postedAt: item.postedAt,
    syncedAt: item.syncedAt,
    conversationId: item.conversationId,
    inReplyToStatusId: item.inReplyToStatusId,
    inReplyToUserId: item.inReplyToUserId,
    quotedStatusId: item.quotedStatusId,
    quotedTweet: item.quotedTweet,
    language: item.language,
    sourceApp: item.sourceApp,
    possiblySensitive: item.possiblySensitive,
    engagement: item.engagement,
    media: item.media,
    mediaObjects: item.mediaObjects,
    links: item.links,
    tags: item.tags,
  };
}

export function projectBookmarkRecord(item: ArchiveItem): BookmarkRecord {
  const attachment = requireAttachment(item, 'bookmark');
  return omitUndefined({
    ...baseCompatibilityRecord(item),
    syncedAt: attachment.syncedAt,
    bookmarkedAt: attachment.sourceTimestamp,
    sortIndex: attachment.orderingKey,
    ingestedVia: attachment.ingestedVia,
  }) as BookmarkRecord;
}

export function projectLikeRecord(item: ArchiveItem): LikeRecord {
  const attachment = requireAttachment(item, 'like');
  return omitUndefined({
    ...baseCompatibilityRecord(item),
    syncedAt: attachment.syncedAt,
    likedAt: attachment.sourceTimestamp,
    ingestedVia: attachment.ingestedVia,
  }) as LikeRecord;
}

export function projectFeedRecord(item: ArchiveItem): FeedRecord {
  const attachment = requireAttachment(item, 'feed');
  return omitUndefined({
    ...baseCompatibilityRecord(item),
    syncedAt: attachment.syncedAt,
    sortIndex: attachment.orderingKey,
    fetchPage: attachment.fetchPage,
    fetchPosition: attachment.fetchPosition,
    ingestedVia: attachment.ingestedVia,
  }) as FeedRecord;
}
