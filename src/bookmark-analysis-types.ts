export const BOOKMARK_ANALYSIS_SCHEMA_VERSION = 1;

export const BOOKMARK_PRIMARY_CATEGORIES = [
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

export const BOOKMARK_CONTENT_TYPES = [
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

export type BookmarkPrimaryCategory = typeof BOOKMARK_PRIMARY_CATEGORIES[number];
export type BookmarkContentType = typeof BOOKMARK_CONTENT_TYPES[number];
export type BookmarkAnalysisProvider = 'mock' | 'openai-compatible';

export interface BookmarkAnalysisModelInfo {
  provider: BookmarkAnalysisProvider;
  model: string;
  baseUrl?: string;
}

export interface BookmarkAnalysisRecord {
  id: string;
  tweetId: string;
  url: string;
  sourceBookmarkId: string;
  authorHandle?: string;
  primaryCategory: BookmarkPrimaryCategory;
  subcategory: string;
  contentType: BookmarkContentType;
  tags: string[];
  summary: string;
  confidence: number;
  rationale: string;
  evidence: string[];
  deterministicHints: string[];
  model: BookmarkAnalysisModelInfo;
  classifiedAt: string;
  sourceUpdatedAt?: string | null;
}

export interface BookmarkAnalysisMeta {
  schemaVersion: number;
  generatedAt: string;
  source: 'bookmarks';
  sourceCount: number;
  analyzedCount: number;
  failedCount: number;
  model: BookmarkAnalysisModelInfo;
}

export interface BookmarkAnalysisDraft {
  primaryCategory?: string;
  subcategory?: string;
  contentType?: string;
  tags?: string[];
  summary?: string;
  confidence?: number;
  rationale?: string;
  evidence?: string[];
}

const CATEGORY_SET = new Set<string>(BOOKMARK_PRIMARY_CATEGORIES);
const CONTENT_TYPE_SET = new Set<string>(BOOKMARK_CONTENT_TYPES);

function normalizeEnumValue(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function normalizeBookmarkPrimaryCategory(value: unknown): BookmarkPrimaryCategory {
  const normalized = normalizeEnumValue(value);
  return CATEGORY_SET.has(normalized)
    ? normalized as BookmarkPrimaryCategory
    : 'other';
}

export function normalizeBookmarkContentType(value: unknown): BookmarkContentType {
  const normalized = normalizeEnumValue(value);
  return CONTENT_TYPE_SET.has(normalized)
    ? normalized as BookmarkContentType
    : 'other';
}

export function normalizeBookmarkAnalysisTags(value: unknown, limit = 6): string[] {
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

export function normalizeBookmarkAnalysisConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

export function normalizeBookmarkAnalysisText(value: unknown, fallback = ''): string {
  return String(value ?? fallback).replace(/\s+/g, ' ').trim();
}

export function normalizeBookmarkAnalysisEvidence(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeBookmarkAnalysisText(entry))
    .filter(Boolean)
    .slice(0, limit);
}
