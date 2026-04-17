import { createHash } from 'node:crypto';
import { createEmbeddingProvider, loadEmbeddingProviderConfig, probeEmbeddingProvider } from './embeddings.js';
import { readJson, readJsonLines, pathExists, writeJson } from './fs.js';
import { loadFeedPreferences } from './feed-preferences.js';
import { rebuildArchiveStoreFromCaches } from './archive-store.js';
import {
  twitterArchiveCachePath,
  twitterFeedCachePath,
  twitterSemanticMetaPath,
} from './paths.js';
import { SemanticStore } from './semantic-store.js';
import type {
  ArchiveItem,
  BookmarkRecord,
  FeedPreferenceRule,
  FeedPreferences,
  FeedRecord,
  LikeRecord,
  SemanticDocumentRow,
  SemanticDocumentSource,
  SemanticMeta,
  SemanticPreferenceRow,
} from './types.js';

const SEMANTIC_SCHEMA_VERSION = 1;

interface BaseDocumentLike {
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  quotedTweet?: {
    text?: string;
  };
  links?: string[];
}

export interface SemanticStatusView {
  configured: boolean;
  storeReady: boolean;
  providerReady: boolean;
  provider?: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
  embeddingVersion?: string;
  lastUpdatedAt?: string;
  lastFullRebuildAt?: string;
  documents: Record<SemanticDocumentSource, number>;
  preferences: SemanticMeta['preferences'];
  error?: string;
}

function defaultPreferenceCounts(): SemanticMeta['preferences'] {
  return {
    likePrefer: 0,
    likeAvoid: 0,
    bookmarkPrefer: 0,
    bookmarkAvoid: 0,
  };
}

function defaultSemanticMeta(): SemanticMeta {
  return {
    schemaVersion: SEMANTIC_SCHEMA_VERSION,
    provider: 'aliyun-bailian',
    model: 'text-embedding-v4',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    dimensions: 0,
    embeddingVersion: 'aliyun-bailian:text-embedding-v4',
    updatedAt: new Date(0).toISOString(),
    documents: {
      feed: 0,
      likes: 0,
      bookmarks: 0,
    },
    preferences: defaultPreferenceCounts(),
  };
}

