import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { countArchiveItems, listArchiveSources } from './archive-index.js';
import { countBookmarks, getBookmarkById, listBookmarks, type BookmarkTimelineFilters } from './bookmarks-db.js';
import { countLikes, getLikeById, listLikes, type LikeTimelineFilters } from './likes-db.js';
import { countFeed } from './feed-db.js';
import { getFeedMetricsSnapshot } from './feed-metrics.js';
import { runHybridSearch } from './hybrid-search.js';
import {
  dataDir,
  twitterArchiveCachePath,
  twitterArchiveIndexPath,
  twitterBookmarksCachePath,
  twitterBookmarksIndexPath,
  twitterFeedCachePath,
  twitterFeedIndexPath,
  twitterLikesCachePath,
  twitterLikesIndexPath,
} from './paths.js';
import type {
  ApiArchiveItem,
  ApiArchiveListResponse,
  ApiArchiveSourceAttachment,
  ArchiveFilter,
  ApiHybridSearchResponse,
  ApiHybridSummaryResponse,
  ApiListResponse,
  ApiFeedMetricsResponse,
  ApiStatusResponse,
  HybridSearchMode,
  HybridSearchScope,
  HybridSearchSource,
} from './web-types.js';

export interface WebServerOptions {
  host?: string;
  port?: number;
  staticDir?: string;
}

export interface RunningWebServer {
  host: string;
  port: number;
  url: string;
  close: () => Promise<void>;
}

function parseInteger(value: string | undefined, fallback: number, min = 0): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < min) return fallback;
  return parsed;
}

function isMissingTableError(error: unknown): boolean {
  return error instanceof Error && /no such table/i.test(error.message);
}

function parseHybridMode(value: string | undefined): HybridSearchMode {
  if (value == null || value === 'topic') return 'topic';
  if (value === 'action') return 'action';
  throw new Error(`Invalid search mode: "${value}". Use "topic" or "action".`);
}

function parseHybridScope(value: string | undefined): HybridSearchScope {
  if (value == null || value === 'all') return 'all';
  if (value === 'bookmarks' || value === 'likes' || value === 'feed') return value;
  throw new Error(`Invalid search scope: "${value}". Use "all", "bookmarks", "likes", or "feed".`);
}

function parseArchiveFilter(value: string | undefined): ArchiveFilter {
  if (value == null || value === 'all') return 'all';
  if (value === 'bookmarks' || value === 'likes' || value === 'feed') return value;
  throw new Error(`Invalid archive source: "${value}". Use "all", "bookmarks", "likes", or "feed".`);
}

function singularArchiveSource(source: Exclude<ArchiveFilter, 'all'>): 'bookmark' | 'like' | 'feed' {
  if (source === 'bookmarks') return 'bookmark';
  if (source === 'likes') return 'like';
  return 'feed';
}

function pluralizeArchiveSource(source: 'bookmark' | 'like' | 'feed'): HybridSearchSource {
  if (source === 'bookmark') return 'bookmarks';
  if (source === 'like') return 'likes';
  return 'feed';
}

function parseSources(value: unknown): HybridSearchSource[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry): HybridSearchSource[] => {
      if (entry === 'bookmark') return ['bookmarks'];
      if (entry === 'like') return ['likes'];
      if (entry === 'feed') return ['feed'];
      if (entry === 'bookmarks' || entry === 'likes') return [entry];
      return [];
    });
  } catch {
    return [];
  }
}

function choosePrimaryArchiveSource(
  sources: HybridSearchSource[],
  preferred?: ArchiveFilter,
): HybridSearchSource {
  if (preferred && preferred !== 'all' && sources.includes(preferred)) return preferred;
  if (sources.includes('bookmarks')) return 'bookmarks';
  if (sources.includes('likes')) return 'likes';
  return 'feed';
}

