import {
  normalizeLikeAnalysisConfidence,
  normalizeLikeAnalysisEvidence,
  normalizeLikeAnalysisTags,
  normalizeLikeAnalysisText,
  type LikeAnalysisModelInfo,
} from './like-analysis-types.js';

export const LIKE_CURATION_SCHEMA_VERSION = 1;

export const LIKE_CURATION_DECISIONS = ['keep', 'review', 'remove'] as const;
export const LIKE_CURATION_FRESHNESS = ['fresh', 'aging', 'stale', 'unknown'] as const;

export type LikeCurationDecision = typeof LIKE_CURATION_DECISIONS[number];
export type LikeCurationFreshness = typeof LIKE_CURATION_FRESHNESS[number];

export interface LikeCurationRecord {
  id: string;
  tweetId: string;
  url: string;
  sourceLikeId: string;
  authorHandle?: string;
  decision: LikeCurationDecision;
  value: number;
  freshness: LikeCurationFreshness;
  confidence: number;
  rationale: string;
  signals: string[];
  evidence: string[];
  model: LikeAnalysisModelInfo;
  curatedAt: string;
  sourceUpdatedAt?: string | null;
}

export interface LikeCurationMeta {
  schemaVersion: number;
  generatedAt: string;
  source: 'likes';
  sourceCount: number;
  curatedCount: number;
  failedCount: number;
  model: LikeAnalysisModelInfo;
  profilePath: string;
}

export interface LikeCurationDraft {
  decision?: string;
  value?: number;
  freshness?: string;
  confidence?: number;
  rationale?: string;
  signals?: string[];
  evidence?: string[];
}

const DECISION_SET = new Set<string>(LIKE_CURATION_DECISIONS);
const FRESHNESS_SET = new Set<string>(LIKE_CURATION_FRESHNESS);

function normalizeEnumValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeLikeCurationDecision(value: unknown): LikeCurationDecision {
  const normalized = normalizeEnumValue(value);
  return DECISION_SET.has(normalized) ? normalized as LikeCurationDecision : 'review';
}

export function normalizeLikeCurationFreshness(value: unknown): LikeCurationFreshness {
  const normalized = normalizeEnumValue(value);
  return FRESHNESS_SET.has(normalized) ? normalized as LikeCurationFreshness : 'unknown';
}

export function normalizeLikeCurationValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

export function normalizeLikeCurationSignals(value: unknown, limit = 6): string[] {
  return normalizeLikeAnalysisTags(value, limit);
}

export {
  normalizeLikeAnalysisConfidence as normalizeLikeCurationConfidence,
  normalizeLikeAnalysisEvidence as normalizeLikeCurationEvidence,
  normalizeLikeAnalysisText as normalizeLikeCurationText,
};
