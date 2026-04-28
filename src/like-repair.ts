import { syncLikeGaps, type LikesGapFillResult } from './graphql-likes.js';
import type { GapFillProgress } from './graphql-bookmarks.js';

export interface LikeRepairOptions {
  onProgress?: (progress: GapFillProgress) => void;
  delayMs?: number;
}

interface LikeRepairDeps {
  syncGaps: (options?: LikeRepairOptions) => Promise<LikesGapFillResult>;
}

const DEFAULT_DEPS: LikeRepairDeps = {
  syncGaps: syncLikeGaps,
};

export type LikeRepairProgress = GapFillProgress;
export type LikeRepairResult = LikesGapFillResult;

export async function repairLikes(
  options: LikeRepairOptions = {},
  deps: LikeRepairDeps = DEFAULT_DEPS,
): Promise<LikeRepairResult> {
  return deps.syncGaps(options);
}