async function listArchiveItems(options: {
  source: ArchiveFilter;
  query?: string;
  limit: number;
  offset: number;
}): Promise<{ total: number; items: ApiArchiveItem[] }> {
  const db = await openDb(twitterArchiveIndexPath());
  const conditions: string[] = [];
  const countParams: Array<string | number> = [];
  const listParams: Array<string | number> = [];
  const sourceFilter = options.source === 'all' ? undefined : singularArchiveSource(options.source);

  if (options.query) {
    conditions.push('ai.rowid IN (SELECT rowid FROM archive_items_fts WHERE archive_items_fts MATCH ?)');
    countParams.push(options.query);
    listParams.push(options.query);
  }
  if (sourceFilter) {
    conditions.push(`EXISTS (
      SELECT 1
      FROM archive_sources src_filter
      WHERE src_filter.tweet_id = ai.tweet_id
        AND src_filter.source = ?
    )`);
    countParams.push(sourceFilter);
    listParams.push(sourceFilter);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  try {
    let totalRows;
    let itemRows;
    try {
      totalRows = db.exec(`SELECT COUNT(*) FROM archive_items ai ${where}`, countParams);
      itemRows = db.exec(
        `
          SELECT
            ai.id,
            ai.tweet_id,
            ai.url,
            ai.text,
            ai.author_handle,
            ai.author_name,
            ai.author_profile_image_url,
            ai.posted_at,
            ai.synced_at,
            ai.source_count,
            ai.sources_json,
            MAX(CASE WHEN src.source = 'bookmark' THEN src.source_timestamp END) AS bookmark_timestamp,
            MAX(CASE WHEN src.source = 'like' THEN src.source_timestamp END) AS like_timestamp,
            MAX(CASE WHEN src.source = 'feed' THEN COALESCE(src.source_timestamp, src.synced_at) END) AS feed_timestamp
          FROM archive_items ai
          LEFT JOIN archive_sources src ON src.tweet_id = ai.tweet_id
          ${where}
          GROUP BY ai.rowid
          ORDER BY COALESCE(ai.posted_at, ai.synced_at) DESC, ai.tweet_id DESC
          LIMIT ?
          OFFSET ?
        `,
        [...listParams, options.limit, options.offset],
      );
    } catch (error) {
      const message = (error as Error).message ?? '';
      if (message.includes('fts5') || message.includes('MATCH') || message.includes('syntax')) {
        throw new Error(`Invalid search query: "${options.query}". Try simpler terms or wrap phrases in double quotes.`);
      }
      throw error;
    }

    const baseItems = (itemRows[0]?.values ?? []).map((row) => ({
      id: String(row[0]),
      tweetId: String(row[1]),
      url: String(row[2]),
      text: String(row[3] ?? ''),
      authorHandle: (row[4] as string) ?? undefined,
      authorName: (row[5] as string) ?? undefined,
      authorProfileImageUrl: (row[6] as string) ?? undefined,
      postedAt: (row[7] as string) ?? null,
      syncedAt: String(row[8]),
      sourceCount: Number(row[9] ?? 0),
      sources: parseSources(row[10]),
      sourceDates: {
        bookmarks: (row[11] as string) ?? null,
        likes: (row[12] as string) ?? null,
        feed: (row[13] as string) ?? null,
      } satisfies Partial<Record<HybridSearchSource, string | null>>,
    }));

    const items = await Promise.all(baseItems.map(async (item) => {
      const attachments = await listArchiveSources(item.tweetId);
      const mappedAttachments = Object.fromEntries(attachments.map((attachment) => {
        const source = pluralizeArchiveSource(attachment.source);
        return [source, {
          source,
          sourceTimestamp: attachment.sourceTimestamp ?? null,
          orderingKey: attachment.orderingKey ?? null,
          fetchPage: attachment.fetchPage ?? null,
          fetchPosition: attachment.fetchPosition ?? null,
          syncedAt: attachment.syncedAt,
          ingestedVia: attachment.ingestedVia ?? null,
          sourceRecordId: attachment.metadata && typeof attachment.metadata.sourceRecordId === 'string'
            ? attachment.metadata.sourceRecordId
            : undefined,
        } satisfies ApiArchiveSourceAttachment];
      })) as Partial<Record<HybridSearchSource, ApiArchiveSourceAttachment>>;

      return {
        ...item,
        source: choosePrimaryArchiveSource(item.sources, options.source),
        attachments: mappedAttachments,
        isBookmarked: item.sources.includes('bookmarks'),
        isLiked: item.sources.includes('likes'),
        isInFeed: item.sources.includes('feed'),
      } satisfies ApiArchiveItem;
    }));

    return {
      total: Number(totalRows[0]?.values?.[0]?.[0] ?? 0),
      items,
    };
  } finally {
    db.close();
  }
}

async function getArchiveItem(id: string): Promise<ApiArchiveItem | null> {
  const db = await openDb(twitterArchiveIndexPath());
  try {
    const rows = db.exec(
      `
        SELECT
          ai.id,
          ai.tweet_id,
          ai.url,
          ai.text,
          ai.author_handle,
          ai.author_name,
          ai.author_profile_image_url,
          ai.posted_at,
          ai.synced_at,
          ai.source_count,
          ai.sources_json,
          MAX(CASE WHEN src.source = 'bookmark' THEN src.source_timestamp END) AS bookmark_timestamp,
          MAX(CASE WHEN src.source = 'like' THEN src.source_timestamp END) AS like_timestamp,
          MAX(CASE WHEN src.source = 'feed' THEN COALESCE(src.source_timestamp, src.synced_at) END) AS feed_timestamp
        FROM archive_items ai
        LEFT JOIN archive_sources src ON src.tweet_id = ai.tweet_id
        WHERE ai.id = ? OR ai.tweet_id = ?
        GROUP BY ai.rowid
        LIMIT 1
      `,
      [id, id],
    );
    const row = rows[0]?.values?.[0];
    if (!row) return null;

    const tweetId = String(row[1]);
    const sources = parseSources(row[10]);
    const attachments = await listArchiveSources(tweetId);
    const mappedAttachments = Object.fromEntries(attachments.map((attachment) => {
      const source = pluralizeArchiveSource(attachment.source);
      return [source, {
        source,
        sourceTimestamp: attachment.sourceTimestamp ?? null,
        orderingKey: attachment.orderingKey ?? null,
        fetchPage: attachment.fetchPage ?? null,
        fetchPosition: attachment.fetchPosition ?? null,
        syncedAt: attachment.syncedAt,
        ingestedVia: attachment.ingestedVia ?? null,
        sourceRecordId: attachment.metadata && typeof attachment.metadata.sourceRecordId === 'string'
          ? attachment.metadata.sourceRecordId
          : undefined,
      } satisfies ApiArchiveSourceAttachment];
    })) as Partial<Record<HybridSearchSource, ApiArchiveSourceAttachment>>;

    return {
      id: String(row[0]),
      tweetId,
      url: String(row[2]),
      text: String(row[3] ?? ''),
      authorHandle: (row[4] as string) ?? undefined,
      authorName: (row[5] as string) ?? undefined,
      authorProfileImageUrl: (row[6] as string) ?? undefined,
      postedAt: (row[7] as string) ?? null,
      syncedAt: String(row[8]),
      sourceCount: Number(row[9] ?? 0),
      source: sources[0] ?? 'feed',
      sources,
      sourceDates: {
        bookmarks: (row[11] as string) ?? null,
        likes: (row[12] as string) ?? null,
        feed: (row[13] as string) ?? null,
      },
      attachments: mappedAttachments,
      isBookmarked: sources.includes('bookmarks'),
      isLiked: sources.includes('likes'),
      isInFeed: sources.includes('feed'),
    };
  } finally {
    db.close();
  }
}

function repoRootFromModule(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, '..');
}

