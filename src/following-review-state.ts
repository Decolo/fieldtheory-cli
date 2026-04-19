import { ensureDir, pathExists, readJson, readJsonLines, writeJson, writeJsonLines } from './fs.js';
import path from 'node:path';
import {
  twitterFollowingAccountCachePath,
  twitterFollowingLabelsPath,
  twitterFollowingReviewResultsPath,
  twitterFollowingReviewStatePath,
  twitterFollowingRootDir,
  twitterFollowingSnapshotPath,
} from './paths.js';
import type {
  AccountRelevanceLabel,
  AccountRelevanceLabelValue,
  AccountReviewResult,
  FollowedAccountSnapshot,
  FollowingAccountEvidenceCache,
  FollowingReviewState,
} from './types.js';

const SCHEMA_VERSION = 1;

function emptyReviewState(): FollowingReviewState {
  return {
    provider: 'twitter',
    schemaVersion: SCHEMA_VERSION,
    followingSnapshotComplete: false,
    lastReviewCount: 0,
    totalFollowing: 0,
    candidateCount: 0,
    deepScannedUserIds: [],
  };
}

function normalizeHandle(value: string): string {
  const normalized = String(value).trim().replace(/^@+/, '').toLowerCase();
  if (!normalized) throw new Error('Account handle is required.');
  return normalized;
}

export async function readFollowingSnapshot(): Promise<FollowedAccountSnapshot[]> {
  return readJsonLines<FollowedAccountSnapshot>(twitterFollowingSnapshotPath());
}

export async function writeFollowingSnapshot(
  snapshots: FollowedAccountSnapshot[],
  options: { sourceUserId?: string; lastSyncedAt?: string; lastCursor?: string; complete?: boolean } = {},
): Promise<FollowedAccountSnapshot[]> {
  await ensureDir(twitterFollowingRootDir());
  const byUserId = new Map<string, FollowedAccountSnapshot>();
  for (const snapshot of snapshots) {
    byUserId.set(String(snapshot.userId), {
      ...snapshot,
      handle: normalizeHandle(snapshot.handle),
    });
  }
  const rows = Array.from(byUserId.values()).sort((left, right) => left.handle.localeCompare(right.handle));
  await writeJsonLines(twitterFollowingSnapshotPath(), rows);

  const state = await readFollowingReviewState();
  const complete = options.complete ?? true;
  await writeFollowingReviewState({
    ...state,
    sourceUserId: options.sourceUserId ?? state.sourceUserId,
    lastFollowingSyncAt: options.lastSyncedAt ?? state.lastFollowingSyncAt,
    followingSnapshotComplete: complete,
    totalFollowing: complete ? rows.length : state.totalFollowing,
    lastCursor: complete ? undefined : options.lastCursor,
  });
  return rows;
}

export async function readFollowingLabels(): Promise<Record<string, AccountRelevanceLabel>> {
  const filePath = twitterFollowingLabelsPath();
  if (!(await pathExists(filePath))) return {};
  return readJson<Record<string, AccountRelevanceLabel>>(filePath);
}

export async function writeFollowingLabels(labels: Record<string, AccountRelevanceLabel>): Promise<void> {
  await ensureDir(twitterFollowingRootDir());
  await writeJson(twitterFollowingLabelsPath(), labels);
}

export async function setFollowingLabel(input: {
  targetUserId: string;
  handle: string;
  value: AccountRelevanceLabelValue;
  updatedAt?: string;
  note?: string;
}): Promise<AccountRelevanceLabel> {
  const labels = await readFollowingLabels();
  const label: AccountRelevanceLabel = {
    targetUserId: String(input.targetUserId),
    currentHandle: normalizeHandle(input.handle),
    value: input.value,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
    note: input.note,
  };
  labels[label.targetUserId] = label;
  await writeFollowingLabels(labels);
  return label;
}

export async function deleteFollowingLabel(targetUserId: string): Promise<boolean> {
  const labels = await readFollowingLabels();
  if (!labels[String(targetUserId)]) return false;
  delete labels[String(targetUserId)];
  await writeFollowingLabels(labels);
  return true;
}

export async function readFollowingReviewResults(): Promise<AccountReviewResult[]> {
  return readJsonLines<AccountReviewResult>(twitterFollowingReviewResultsPath());
}

export async function writeFollowingReviewResults(
  results: AccountReviewResult[],
  options: { reviewedAt?: string; deepScannedUserIds?: string[] } = {},
): Promise<AccountReviewResult[]> {
  await ensureDir(twitterFollowingRootDir());
  const rows = [...results]
    .map((result) => ({ ...result, handle: normalizeHandle(result.handle) }))
    .sort((left, right) => right.score - left.score || left.handle.localeCompare(right.handle));
  await writeJsonLines(twitterFollowingReviewResultsPath(), rows);

  const state = await readFollowingReviewState();
  await writeFollowingReviewState({
    ...state,
    lastReviewRunAt: options.reviewedAt ?? state.lastReviewRunAt,
    lastReviewCount: rows.length,
    candidateCount: rows.filter((row) => row.disposition === 'candidate').length,
    deepScannedUserIds: options.deepScannedUserIds ?? state.deepScannedUserIds,
  });
  return rows;
}

export async function readFollowingReviewState(): Promise<FollowingReviewState> {
  const filePath = twitterFollowingReviewStatePath();
  if (!(await pathExists(filePath))) return emptyReviewState();
  const state = await readJson<FollowingReviewState>(filePath);
  return {
    ...emptyReviewState(),
    ...state,
    schemaVersion: state.schemaVersion ?? SCHEMA_VERSION,
    deepScannedUserIds: Array.isArray(state.deepScannedUserIds) ? state.deepScannedUserIds.map(String) : [],
  };
}

export async function writeFollowingReviewState(state: FollowingReviewState): Promise<void> {
  await ensureDir(twitterFollowingRootDir());
  await writeJson(twitterFollowingReviewStatePath(), {
    ...emptyReviewState(),
    ...state,
    provider: 'twitter',
    schemaVersion: SCHEMA_VERSION,
    deepScannedUserIds: Array.from(new Set((state.deepScannedUserIds ?? []).map(String))),
  } satisfies FollowingReviewState);
}

export async function resolveFollowedAccountFromCache(handle: string): Promise<FollowedAccountSnapshot | null> {
  const normalized = normalizeHandle(handle);
  const snapshots = await readFollowingSnapshot();
  return snapshots.find((snapshot) => normalizeHandle(snapshot.handle) === normalized) ?? null;
}

export async function getFollowingReviewCache(): Promise<{
  snapshot: FollowedAccountSnapshot[];
  labels: Record<string, AccountRelevanceLabel>;
  results: AccountReviewResult[];
  state: FollowingReviewState;
}> {
  const [snapshot, labels, results, state] = await Promise.all([
    readFollowingSnapshot(),
    readFollowingLabels(),
    readFollowingReviewResults(),
    readFollowingReviewState(),
  ]);
  return { snapshot, labels, results, state };
}

export async function readFollowingAccountCache(targetUserId: string): Promise<FollowingAccountEvidenceCache | null> {
  const filePath = twitterFollowingAccountCachePath(targetUserId);
  if (!(await pathExists(filePath))) return null;
  return readJson<FollowingAccountEvidenceCache>(filePath);
}

export async function writeFollowingAccountCache(cache: FollowingAccountEvidenceCache): Promise<void> {
  const filePath = twitterFollowingAccountCachePath(cache.targetUserId);
  await ensureDir(path.dirname(filePath));
  await writeJson(filePath, cache);
}
