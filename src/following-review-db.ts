import type { Database } from 'sql.js';
import { openDb, saveDb } from './db.js';
import { readFollowingLabels, readFollowingReviewResults, readFollowingSnapshot } from './following-review-state.js';
import { twitterFollowingReviewIndexPath } from './paths.js';
import type {
  AccountRelevanceLabel,
  AccountReviewReason,
  AccountReviewStage,
  FollowedAccountSnapshot,
  FollowedAccountState,
} from './types.js';

export interface FollowingReviewItem {
  userId: string;
  handle: string;
  name?: string;
  state: FollowedAccountState;
  label?: string;
  disposition?: string;
  primaryReason?: AccountReviewReason;
  stage?: AccountReviewStage;
  score?: number;
  lastPostedAt?: string | null;
  lastEvaluatedAt?: string | null;
}

export interface FollowingReviewFilters {
  limit?: number;
  offset?: number;
  disposition?: string;
}

function initSchema(db: Database): void {
  db.run(`CREATE TABLE IF NOT EXISTS following_review (
    user_id TEXT PRIMARY KEY,
    handle TEXT NOT NULL,
    name TEXT,
    state TEXT NOT NULL,
    followers_count INTEGER,
    following_count INTEGER,
    statuses_count INTEGER,
    verified INTEGER DEFAULT 0,
    protected INTEGER DEFAULT 0,
    label TEXT,
    disposition TEXT,
    primary_reason TEXT,
    stage TEXT,
    score REAL,
    last_posted_at TEXT,
    last_evaluated_at TEXT
  )`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_following_review_handle ON following_review(handle)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_following_review_disposition ON following_review(disposition)`);
}

function insertSnapshot(
  db: Database,
  snapshot: FollowedAccountSnapshot,
  label?: AccountRelevanceLabel,
  review?: {
    disposition?: string;
    primaryReason?: string;
    stage?: string;
    score?: number;
    lastEvaluatedAt?: string;
  },
): void {
  db.run(
    `INSERT OR REPLACE INTO following_review VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      snapshot.userId,
      snapshot.handle,
      snapshot.name ?? null,
      snapshot.state,
      snapshot.followersCount ?? null,
      snapshot.followingCount ?? null,
      snapshot.statusesCount ?? null,
      snapshot.verified ? 1 : 0,
      snapshot.protected ? 1 : 0,
      label?.value ?? null,
      review?.disposition ?? null,
      review?.primaryReason ?? null,
      review?.stage ?? null,
      review?.score ?? null,
      snapshot.lastPostedAt ?? null,
      review?.lastEvaluatedAt ?? null,
    ],
  );
}

function mapRow(row: unknown[]): FollowingReviewItem {
  return {
    userId: row[0] as string,
    handle: row[1] as string,
    name: (row[2] as string) ?? undefined,
    state: row[3] as FollowedAccountState,
    label: (row[9] as string) ?? undefined,
    disposition: (row[10] as string) ?? undefined,
    primaryReason: (row[11] as AccountReviewReason) ?? undefined,
    stage: (row[12] as AccountReviewStage) ?? undefined,
    score: row[13] == null ? undefined : Number(row[13]),
    lastPostedAt: (row[14] as string) ?? null,
    lastEvaluatedAt: (row[15] as string) ?? null,
  };
}

export async function buildFollowingReviewIndex(options?: { force?: boolean }): Promise<{ dbPath: string; recordCount: number }> {
  const [snapshots, labels, results] = await Promise.all([
    readFollowingSnapshot(),
    readFollowingLabels(),
    readFollowingReviewResults(),
  ]);
  const reviewsByUserId = new Map(results.map((result) => [result.targetUserId, result]));
  const dbPath = twitterFollowingReviewIndexPath();
  const db = await openDb(dbPath);

  try {
    if (options?.force) db.run('DROP TABLE IF EXISTS following_review');
    initSchema(db);
    db.run('DELETE FROM following_review');
    db.run('BEGIN TRANSACTION');
    try {
      for (const snapshot of snapshots) {
        const review = reviewsByUserId.get(snapshot.userId);
        insertSnapshot(db, snapshot, labels[snapshot.userId], review
          ? {
            disposition: review.disposition,
            primaryReason: review.primaryReason,
            stage: review.stage,
            score: review.score,
            lastEvaluatedAt: review.lastEvaluatedAt,
          }
          : undefined);
      }
      db.run('COMMIT');
    } catch (error) {
      db.run('ROLLBACK');
      throw error;
    }

    saveDb(db, dbPath);
    return {
      dbPath,
      recordCount: Number(db.exec('SELECT COUNT(*) FROM following_review')[0]?.values?.[0]?.[0] ?? 0),
    };
  } finally {
    db.close();
  }
}

export async function listFollowingReviewItems(filters: FollowingReviewFilters = {}): Promise<FollowingReviewItem[]> {
  const db = await openDb(twitterFollowingReviewIndexPath());
  try {
    const conditions: string[] = [];
    const params: Array<string | number> = [];
    if (filters.disposition) {
      conditions.push('disposition = ?');
      params.push(filters.disposition);
    }
    params.push(filters.limit ?? 50, filters.offset ?? 0);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.exec(
      `SELECT
        user_id,
        handle,
        name,
        state,
        followers_count,
        following_count,
        statuses_count,
        verified,
        protected,
        label,
        disposition,
        primary_reason,
        stage,
        score,
        last_posted_at,
        last_evaluated_at
      FROM following_review
      ${where}
      ORDER BY
        CASE WHEN disposition = 'candidate' THEN 0 ELSE 1 END,
        COALESCE(score, -1) DESC,
        handle ASC
      LIMIT ?
      OFFSET ?`,
      params,
    );
    return (rows[0]?.values ?? []).map((row) => mapRow(row));
  } finally {
    db.close();
  }
}

export async function getFollowingReviewItemByHandle(handle: string): Promise<FollowingReviewItem | null> {
  const db = await openDb(twitterFollowingReviewIndexPath());
  try {
    const rows = db.exec(
      `SELECT
        user_id,
        handle,
        name,
        state,
        followers_count,
        following_count,
        statuses_count,
        verified,
        protected,
        label,
        disposition,
        primary_reason,
        stage,
        score,
        last_posted_at,
        last_evaluated_at
      FROM following_review
      WHERE handle = ?
      LIMIT 1`,
      [String(handle).trim().replace(/^@+/, '').toLowerCase()],
    );
    const row = rows[0]?.values?.[0];
    return row ? mapRow(row) : null;
  } finally {
    db.close();
  }
}
