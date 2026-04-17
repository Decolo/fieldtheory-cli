import { syncBookmarksGraphQL, type SyncOptions as GraphqlBookmarkSyncOptions, type SyncResult } from './graphql-bookmarks.js';

export interface BookmarkSyncOptions extends Omit<GraphqlBookmarkSyncOptions, 'incremental' | 'resumeCursor' | 'stalePageLimit'> {
  rebuild?: boolean;
}

export interface BookmarkSyncResult {
  added: number;
  bookmarkedAtRepaired: number;
  totalBookmarks: number;
  bookmarkedAtMissing: number;
  pages: number;
  stopReason: string;
  cachePath: string;
  statePath: string;
  source: 'graphql';
}

interface BookmarkSyncDeps {
  syncGraphql: (options: GraphqlBookmarkSyncOptions) => Promise<SyncResult>;
}

const DEFAULT_DEPS: BookmarkSyncDeps = {
  syncGraphql: syncBookmarksGraphQL,
};

export async function syncBookmarks(
  options: BookmarkSyncOptions = {},
  deps: BookmarkSyncDeps = DEFAULT_DEPS,
): Promise<BookmarkSyncResult> {
  const result = await deps.syncGraphql({
    incremental: !Boolean(options.rebuild),
    maxPages: options.maxPages,
    targetAdds: options.targetAdds,
    delayMs: options.delayMs,
    maxMinutes: options.maxMinutes,
    pageSize: options.pageSize,
    browser: options.browser,
    chromeUserDataDir: options.chromeUserDataDir,
    chromeProfileDirectory: options.chromeProfileDirectory,
    firefoxProfileDir: options.firefoxProfileDir,
    csrfToken: options.csrfToken,
    cookieHeader: options.cookieHeader,
    onProgress: options.onProgress,
    checkpointEvery: options.checkpointEvery,
  });

  return {
    ...result,
    source: 'graphql',
  };
}
