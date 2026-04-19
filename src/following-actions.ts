import { buildFollowingReviewIndex } from './following-review-db.js';
import {
  readFollowingReviewResults,
  readFollowingSnapshot,
  writeFollowingReviewResults,
  writeFollowingSnapshot,
} from './following-review-state.js';

export interface FollowingUnfollowReconcileResult {
  targetUserId: string;
  removedFromSnapshot: boolean;
  updatedResults: boolean;
  totalFollowing: number;
  dbPath: string;
}

export async function reconcileUnfollowedAccount(targetUserId: string): Promise<FollowingUnfollowReconcileResult> {
  const normalizedTargetUserId = String(targetUserId);
  const [snapshot, results] = await Promise.all([
    readFollowingSnapshot(),
    readFollowingReviewResults(),
  ]);

  const nextSnapshot = snapshot.filter((account) => account.userId !== normalizedTargetUserId);
  const removedFromSnapshot = nextSnapshot.length !== snapshot.length;
  const nextResults = results.map((result) => result.targetUserId === normalizedTargetUserId
    ? {
      ...result,
      disposition: 'unfollowed' as const,
    }
    : result);
  const updatedResults = nextResults.some((result, index) => result.disposition !== results[index]?.disposition);

  await writeFollowingSnapshot(nextSnapshot);
  await writeFollowingReviewResults(nextResults);
  const index = await buildFollowingReviewIndex({ force: true });

  return {
    targetUserId: normalizedTargetUserId,
    removedFromSnapshot,
    updatedResults,
    totalFollowing: nextSnapshot.length,
    dbPath: index.dbPath,
  };
}