export function resolveWebBuildDir(override?: string): string {
  if (override) return override;
  if (process.env.FT_WEB_DIST_DIR) return process.env.FT_WEB_DIST_DIR;

  const repoRoot = repoRootFromModule();
  const candidates = [
    path.join(repoRoot, 'dist', 'web'),
    path.join(repoRoot, 'web', 'dist'),
  ];

  const found = candidates.find((candidate) => fs.existsSync(path.join(candidate, 'index.html')));
  return found ?? candidates[0];
}

async function loadIndexHtml(staticDir: string): Promise<string> {
  const indexPath = path.join(staticDir, 'index.html');
  try {
    return await readFile(indexPath, 'utf8');
  } catch {
    throw new Error(`Web assets not found at ${staticDir}. Run npm run build first.`);
  }
}

export async function createWebApp(options: WebServerOptions = {}): Promise<Hono> {
  const staticDir = resolveWebBuildDir(options.staticDir);
  const indexHtml = await loadIndexHtml(staticDir);
  const app = new Hono();

  app.onError((error) => {
    const message = error instanceof Error ? error.message : 'Unexpected server error';
    const status = /Invalid search (query|mode|scope)|Invalid archive source/i.test(message) ? 400 : 500;
    return Response.json({ error: message }, { status });
  });

  app.get('/api/status', async (c) => {
    const response: ApiStatusResponse = {
      dataDir: dataDir(),
      archive: {
        total: fs.existsSync(twitterArchiveIndexPath()) ? await countArchiveItems() : 0,
        hasCache: fs.existsSync(twitterArchiveCachePath()),
        hasIndex: fs.existsSync(twitterArchiveIndexPath()),
      },
      bookmarks: {
        total: fs.existsSync(twitterBookmarksIndexPath()) ? await countBookmarks() : 0,
        hasCache: fs.existsSync(twitterBookmarksCachePath()),
        hasIndex: fs.existsSync(twitterBookmarksIndexPath()),
      },
      likes: {
        total: fs.existsSync(twitterLikesIndexPath()) ? await countLikes() : 0,
        hasCache: fs.existsSync(twitterLikesCachePath()),
        hasIndex: fs.existsSync(twitterLikesIndexPath()),
      },
      feed: {
        total: fs.existsSync(twitterFeedIndexPath()) ? await countFeed() : 0,
        hasCache: fs.existsSync(twitterFeedCachePath()),
        hasIndex: fs.existsSync(twitterFeedIndexPath()),
      },
    };
    return c.json(response);
  });

  app.get('/api/archive', async (c) => {
    const limit = parseInteger(c.req.query('limit'), 30, 1);
    const offset = parseInteger(c.req.query('offset'), 0, 0);
    const source = parseArchiveFilter(c.req.query('source'));
    if (!fs.existsSync(twitterArchiveIndexPath())) {
      const response: ApiArchiveListResponse = {
        resource: 'archive',
        source,
        total: 0,
        limit,
        offset,
        items: [],
      };
      return c.json(response);
    }

    const { total, items } = await listArchiveItems({
      source,
      query: c.req.query('query'),
      limit,
      offset,
    });

    const response: ApiArchiveListResponse = {
      resource: 'archive',
      source,
      total,
      limit,
      offset,
      items,
    };
    return c.json(response);
  });

  app.get('/api/archive/:id', async (c) => {
    if (!fs.existsSync(twitterArchiveIndexPath())) {
      return c.json({ error: 'Archive item not found' }, 404);
    }
    const item = await getArchiveItem(c.req.param('id'));
    if (!item) return c.json({ error: 'Archive item not found' }, 404);
    return c.json(item);
  });

  app.get('/api/feed/metrics', async (c) => {
    const response: ApiFeedMetricsResponse = await getFeedMetricsSnapshot();
    return c.json(response);
  });

  app.get('/api/search', async (c) => {
    const query = c.req.query('query') ?? '';
    const mode = parseHybridMode(c.req.query('mode'));
    const scope = parseHybridScope(c.req.query('scope'));
    const limit = parseInteger(c.req.query('limit'), 20, 1);
    const result = await runHybridSearch({ query, mode, scope, limit });

    const response: ApiHybridSearchResponse = {
      query: result.query,
      mode: result.mode,
      scope: result.scope,
      usedEngine: result.usedEngine,
      expansions: result.expansions,
      total: result.results.length,
      items: result.results,
    };
    return c.json(response);
  });

  app.get('/api/search/summary', async (c) => {
    const query = c.req.query('query') ?? '';
    const mode = parseHybridMode(c.req.query('mode'));
    const scope = parseHybridScope(c.req.query('scope'));
    const limit = parseInteger(c.req.query('limit'), 20, 1);
    const result = await runHybridSearch({ query, mode, scope, limit, summary: true });

    const response: ApiHybridSummaryResponse = {
      query: result.query,
      mode: result.mode,
      scope: result.scope,
      usedEngine: result.usedEngine,
      expansions: result.expansions,
      total: result.results.length,
      items: result.results,
      summary: result.summary ?? '',
    };
    return c.json(response);
  });

  app.get('/api/bookmarks', async (c) => {
    const limit = parseInteger(c.req.query('limit'), 30, 1);
    const offset = parseInteger(c.req.query('offset'), 0, 0);
    const sort: 'asc' | 'desc' = c.req.query('sort') === 'asc' ? 'asc' : 'desc';
    if (!fs.existsSync(twitterBookmarksIndexPath())) {
      const response: ApiListResponse<never> = {
        source: 'bookmarks',
        total: 0,
        limit,
        offset,
        items: [],
      };
      return c.json(response);
    }
    const filters: BookmarkTimelineFilters = {
      query: c.req.query('query'),
      author: c.req.query('author'),
      after: c.req.query('after'),
      before: c.req.query('before'),
      category: c.req.query('category'),
      domain: c.req.query('domain'),
      sort,
      limit,
      offset,
    };
    let items: Awaited<ReturnType<typeof listBookmarks>> = [];
    let total = 0;
    try {
      [items, total] = await Promise.all([
        listBookmarks(filters),
        countBookmarks(filters),
      ]);
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }

    const response: ApiListResponse<(typeof items)[number]> = {
      source: 'bookmarks',
      total,
      limit,
      offset,
      items,
    };
    return c.json(response);
  });

  app.get('/api/bookmarks/:id', async (c) => {
    if (!fs.existsSync(twitterBookmarksIndexPath())) {
      return c.json({ error: 'Bookmark not found' }, 404);
    }
    let item = null;
    try {
      item = await getBookmarkById(c.req.param('id'));
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
    if (!item) return c.json({ error: 'Bookmark not found' }, 404);
    return c.json(item);
  });

  app.get('/api/likes', async (c) => {
    const limit = parseInteger(c.req.query('limit'), 30, 1);
    const offset = parseInteger(c.req.query('offset'), 0, 0);
    const sort: 'asc' | 'desc' = c.req.query('sort') === 'asc' ? 'asc' : 'desc';
    if (!fs.existsSync(twitterLikesIndexPath())) {
      const response: ApiListResponse<never> = {
        source: 'likes',
        total: 0,
        limit,
        offset,
        items: [],
      };
      return c.json(response);
    }
    const filters: LikeTimelineFilters = {
      query: c.req.query('query'),
      author: c.req.query('author'),
      after: c.req.query('after'),
      before: c.req.query('before'),
      sort,
      limit,
      offset,
    };
    let items: Awaited<ReturnType<typeof listLikes>> = [];
    let total = 0;
    try {
      [items, total] = await Promise.all([
        listLikes(filters),
        countLikes(filters),
      ]);
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }

    const response: ApiListResponse<(typeof items)[number]> = {
      source: 'likes',
      total,
      limit,
      offset,
      items,
    };
    return c.json(response);
  });

  app.get('/api/likes/:id', async (c) => {
    if (!fs.existsSync(twitterLikesIndexPath())) {
      return c.json({ error: 'Like not found' }, 404);
    }
    let item = null;
    try {
      item = await getLikeById(c.req.param('id'));
    } catch (error) {
      if (!isMissingTableError(error)) throw error;
    }
    if (!item) return c.json({ error: 'Like not found' }, 404);
    return c.json(item);
  });

  app.get('/assets/*', serveStatic({ root: staticDir }));
  app.get('/favicon.ico', (c) => c.body(null, 204));
  app.get('*', (c) => c.html(indexHtml));

  return app;
}

export async function startWebServer(options: WebServerOptions = {}): Promise<RunningWebServer> {
  const host = options.host ?? '127.0.0.1';
  const port = options.port ?? 4310;
  const app = await createWebApp(options);

  const server = serve({
    fetch: app.fetch,
    hostname: host,
    port,
  });

  if (!server.listening) {
    await new Promise<void>((resolve, reject) => {
      const onListening = () => {
        server.off('error', onError);
        resolve();
      };
      const onError = (error: Error) => {
        server.off('listening', onListening);
        reject(error);
      };
      server.once('listening', onListening);
      server.once('error', onError);
    });
  }

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;

  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    },
  };
}