function normalizeDomains(links: string[] | undefined): string[] {
  const domains = new Set<string>();
  for (const link of links ?? []) {
    try {
      const url = new URL(link);
      domains.add(url.hostname.replace(/^www\./, '').toLowerCase());
    } catch {}
  }
  return Array.from(domains);
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function embeddingVersion(provider: string, model: string): string {
  return `${provider}:${model}`;
}

export function semanticDocumentId(source: SemanticDocumentSource, tweetId: string): string {
  return `${source}:${tweetId}`;
}

export function semanticPreferenceId(action: 'like' | 'bookmark', disposition: 'prefer' | 'avoid', normalizedText: string): string {
  return `${action}:${disposition}:topic:${normalizedText}`;
}

export function buildSemanticText(record: BaseDocumentLike): string {
  const parts = [
    record.authorName?.trim(),
    record.authorHandle ? `@${record.authorHandle.trim()}` : undefined,
    record.text?.trim(),
    record.quotedTweet?.text?.trim(),
    normalizeDomains(record.links).join(' '),
  ].filter((value): value is string => Boolean(value));
  return parts.join('\n');
}

function preferenceTopicRows(feedPreferences: FeedPreferences, version: string): Array<Omit<SemanticPreferenceRow, 'vector'>> {
  const rows: Array<Omit<SemanticPreferenceRow, 'vector'>> = [];
  const addRules = (action: 'like' | 'bookmark', disposition: 'prefer' | 'avoid', rules: FeedPreferenceRule[]) => {
    for (const rule of rules) {
      if (rule.kind !== 'topic') continue;
      rows.push({
        id: semanticPreferenceId(action, disposition, rule.value),
        action,
        disposition,
        rawText: rule.value,
        normalizedText: rule.value,
        textHash: hashText(rule.value),
        embeddingVersion: version,
      });
    }
  };

  addRules('like', 'prefer', feedPreferences.like.prefer);
  addRules('like', 'avoid', feedPreferences.like.avoid);
  addRules('bookmark', 'prefer', feedPreferences.bookmark.prefer);
  addRules('bookmark', 'avoid', feedPreferences.bookmark.avoid);
  return rows;
}

function dedupeRecords<T extends { tweetId: string }>(records: T[]): T[] {
  const byId = new Map<string, T>();
  for (const record of records) byId.set(record.tweetId, record);
  return Array.from(byId.values());
}

function canonicalDocumentRowsForSource(
  source: SemanticDocumentSource,
  items: ArchiveItem[],
  version: string,
): Array<Omit<SemanticDocumentRow, 'vector'>> {
  const itemsForSource = items.filter((item) => (
    source === 'bookmarks' ? Boolean(item.sourceAttachments.bookmark)
      : source === 'likes' ? Boolean(item.sourceAttachments.like)
        : Boolean(item.sourceAttachments.feed)
  ));

  return dedupeRecords(itemsForSource).map((item) => {
    const text = buildSemanticText(item);
    return {
      id: semanticDocumentId(source, item.tweetId),
      source,
      tweetId: item.tweetId,
      url: item.url,
      authorHandle: item.authorHandle,
      authorName: item.authorName,
      postedAt: item.postedAt ?? null,
      text,
      textHash: hashText(text),
      embeddingVersion: version,
    };
  });
}

function documentRowsForSource(
  source: SemanticDocumentSource,
  records: Array<BookmarkRecord | LikeRecord | FeedRecord>,
  version: string,
): Array<Omit<SemanticDocumentRow, 'vector'>> {
  return dedupeRecords(records).map((record) => {
    const text = buildSemanticText(record);
    return {
      id: semanticDocumentId(source, record.tweetId),
      source,
      tweetId: record.tweetId,
      url: record.url,
      authorHandle: record.authorHandle,
      authorName: record.authorName,
      postedAt: record.postedAt ?? null,
      text,
      textHash: hashText(text),
      embeddingVersion: version,
    };
  });
}

async function loadSemanticMeta(): Promise<SemanticMeta> {
  if (!(await pathExists(twitterSemanticMetaPath()))) return defaultSemanticMeta();
  return readJson<SemanticMeta>(twitterSemanticMetaPath());
}

async function writeSemanticMeta(meta: SemanticMeta): Promise<void> {
  await writeJson(twitterSemanticMetaPath(), meta);
}

async function syncDocumentSource(
  store: SemanticStore,
  provider: ReturnType<typeof createEmbeddingProvider>,
  source: SemanticDocumentSource,
  rows: Array<Omit<SemanticDocumentRow, 'vector'>>,
  fullReplace: boolean,
): Promise<number | undefined> {
  const existingMap = await store.getDocumentsByIds(rows.map((row) => row.id));
  const toEmbed = rows.filter((row) => {
    const existing = existingMap.get(row.id);
    return !existing || existing.textHash !== row.textHash || existing.embeddingVersion !== row.embeddingVersion;
  });

  let dimensions: number | undefined;
  if (toEmbed.length > 0) {
    const vectors = await provider.embed(toEmbed.map((row) => row.text));
    dimensions = vectors[0]?.length;
    await store.upsertDocuments(toEmbed.map((row, index) => ({
      ...row,
      vector: vectors[index],
    })));
  }

  if (fullReplace) {
    const existingRows = await store.listDocumentsBySource(source);
    const desiredIds = new Set(rows.map((row) => row.id));
    const staleIds = existingRows.filter((row) => !desiredIds.has(row.id)).map((row) => row.id);
    await store.deleteDocumentIds(staleIds);
  }

  return dimensions;
}

async function syncPreferenceTopics(
  store: SemanticStore,
  provider: ReturnType<typeof createEmbeddingProvider>,
  rows: Array<Omit<SemanticPreferenceRow, 'vector'>>,
): Promise<number | undefined> {
  const existingMap = await store.getPreferencesByIds(rows.map((row) => row.id));
  const toEmbed = rows.filter((row) => {
    const existing = existingMap.get(row.id);
    return !existing || existing.textHash !== row.textHash || existing.embeddingVersion !== row.embeddingVersion;
  });

  let dimensions: number | undefined;
  if (toEmbed.length > 0) {
    const vectors = await provider.embed(toEmbed.map((row) => row.rawText));
    dimensions = vectors[0]?.length;
    await store.upsertPreferences(toEmbed.map((row, index) => ({
      ...row,
      vector: vectors[index],
    })));
  }

  const existingRows = await store.listPreferences();
  const desiredIds = new Set(rows.map((row) => row.id));
  const staleIds = existingRows.filter((row) => !desiredIds.has(row.id)).map((row) => row.id);
  await store.deletePreferenceIds(staleIds);

  return dimensions;
}

async function buildSemanticMeta(
  dimensions: number,
  lastFullRebuildAt?: string,
): Promise<SemanticMeta> {
  const config = loadEmbeddingProviderConfig();
  const store = await SemanticStore.open();
  try {
    return {
      schemaVersion: SEMANTIC_SCHEMA_VERSION,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      dimensions,
      embeddingVersion: embeddingVersion(config.provider, config.model),
      updatedAt: new Date().toISOString(),
      lastFullRebuildAt,
      documents: {
        feed: await store.countDocumentsBySource('feed'),
        likes: await store.countDocumentsBySource('likes'),
        bookmarks: await store.countDocumentsBySource('bookmarks'),
      },
      preferences: {
        likePrefer: await store.countPreferences('like', 'prefer'),
        likeAvoid: await store.countPreferences('like', 'avoid'),
        bookmarkPrefer: await store.countPreferences('bookmark', 'prefer'),
        bookmarkAvoid: await store.countPreferences('bookmark', 'avoid'),
      },
    };
  } finally {
    await store.close();
  }
}

export async function syncSemanticIndexForRun(feedItems: FeedRecord[]): Promise<SemanticMeta> {
  const config = loadEmbeddingProviderConfig();
  const provider = createEmbeddingProvider(config);
  const version = embeddingVersion(config.provider, config.model);
  await rebuildArchiveStoreFromCaches();
  const archiveItems = await readJsonLines<ArchiveItem>(twitterArchiveCachePath());
  const feedPreferences = loadFeedPreferences();
  const store = await SemanticStore.open();

  let dimensions: number | undefined;
  try {
    dimensions = (await syncDocumentSource(store, provider, 'bookmarks', canonicalDocumentRowsForSource('bookmarks', archiveItems, version), true)) ?? dimensions;
    dimensions = (await syncDocumentSource(store, provider, 'likes', canonicalDocumentRowsForSource('likes', archiveItems, version), true)) ?? dimensions;
    dimensions = (await syncDocumentSource(store, provider, 'feed', canonicalDocumentRowsForSource('feed', archiveItems, version), true)) ?? dimensions;
    dimensions = (await syncDocumentSource(store, provider, 'feed', documentRowsForSource('feed', feedItems, version), false)) ?? dimensions;
    dimensions = (await syncPreferenceTopics(store, provider, preferenceTopicRows(feedPreferences, version))) ?? dimensions;
  } finally {
    await store.close();
  }

  if (!dimensions) {
    const currentMeta = await loadSemanticMeta();
    dimensions = currentMeta.dimensions || (await probeEmbeddingProvider(provider)).dimensions;
  }

  const meta = await buildSemanticMeta(dimensions);
  await writeSemanticMeta(meta);
  return meta;
}

export async function rebuildSemanticIndex(): Promise<SemanticMeta> {
  const config = loadEmbeddingProviderConfig();
  const provider = createEmbeddingProvider(config);
  const version = embeddingVersion(config.provider, config.model);
  await rebuildArchiveStoreFromCaches();
  const [archiveItems, feed] = await Promise.all([
    readJsonLines<ArchiveItem>(twitterArchiveCachePath()),
    readJsonLines<FeedRecord>(twitterFeedCachePath()),
  ]);
  const feedPreferences = loadFeedPreferences();
  const store = await SemanticStore.open();

  let dimensions: number | undefined;
  try {
    dimensions = (await syncDocumentSource(store, provider, 'bookmarks', canonicalDocumentRowsForSource('bookmarks', archiveItems, version), true)) ?? dimensions;
    dimensions = (await syncDocumentSource(store, provider, 'likes', canonicalDocumentRowsForSource('likes', archiveItems, version), true)) ?? dimensions;
    dimensions = (await syncDocumentSource(store, provider, 'feed', canonicalDocumentRowsForSource('feed', archiveItems, version), true)) ?? dimensions;
    dimensions = (await syncDocumentSource(store, provider, 'feed', documentRowsForSource('feed', feed, version), false)) ?? dimensions;
    dimensions = (await syncPreferenceTopics(store, provider, preferenceTopicRows(feedPreferences, version))) ?? dimensions;
  } finally {
    await store.close();
  }

  if (!dimensions) {
    const currentMeta = await loadSemanticMeta();
    dimensions = currentMeta.dimensions || (await probeEmbeddingProvider(provider)).dimensions;
  }

  const rebuiltAt = new Date().toISOString();
  const meta = await buildSemanticMeta(dimensions, rebuiltAt);
  await writeSemanticMeta(meta);
  return meta;
}

export async function getSemanticStatusView(): Promise<SemanticStatusView> {
  const meta = await loadSemanticMeta();
  let configured = false;
  let storeReady = false;
  let providerReady = false;
  let error: string | undefined;

  try {
    const config = loadEmbeddingProviderConfig();
    configured = true;
    const store = await SemanticStore.open();
    try {
      await store.tableNames();
      storeReady = true;
    } finally {
      await store.close();
    }
    await probeEmbeddingProvider(createEmbeddingProvider(config));
    providerReady = true;
    return {
      configured,
      storeReady,
      providerReady,
      provider: config.provider,
      model: config.model,
      baseUrl: config.baseUrl,
      dimensions: meta.dimensions || undefined,
      embeddingVersion: meta.embeddingVersion,
      lastUpdatedAt: meta.updatedAt,
      lastFullRebuildAt: meta.lastFullRebuildAt,
      documents: meta.documents,
      preferences: meta.preferences,
      error,
    };
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    try {
      const store = await SemanticStore.open();
      try {
        await store.tableNames();
        storeReady = true;
      } finally {
        await store.close();
      }
    } catch {}
    return {
      configured,
      storeReady,
      providerReady,
      provider: meta.provider,
      model: meta.model,
      baseUrl: meta.baseUrl,
      dimensions: meta.dimensions || undefined,
      embeddingVersion: meta.embeddingVersion,
      lastUpdatedAt: meta.updatedAt,
      lastFullRebuildAt: meta.lastFullRebuildAt,
      documents: meta.documents,
      preferences: meta.preferences,
      error,
    };
  }
}

export function formatSemanticStatus(view: SemanticStatusView): string {
  return [
    'Feed Semantic',
    `  configured: ${view.configured ? 'yes' : 'no'}`,
    `  store ready: ${view.storeReady ? 'yes' : 'no'}`,
    `  provider ready: ${view.providerReady ? 'yes' : 'no'}`,
    `  provider: ${view.provider ?? 'unknown'}`,
    `  model: ${view.model ?? 'unknown'}`,
    `  dimensions: ${view.dimensions ?? 'unknown'}`,
    `  embedding version: ${view.embeddingVersion ?? 'unknown'}`,
    `  last updated: ${view.lastUpdatedAt ?? 'never'}`,
    `  last full rebuild: ${view.lastFullRebuildAt ?? 'never'}`,
    `  documents: feed=${view.documents.feed} likes=${view.documents.likes} bookmarks=${view.documents.bookmarks}`,
    `  preference topics: like=${view.preferences.likePrefer}/${view.preferences.likeAvoid} bookmark=${view.preferences.bookmarkPrefer}/${view.preferences.bookmarkAvoid}`,
    `  meta: ${twitterSemanticMetaPath()}`,
    view.error ? `  error: ${view.error}` : undefined,
  ].filter((line): line is string => Boolean(line)).join('\n');
}
