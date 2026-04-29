import {
  normalizeBookmarkAnalysisConfidence,
  normalizeBookmarkAnalysisEvidence,
  normalizeBookmarkAnalysisTags,
  normalizeBookmarkAnalysisText,
  type BookmarkAnalysisModelInfo,
} from './bookmark-analysis-types.js';

export const BOOKMARK_CURATION_SCHEMA_VERSION = 1;

export const BOOKMARK_CURATION_DECISIONS = ['keep', 'review', 'remove'] as const;
export const BOOKMARK_CURATION_FRESHNESS = ['fresh', 'aging', 'stale', 'unknown'] as const;

export type BookmarkCurationDecision = typeof BOOKMARK_CURATION_DECISIONS[number];
export type BookmarkCurationFreshness = typeof BOOKMARK_CURATION_FRESHNESS[number];

export interface BookmarkCurationRecord {
  id: string;
  tweetId: string;
  url: string;
  sourceBookmarkId: string;
  authorHandle?: string;
  decision: BookmarkCurationDecision;
  value: number;
  freshness: BookmarkCurationFreshness;
  confidence: number;
  rationale: string;
  signals: string[];
  evidence: string[];
  model: BookmarkAnalysisModelInfo;
  curatedAt: string;
  sourceUpdatedAt?: string | null;
}

export interface BookmarkCurationMeta {
  schemaVersion: number;
  generatedAt: string;
  source: 'bookmarks';
  sourceCount: number;
  curatedCount: number;
  failedCount: number;
  model: BookmarkAnalysisModelInfo;
  profilePath: string;
}

export interface BookmarkCurationDraft {
  decision?: string;
  value?: number;
  freshness?: string;
  confidence?: number;
  rationale?: string;
  signals?: string[];
  evidence?: string[];
}

const DECISION_SET = new Set<string>(BOOKMARK_CURATION_DECISIONS);
const FRESHNESS_SET = new Set<string>(BOOKMARK_CURATION_FRESHNESS);

function normalizeEnumValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeBookmarkCurationDecision(value: unknown): BookmarkCurationDecision {
  const normalized = normalizeEnumValue(value);
  return DECISION_SET.has(normalized) ? normalized as BookmarkCurationDecision : 'review';
}

export function normalizeBookmarkCurationFreshness(value: unknown): BookmarkCurationFreshness {
  const normalized = normalizeEnumValue(value);
  return FRESHNESS_SET.has(normalized) ? normalized as BookmarkCurationFreshness : 'unknown';
}

export function normalizeBookmarkCurationValue(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 3;
  return Math.max(1, Math.min(5, Math.round(parsed)));
}

export function normalizeBookmarkCurationSignals(value: unknown, limit = 6): string[] {
  return normalizeBookmarkAnalysisTags(value, limit);
}

export {
  normalizeBookmarkAnalysisConfidence as normalizeBookmarkCurationConfidence,
  normalizeBookmarkAnalysisEvidence as normalizeBookmarkCurationEvidence,
  normalizeBookmarkAnalysisText as normalizeBookmarkCurationText,
};
