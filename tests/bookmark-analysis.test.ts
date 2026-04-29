import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBookmarkAnalysis } from '../src/bookmark-analysis.js';
import { readBookmarkAnalysisRecords, readBookmarkAnalysisMeta } from '../src/bookmark-analysis-store.js';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { buildIndex } from '../src/bookmarks-db.js';
import type { BookmarkAnalysisInput } from '../src/bookmark-analysis-input.js';
import type { BookmarkAnalysisDraft, BookmarkAnalysisModelInfo } from '../src/bookmark-analysis-types.js';

function bookmark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = String(overrides.id ?? '1');
  return {
    id,
    tweetId: String(overrides.tweetId ?? id),
    url: `https://x.com/${String(overrides.authorHandle ?? 'alice')}/status/${String(overrides.tweetId ?? id)}`,
    text: 'A GitHub repo for Claude Code agent memory.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-01T00:00:00Z',
    postedAt: '2026-04-01T00:00:00Z',
    bookmarkedAt: '2026-04-02T00:00:00Z',
    links: ['https://github.com/example/agent-memory'],
    githubUrls: ['https://github.com/example/agent-memory'],
    tags: [],
    mediaObjects: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

async function withIndexedBookmarks(
  fn: (dir: string) => Promise<void>,
  records: Record<string, unknown>[] = [bookmark()],
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-bookmark-analysis-'));
  const saved = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await writeJsonLines(path.join(dir, 'bookmarks.jsonl'), records);
    await writeJson(path.join(dir, 'bookmarks-meta.json'), {
      provider: 'twitter',
      schemaVersion: 1,
      totalBookmarks: records.length,
    });
    await buildIndex();
    await fn(dir);
  } finally {
    if (saved !== undefined) process.env.FT_DATA_DIR = saved;
    else delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

class FailingAnalysisProvider {
  readonly model: BookmarkAnalysisModelInfo = { provider: 'mock', model: 'flaky-analysis' };
  private readonly failedTweetIds: Set<string>;

  constructor(failedTweetIds: string[]) {
    this.failedTweetIds = new Set(failedTweetIds);
  }

  async classify(inputs: BookmarkAnalysisInput[]): Promise<BookmarkAnalysisDraft[]> {
    if (inputs.some((input) => this.failedTweetIds.has(input.tweetId))) {
      throw new Error('provider failed');
    }
    return inputs.map((input) => ({
      primaryCategory: 'ai',
      subcategory: 'agents',
      contentType: 'repo',
      tags: ['agent-memory'],
      summary: `Summary for ${input.tweetId}`,
      confidence: 0.8,
      rationale: 'Provider test rationale.',
      evidence: ['GitHub repository link detected.'],
    }));
  }
}

test('runBookmarkAnalysis classifies bookmarks into sidecar records without mutating source data', async () => {
  await withIndexedBookmarks(async () => {
    const progress: string[] = [];
    const result = await runBookmarkAnalysis({
      config: { provider: 'mock', model: 'mock', batchSize: 1 },
      now: () => new Date('2026-04-29T00:00:00Z'),
      onProgress: (entry) => progress.push(`${entry.completed}/${entry.total}`),
    });

    assert.equal(result.meta.sourceCount, 1);
    assert.equal(result.meta.analyzedCount, 1);
    assert.equal(result.meta.model.provider, 'mock');
    assert.deepEqual(progress, ['1/1']);

    const records = await readBookmarkAnalysisRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.contentType, 'repo');
    assert.ok(records[0]?.tags.includes('open-source'));
    assert.deepEqual(records[0]?.deterministicHints, ['content-type:repo', 'tag:open-source', 'domain:github.com']);

    const meta = await readBookmarkAnalysisMeta();
    assert.equal(meta?.schemaVersion, 1);
    assert.equal(meta?.source, 'bookmarks');
  });
});

test('runBookmarkAnalysis falls back to item retries and persists partial progress', async () => {
  await withIndexedBookmarks(async () => {
    const progress: Array<{ completed: number; total: number; failed: number }> = [];
    const result = await runBookmarkAnalysis({
      config: { provider: 'mock', model: 'mock', batchSize: 2 },
      provider: new FailingAnalysisProvider(['2']),
      batchSize: 2,
      now: () => new Date('2026-04-29T00:00:00Z'),
      onProgress: (entry) => progress.push({
        completed: entry.completed,
        total: entry.total,
        failed: entry.failed,
      }),
    });

    assert.equal(result.meta.sourceCount, 2);
    assert.equal(result.meta.analyzedCount, 1);
    assert.equal(result.meta.failedCount, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.tweetId, '1');
    assert.deepEqual(progress.at(-1), { completed: 2, total: 2, failed: 1 });

    const persisted = await readBookmarkAnalysisRecords();
    assert.deepEqual(persisted.map((record) => record.tweetId), ['1']);
    assert.equal((await readBookmarkAnalysisMeta())?.failedCount, 1);
  }, [
    bookmark({ id: '1', tweetId: '1', bookmarkedAt: '2026-04-03T00:00:00Z' }),
    bookmark({ id: '2', tweetId: '2', bookmarkedAt: '2026-04-02T00:00:00Z' }),
  ]);
});

test('runBookmarkAnalysis reruns idempotently and skips existing records', async () => {
  await withIndexedBookmarks(async () => {
    await runBookmarkAnalysis({
      config: { provider: 'mock', model: 'mock', batchSize: 2 },
      provider: new FailingAnalysisProvider(['2']),
      batchSize: 2,
      now: () => new Date('2026-04-29T00:00:00Z'),
    });

    const retry = await runBookmarkAnalysis({
      config: { provider: 'mock', model: 'mock', batchSize: 2 },
      provider: new FailingAnalysisProvider([]),
      batchSize: 2,
      now: () => new Date('2026-04-30T00:00:00Z'),
    });

    assert.equal(retry.skippedCount, 1);
    assert.equal(retry.meta.analyzedCount, 2);
    assert.equal(retry.meta.failedCount, 0);

    const persisted = await readBookmarkAnalysisRecords();
    assert.deepEqual(persisted.map((record) => record.tweetId).sort(), ['1', '2']);
  }, [
    bookmark({ id: '1', tweetId: '1', bookmarkedAt: '2026-04-03T00:00:00Z' }),
    bookmark({ id: '2', tweetId: '2', bookmarkedAt: '2026-04-02T00:00:00Z' }),
  ]);
});

test('runBookmarkAnalysis writes sane metadata for an empty archive', async () => {
  await withIndexedBookmarks(async () => {
    const result = await runBookmarkAnalysis({
      config: { provider: 'mock', model: 'mock', batchSize: 1 },
      now: () => new Date('2026-04-29T00:00:00Z'),
    });

    assert.equal(result.records.length, 0);
    assert.equal(result.meta.sourceCount, 0);
    assert.equal(result.meta.analyzedCount, 0);
    assert.equal(result.meta.failedCount, 0);
    assert.equal((await readBookmarkAnalysisMeta())?.analyzedCount, 0);
  }, []);
});
