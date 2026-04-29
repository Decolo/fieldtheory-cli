import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getBookmarkCurationRecord,
  getBookmarkCurationSummary,
  listBookmarkCurationRecords,
  mergeBookmarkCurationRecords,
  readBookmarkCurationRecords,
} from '../src/bookmark-curation-store.js';
import type { BookmarkCurationMeta, BookmarkCurationRecord } from '../src/bookmark-curation-types.js';

function record(overrides: Partial<BookmarkCurationRecord> = {}): BookmarkCurationRecord {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    sourceBookmarkId: '1',
    authorHandle: 'alice',
    decision: 'keep',
    value: 5,
    freshness: 'fresh',
    confidence: 0.8,
    rationale: 'Durable practice-oriented material.',
    signals: ['practice-oriented', 'repo'],
    evidence: ['GitHub repository link detected.'],
    model: { provider: 'mock', model: 'mock' },
    curatedAt: '2026-04-29T00:00:00Z',
    sourceUpdatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function meta(overrides: Partial<BookmarkCurationMeta> = {}): BookmarkCurationMeta {
  return {
    schemaVersion: 1,
    generatedAt: '2026-04-29T00:00:00Z',
    source: 'bookmarks',
    sourceCount: 2,
    curatedCount: 1,
    failedCount: 0,
    model: { provider: 'mock', model: 'mock' },
    profilePath: '/tmp/profile.md',
    ...overrides,
  };
}

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-bookmark-curation-store-'));
  const saved = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    if (saved !== undefined) process.env.FT_DATA_DIR = saved;
    else delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('mergeBookmarkCurationRecords upserts by tweet id and supports filters', async () => {
  await withDataDir(async () => {
    await mergeBookmarkCurationRecords([record()], meta());
    await mergeBookmarkCurationRecords([
      record({ decision: 'review', value: 3, signals: ['needs-human-review'], sourceUpdatedAt: '2026-04-02T00:00:00Z' }),
      record({ id: '2', tweetId: '2', decision: 'remove', value: 2, freshness: 'aging', signals: ['marketing-like'] }),
    ], meta({ sourceCount: 2 }));

    const records = await readBookmarkCurationRecords();
    assert.equal(records.length, 2);
    assert.equal(records.find((entry) => entry.tweetId === '1')?.decision, 'review');

    const review = await listBookmarkCurationRecords({ decision: 'review', signal: 'needs-human-review' });
    assert.equal(review.length, 1);
    assert.equal(review[0]?.tweetId, '1');

    const found = await getBookmarkCurationRecord('2');
    assert.equal(found?.decision, 'remove');
  });
});

test('getBookmarkCurationSummary aggregates decisions, freshness, signals, and confidence', async () => {
  await withDataDir(async () => {
    await mergeBookmarkCurationRecords([
      record(),
      record({ id: '2', tweetId: '2', decision: 'review', value: 3, freshness: 'unknown', confidence: 0.4, signals: ['needs-human-review'] }),
    ], meta({ sourceCount: 2 }));

    const summary = await getBookmarkCurationSummary();
    assert.equal(summary.decisions.keep, 1);
    assert.equal(summary.decisions.review, 1);
    assert.equal(summary.freshness.fresh, 1);
    assert.equal(summary.signals['practice-oriented'], 1);
    assert.equal(summary.lowConfidenceCount, 1);
    assert.equal(summary.averageValue, 4);
  });
});

test('readBookmarkCurationRecords reports corrupt JSONL lines', async () => {
  await withDataDir(async (dir) => {
    await writeFile(path.join(dir, 'bookmark-curation.jsonl'), '{"tweetId":"1"}\nnot-json\n');

    await assert.rejects(
      () => readBookmarkCurationRecords(),
      /Invalid bookmark curation JSONL at line 2/,
    );
  });
});
