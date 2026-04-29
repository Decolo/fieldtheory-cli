import { readFile } from 'node:fs/promises';
import { countBookmarkProjections } from './archive-projections.js';
import { ensureDir, pathExists, readJson, writeJson, writeJsonLines } from './fs.js';
import { dataDir, twitterBookmarkCurationMetaPath, twitterBookmarkCurationPath } from './paths.js';
import {
  BOOKMARK_CURATION_SCHEMA_VERSION,
  type BookmarkCurationDecision,
  type BookmarkCurationMeta,
  type BookmarkCurationRecord,
} from './bookmark-curation-types.js';

export interface BookmarkCurationListFilters {
  decision?: BookmarkCurationDecision;
  signal?: string;
  limit?: number;
}

export interface BookmarkCurationStatus {
  sourceCount: number;
  curatedCount: number;
  coverage: number;
  meta?: BookmarkCurationMeta;
  curationPath: string;
  metaPath: string;
}

export interface BookmarkCurationSummary {
  decisions: Record<string, number>;
  freshness: Record<string, number>;
  signals: Record<string, number>;
  averageValue: number;
  lowConfidenceCount: number;
}

function matchesFilter(record: BookmarkCurationRecord, filters: BookmarkCurationListFilters): boolean {
  if (filters.decision && record.decision !== filters.decision) return false;
  if (filters.signal && !record.signals.includes(filters.signal)) return false;
  return true;
}

export async function readBookmarkCurationRecords(): Promise<BookmarkCurationRecord[]> {
  const filePath = twitterBookmarkCurationPath();
  if (!await pathExists(filePath)) return [];

  const raw = await readFile(filePath, 'utf8');
  const records: BookmarkCurationRecord[] = [];
  for (const [index, line] of raw.split('\n').entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as BookmarkCurationRecord);
    } catch (error) {
      throw new Error(`Invalid bookmark curation JSONL at line ${index + 1}: ${(error as Error).message}`);
    }
  }
  return records;
}

export async function readBookmarkCurationMeta(): Promise<BookmarkCurationMeta | undefined> {
  if (!await pathExists(twitterBookmarkCurationMetaPath())) return undefined;
  return readJson<BookmarkCurationMeta>(twitterBookmarkCurationMetaPath());
}

export async function writeBookmarkCurationSnapshot(
  records: BookmarkCurationRecord[],
  meta: BookmarkCurationMeta,
): Promise<void> {
  await ensureDir(dataDir());
  await writeJsonLines(twitterBookmarkCurationPath(), records);
  await writeJson(twitterBookmarkCurationMetaPath(), meta);
}

export async function mergeBookmarkCurationRecords(
  nextRecords: BookmarkCurationRecord[],
  meta: BookmarkCurationMeta,
): Promise<BookmarkCurationRecord[]> {
  const existing = await readBookmarkCurationRecords();
  const byTweetId = new Map(existing.map((record) => [record.tweetId, record]));
  for (const record of nextRecords) byTweetId.set(record.tweetId, record);
  const merged = Array.from(byTweetId.values())
    .sort((left, right) => String(right.sourceUpdatedAt ?? '').localeCompare(String(left.sourceUpdatedAt ?? '')));
  await writeBookmarkCurationSnapshot(merged, { ...meta, curatedCount: merged.length });
  return merged;
}

export async function listBookmarkCurationRecords(
  filters: BookmarkCurationListFilters = {},
): Promise<BookmarkCurationRecord[]> {
  const limit = filters.limit ?? 30;
  return (await readBookmarkCurationRecords())
    .filter((record) => matchesFilter(record, filters))
    .slice(0, limit);
}

export async function getBookmarkCurationRecord(id: string): Promise<BookmarkCurationRecord | undefined> {
  const records = await readBookmarkCurationRecords();
  return records.find((record) => record.id === id || record.tweetId === id || record.sourceBookmarkId === id);
}

export async function getBookmarkCurationStatus(): Promise<BookmarkCurationStatus> {
  const [records, meta, sourceCount] = await Promise.all([
    readBookmarkCurationRecords(),
    readBookmarkCurationMeta(),
    countBookmarkProjections().catch(() => 0),
  ]);
  return {
    sourceCount,
    curatedCount: records.length,
    coverage: sourceCount > 0 ? records.length / sourceCount : 0,
    meta,
    curationPath: twitterBookmarkCurationPath(),
    metaPath: twitterBookmarkCurationMetaPath(),
  };
}

export async function getBookmarkCurationSummary(): Promise<BookmarkCurationSummary> {
  const summary: BookmarkCurationSummary = {
    decisions: {},
    freshness: {},
    signals: {},
    averageValue: 0,
    lowConfidenceCount: 0,
  };
  const records = await readBookmarkCurationRecords();
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

export function buildBookmarkCurationMeta(
  input: Omit<BookmarkCurationMeta, 'schemaVersion' | 'source'>,
): BookmarkCurationMeta {
  return {
    schemaVersion: BOOKMARK_CURATION_SCHEMA_VERSION,
    source: 'bookmarks',
    ...input,
  };
}
