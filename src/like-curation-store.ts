import { readFile } from 'node:fs/promises';
import { countLikeProjections } from './archive-projections.js';
import { ensureDir, pathExists, readJson, writeJson, writeJsonLines } from './fs.js';
import { dataDir, twitterLikeCurationMetaPath, twitterLikeCurationPath } from './paths.js';
import {
  LIKE_CURATION_SCHEMA_VERSION,
  type LikeCurationDecision,
  type LikeCurationMeta,
  type LikeCurationRecord,
} from './like-curation-types.js';

export interface LikeCurationListFilters {
  decision?: LikeCurationDecision;
  signal?: string;
  limit?: number;
}

export interface LikeCurationStatus {
  sourceCount: number;
  curatedCount: number;
  coverage: number;
  meta?: LikeCurationMeta;
  curationPath: string;
  metaPath: string;
}

export interface LikeCurationSummary {
  decisions: Record<string, number>;
  freshness: Record<string, number>;
  signals: Record<string, number>;
  averageValue: number;
  lowConfidenceCount: number;
}

function matchesFilter(record: LikeCurationRecord, filters: LikeCurationListFilters): boolean {
  if (filters.decision && record.decision !== filters.decision) return false;
  if (filters.signal && !record.signals.includes(filters.signal)) return false;
  return true;
}

export async function readLikeCurationRecords(): Promise<LikeCurationRecord[]> {
  const filePath = twitterLikeCurationPath();
  if (!await pathExists(filePath)) return [];

  const raw = await readFile(filePath, 'utf8');
  const records: LikeCurationRecord[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as LikeCurationRecord);
    } catch (error) {
      throw new Error(`Invalid like curation JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return records;
}

export async function readLikeCurationMeta(): Promise<LikeCurationMeta | undefined> {
  if (!await pathExists(twitterLikeCurationMetaPath())) return undefined;
  return readJson<LikeCurationMeta>(twitterLikeCurationMetaPath());
}

export async function writeLikeCurationSnapshot(
  records: LikeCurationRecord[],
  meta: LikeCurationMeta,
): Promise<void> {
  await ensureDir(dataDir());
  await writeJsonLines(twitterLikeCurationPath(), records);
  await writeJson(twitterLikeCurationMetaPath(), meta);
}

export async function mergeLikeCurationRecords(
  nextRecords: LikeCurationRecord[],
  meta: LikeCurationMeta,
): Promise<LikeCurationRecord[]> {
  const existing = await readLikeCurationRecords();
  const byTweetId = new Map(existing.map((record) => [record.tweetId, record]));
  for (const record of nextRecords) byTweetId.set(record.tweetId, record);
  const merged = Array.from(byTweetId.values())
    .sort((left, right) => String(right.sourceUpdatedAt ?? '').localeCompare(String(left.sourceUpdatedAt ?? '')));
  await writeLikeCurationSnapshot(merged, { ...meta, curatedCount: merged.length });
  return merged;
}

export async function listLikeCurationRecords(
  filters: LikeCurationListFilters = {},
): Promise<LikeCurationRecord[]> {
  const limit = filters.limit ?? 30;
  return (await readLikeCurationRecords())
    .filter((record) => matchesFilter(record, filters))
    .slice(0, limit);
}

export async function getLikeCurationRecord(id: string): Promise<LikeCurationRecord | undefined> {
  const records = await readLikeCurationRecords();
  return records.find((record) => record.id === id || record.tweetId === id || record.sourceLikeId === id);
}

export async function getLikeCurationStatus(): Promise<LikeCurationStatus> {
  const [records, meta, sourceCount] = await Promise.all([
    readLikeCurationRecords(),
    readLikeCurationMeta(),
    countLikeProjections().catch(() => 0),
  ]);
  return {
    sourceCount,
    curatedCount: records.length,
    coverage: sourceCount > 0 ? records.length / sourceCount : 0,
    meta,
    curationPath: twitterLikeCurationPath(),
    metaPath: twitterLikeCurationMetaPath(),
  };
}

export async function getLikeCurationSummary(): Promise<LikeCurationSummary> {
  const summary: LikeCurationSummary = {
    decisions: {},
    freshness: {},
    signals: {},
    averageValue: 0,
    lowConfidenceCount: 0,
  };
  const records = await readLikeCurationRecords();
  let valueTotal = 0;
  for (const record of records) {
    summary.decisions[record.decision] = (summary.decisions[record.decision] ?? 0) + 1;
    summary.freshness[record.freshness] = (summary.freshness[record.freshness] ?? 0) + 1;
    valueTotal += record.value;
    if (record.confidence < 0.5) summary.lowConfidenceCount += 1;
    for (const signal of record.signals) summary.signals[signal] = (summary.signals[signal] ?? 0) + 1;
  }
  summary.averageValue = records.length > 0 ? valueTotal / records.length : 0;
  return summary;
}

export function buildLikeCurationMeta(
  input: Omit<LikeCurationMeta, 'schemaVersion' | 'source'>,
): LikeCurationMeta {
  return {
    schemaVersion: LIKE_CURATION_SCHEMA_VERSION,
    source: 'likes',
    ...input,
  };
}
