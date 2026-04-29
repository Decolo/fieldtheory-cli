import { readFile } from 'node:fs/promises';
import { countBookmarkProjections } from './archive-projections.js';
import { ensureDir, pathExists, readJson, writeJson, writeJsonLines } from './fs.js';
import { dataDir, twitterBookmarkAnalysisMetaPath, twitterBookmarkAnalysisPath } from './paths.js';
import {
  BOOKMARK_ANALYSIS_SCHEMA_VERSION,
  type BookmarkAnalysisMeta,
  type BookmarkAnalysisRecord,
} from './bookmark-analysis-types.js';

export interface BookmarkAnalysisListFilters {
  primaryCategory?: string;
  contentType?: string;
  tag?: string;
  limit?: number;
}

export interface BookmarkAnalysisStatus {
  sourceCount: number;
  analyzedCount: number;
  coverage: number;
  meta?: BookmarkAnalysisMeta;
  analysisPath: string;
  metaPath: string;
}

export interface BookmarkAnalysisCategoryCounts {
  primaryCategories: Record<string, number>;
  contentTypes: Record<string, number>;
  tags: Record<string, number>;
}

function matchesFilter(record: BookmarkAnalysisRecord, filters: BookmarkAnalysisListFilters): boolean {
  if (filters.primaryCategory && record.primaryCategory !== filters.primaryCategory) return false;
  if (filters.contentType && record.contentType !== filters.contentType) return false;
  if (filters.tag && !record.tags.includes(filters.tag)) return false;
  return true;
}

export async function readBookmarkAnalysisRecords(): Promise<BookmarkAnalysisRecord[]> {
  const filePath = twitterBookmarkAnalysisPath();
  if (!await pathExists(filePath)) return [];

  const raw = await readFile(filePath, 'utf8');
  const records: BookmarkAnalysisRecord[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as BookmarkAnalysisRecord);
    } catch (error) {
      throw new Error(`Invalid bookmark analysis JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return records;
}

export async function readBookmarkAnalysisMeta(): Promise<BookmarkAnalysisMeta | undefined> {
  const filePath = twitterBookmarkAnalysisMetaPath();
  if (!await pathExists(filePath)) return undefined;
  return readJson<BookmarkAnalysisMeta>(filePath);
}

export async function writeBookmarkAnalysisSnapshot(
  records: BookmarkAnalysisRecord[],
  meta: BookmarkAnalysisMeta,
): Promise<void> {
  await ensureDir(dataDir());
  await writeJsonLines(twitterBookmarkAnalysisPath(), records);
  await writeJson(twitterBookmarkAnalysisMetaPath(), meta);
}

export async function mergeBookmarkAnalysisRecords(
  nextRecords: BookmarkAnalysisRecord[],
  meta: BookmarkAnalysisMeta,
): Promise<BookmarkAnalysisRecord[]> {
  const existing = await readBookmarkAnalysisRecords();
  const byTweetId = new Map(existing.map((record) => [record.tweetId, record]));
  for (const record of nextRecords) byTweetId.set(record.tweetId, record);

  const merged = Array.from(byTweetId.values())
    .sort((left, right) => String(right.sourceUpdatedAt ?? '').localeCompare(String(left.sourceUpdatedAt ?? '')));
  const nextMeta = {
    ...meta,
    analyzedCount: merged.length,
  };
  await writeBookmarkAnalysisSnapshot(merged, nextMeta);
  return merged;
}

export async function listBookmarkAnalysisRecords(
  filters: BookmarkAnalysisListFilters = {},
): Promise<BookmarkAnalysisRecord[]> {
  const limit = filters.limit ?? 30;
  return (await readBookmarkAnalysisRecords())
    .filter((record) => matchesFilter(record, filters))
    .slice(0, limit);
}

export async function getBookmarkAnalysisRecord(id: string): Promise<BookmarkAnalysisRecord | undefined> {
  const records = await readBookmarkAnalysisRecords();
  return records.find((record) => record.id === id || record.tweetId === id || record.sourceBookmarkId === id);
}

export async function getBookmarkAnalysisStatus(): Promise<BookmarkAnalysisStatus> {
  const [records, meta, sourceCount] = await Promise.all([
    readBookmarkAnalysisRecords(),
    readBookmarkAnalysisMeta(),
    countBookmarkProjections().catch(() => 0),
  ]);
  const analyzedCount = records.length;
  return {
    sourceCount,
    analyzedCount,
    coverage: sourceCount > 0 ? analyzedCount / sourceCount : 0,
    meta,
    analysisPath: twitterBookmarkAnalysisPath(),
    metaPath: twitterBookmarkAnalysisMetaPath(),
  };
}

export async function getBookmarkAnalysisCategoryCounts(): Promise<BookmarkAnalysisCategoryCounts> {
  const counts: BookmarkAnalysisCategoryCounts = {
    primaryCategories: {},
    contentTypes: {},
    tags: {},
  };

  for (const record of await readBookmarkAnalysisRecords()) {
    counts.primaryCategories[record.primaryCategory] = (counts.primaryCategories[record.primaryCategory] ?? 0) + 1;
    counts.contentTypes[record.contentType] = (counts.contentTypes[record.contentType] ?? 0) + 1;
    for (const tag of record.tags) counts.tags[tag] = (counts.tags[tag] ?? 0) + 1;
  }

  return counts;
}

export function buildBookmarkAnalysisMeta(
  input: Omit<BookmarkAnalysisMeta, 'schemaVersion' | 'source'>,
): BookmarkAnalysisMeta {
  return {
    schemaVersion: BOOKMARK_ANALYSIS_SCHEMA_VERSION,
    source: 'bookmarks',
    ...input,
  };
}
