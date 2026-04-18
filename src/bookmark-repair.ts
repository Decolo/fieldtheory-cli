import { syncGaps, type GapFillProgress, type GapFillResult } from './graphql-bookmarks.js';

export interface BookmarkRepairOptions {
  onProgress?: (progress: GapFillProgress) => void;
  delayMs?: number;
}

interface BookmarkRepairDeps {
  syncGaps: (options?: BookmarkRepairOptions) => Promise<GapFillResult>;
}

const DEFAULT_DEPS: BookmarkRepairDeps = {
  syncGaps,
};

export type BookmarkRepairProgress = GapFillProgress;
export type BookmarkRepairResult = GapFillResult;

export async function repairBookmarks(
  options: BookmarkRepairOptions = {},
  deps: BookmarkRepairDeps = DEFAULT_DEPS,
): Promise<BookmarkRepairResult> {
  return deps.syncGaps(options);
}
