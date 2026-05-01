import { readFile } from 'node:fs/promises';
import { countLikeProjections } from './archive-projections.js';
import { ensureDir, pathExists, readJson, writeJson, writeJsonLines } from './fs.js';
import { dataDir, twitterLikeAnalysisMetaPath, twitterLikeAnalysisPath } from './paths.js';
import {
  LIKE_ANALYSIS_SCHEMA_VERSION,
  type LikeAnalysisMeta,
  type LikeAnalysisRecord,
} from './like-analysis-types.js';

export interface LikeAnalysisListFilters {
  primaryCategory?: string;
  contentType?: string;
  tag?: string;
  limit?: number;
}

export interface LikeAnalysisStatus {
  sourceCount: number;
  analyzedCount: number;
  coverage: number;
  meta?: LikeAnalysisMeta;
  analysisPath: string;
  metaPath: string;
}

export interface LikeAnalysisCategoryCounts {
  primaryCategories: Record<string, number>;
  contentTypes: Record<string, number>;
  tags: Record<string, number>;
}

function matchesFilter(record: LikeAnalysisRecord, filters: LikeAnalysisListFilters): boolean {
  if (filters.primaryCategory && record.primaryCategory !== filters.primaryCategory) return false;
  if (filters.contentType && record.contentType !== filters.contentType) return false;
  if (filters.tag && !record.tags.includes(filters.tag)) return false;
  return true;
}

export async function readLikeAnalysisRecords(): Promise<LikeAnalysisRecord[]> {
  const filePath = twitterLikeAnalysisPath();
  if (!await pathExists(filePath)) return [];

  const raw = await readFile(filePath, 'utf8');
  const records: LikeAnalysisRecord[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as LikeAnalysisRecord);
    } catch (error) {
      throw new Error(`Invalid like analysis JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return records;
}

export async function readLikeAnalysisMeta(): Promise<LikeAnalysisMeta | undefined> {
  const filePath = twitterLikeAnalysisMetaPath();
  if (!await pathExists(filePath)) return undefined;
  return readJson<LikeAnalysisMeta>(filePath);
}

export async function writeLikeAnalysisSnapshot(
  records: LikeAnalysisRecord[],
  meta: LikeAnalysisMeta,
): Promise<void> {
  await ensureDir(dataDir());
  await writeJsonLines(twitterLikeAnalysisPath(), records);
  await writeJson(twitterLikeAnalysisMetaPath(), meta);
}

export async function mergeLikeAnalysisRecords(
  nextRecords: LikeAnalysisRecord[],
  meta: LikeAnalysisMeta,
): Promise<LikeAnalysisRecord[]> {
  const existing = await readLikeAnalysisRecords();
  const byTweetId = new Map(existing.map((record) => [record.tweetId, record]));
  for (const record of nextRecords) byTweetId.set(record.tweetId, record);

  const merged = Array.from(byTweetId.values())
    .sort((left, right) => String(right.sourceUpdatedAt ?? '').localeCompare(String(left.sourceUpdatedAt ?? '')));
  const nextMeta = {
    ...meta,
    analyzedCount: merged.length,
  };
  await writeLikeAnalysisSnapshot(merged, nextMeta);
  return merged;
}

export async function listLikeAnalysisRecords(
  filters: LikeAnalysisListFilters = {},
): Promise<LikeAnalysisRecord[]> {
  const limit = filters.limit ?? 30;
  return (await readLikeAnalysisRecords())
    .filter((record) => matchesFilter(record, filters))
    .slice(0, limit);
}

export async function getLikeAnalysisRecord(id: string): Promise<LikeAnalysisRecord | undefined> {
  const records = await readLikeAnalysisRecords();
  return records.find((record) => record.id === id || record.tweetId === id || record.sourceLikeId === id);
}

export async function getLikeAnalysisStatus(): Promise<LikeAnalysisStatus> {
  const [records, meta, sourceCount] = await Promise.all([
    readLikeAnalysisRecords(),
    readLikeAnalysisMeta(),
    countLikeProjections().catch(() => 0),
  ]);
  const analyzedCount = records.length;
  return {
    sourceCount,
    analyzedCount,
    coverage: sourceCount > 0 ? analyzedCount / sourceCount : 0,
    meta,
    analysisPath: twitterLikeAnalysisPath(),
    metaPath: twitterLikeAnalysisMetaPath(),
  };
}

export async function getLikeAnalysisCategoryCounts(): Promise<LikeAnalysisCategoryCounts> {
  const counts: LikeAnalysisCategoryCounts = {
    primaryCategories: {},
    contentTypes: {},
    tags: {},
  };

  for (const record of await readLikeAnalysisRecords()) {
    counts.primaryCategories[record.primaryCategory] = (counts.primaryCategories[record.primaryCategory] ?? 0) + 1;
    counts.contentTypes[record.contentType] = (counts.contentTypes[record.contentType] ?? 0) + 1;
    for (const tag of record.tags) counts.tags[tag] = (counts.tags[tag] ?? 0) + 1;
  }

  return counts;
}

export function buildLikeAnalysisMeta(
  input: Omit<LikeAnalysisMeta, 'schemaVersion' | 'source'>,
): LikeAnalysisMeta {
  return {
    schemaVersion: LIKE_ANALYSIS_SCHEMA_VERSION,
    source: 'likes',
    ...input,
  };
}
