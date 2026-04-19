import { readFollowingReviewResults } from './following-review-state.js';
import type { AccountReviewResult } from './types.js';

export interface AccountReviewStatusView {
  totalResults: number;
  candidateCount: number;
  topCandidates: AccountReviewResult[];
}

export async function getAccountReviewStatusView(): Promise<AccountReviewStatusView> {
  const results = await readFollowingReviewResults();
  return {
    totalResults: results.length,
    candidateCount: results.filter((result) => result.disposition === 'candidate').length,
    topCandidates: results.filter((result) => result.disposition === 'candidate').slice(0, 10),
  };
}

function formatReason(result: AccountReviewResult): string {
  if (result.primaryReason === 'inactive') return `inactive (${result.evidence.inactivityDays ?? '?'}d)`;
  if (result.primaryReason === 'low_relevance') return 'low relevance';
  if (result.primaryReason === 'low_engagement') return 'low engagement';
  return 'uncertain';
}

export function formatAccountReviewResults(results: AccountReviewResult[]): string {
  if (results.length === 0) return 'No reviewed accounts yet.';
  const candidates = results.filter((result) => result.disposition === 'candidate');
  if (candidates.length === 0) return `Reviewed ${results.length} accounts. No conservative unfollow candidates right now.`;
  return [
    `Review candidates (${candidates.length})`,
    ...candidates.map((result, index) =>
      `${index + 1}. @${result.handle}${result.name ? ` (${result.name})` : ''}  score=${result.score.toFixed(2)}  ${formatReason(result)}`),
  ].join('\n');
}
