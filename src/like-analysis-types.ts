export const LIKE_ANALYSIS_SCHEMA_VERSION = 1;

export const LIKE_PRIMARY_CATEGORIES = [
  'ai',
  'software-engineering',
  'infrastructure',
  'product-design',
  'business',
  'research',
  'security',
  'media-culture',
  'personal',
  'other',
] as const;

export const LIKE_CONTENT_TYPES = [
  'tool',
  'repo',
  'paper',
  'article',
  'thread',
  'announcement',
  'tutorial',
  'opinion',
  'demo',
  'dataset',
  'other',
] as const;

export type LikePrimaryCategory = typeof LIKE_PRIMARY_CATEGORIES[number];
export type LikeContentType = typeof LIKE_CONTENT_TYPES[number];
export type LikeAnalysisProvider = 'mock' | 'openai-compatible';

export interface LikeAnalysisModelInfo {
  provider: LikeAnalysisProvider;
  model: string;
  baseUrl?: string;
}

export interface LikeAnalysisRecord {
  id: string;
  tweetId: string;
  url: string;
  sourceLikeId: string;
  authorHandle?: string;
  primaryCategory: LikePrimaryCategory;
  subcategory: string;
  contentType: LikeContentType;
  tags: string[];
  summary: string;
  confidence: number;
  rationale: string;
  evidence: string[];
  deterministicHints: string[];
  model: LikeAnalysisModelInfo;
  classifiedAt: string;
  sourceUpdatedAt?: string | null;
}

export interface LikeAnalysisMeta {
  schemaVersion: number;
  generatedAt: string;
  source: 'likes';
  sourceCount: number;
  analyzedCount: number;
  failedCount: number;
  model: LikeAnalysisModelInfo;
}

export interface LikeAnalysisDraft {
  primaryCategory?: string;
  subcategory?: string;
  contentType?: string;
  tags?: string[];
  summary?: string;
  confidence?: number;
  rationale?: string;
  evidence?: string[];
}

const CATEGORY_SET = new Set<string>(LIKE_PRIMARY_CATEGORIES);
const CONTENT_TYPE_SET = new Set<string>(LIKE_CONTENT_TYPES);

function normalizeEnumValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeLikePrimaryCategory(value: unknown): LikePrimaryCategory {
  const normalized = normalizeEnumValue(value);
  return CATEGORY_SET.has(normalized)
    ? normalized as LikePrimaryCategory
    : 'other';
}

export function normalizeLikeContentType(value: unknown): LikeContentType {
  const normalized = normalizeEnumValue(value);
  return CONTENT_TYPE_SET.has(normalized)
    ? normalized as LikeContentType
    : 'other';
}

export function normalizeLikeAnalysisTags(value: unknown, limit = 6): string[] {
  if (!Array.isArray(value)) return [];
  const tags = new Set<string>();
  for (const entry of value) {
    const tag = normalizeEnumValue(entry);
    if (!tag || tag.length < 2) continue;
    tags.add(tag);
    if (tags.size >= limit) break;
  }
  return Array.from(tags);
}

export function normalizeLikeAnalysisConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeLikeAnalysisText(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

export function normalizeLikeAnalysisEvidence(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeLikeAnalysisText(entry))
    .filter(Boolean)
    .slice(0, limit);
}
