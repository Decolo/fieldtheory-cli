import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runBookmarkCuration } from '../src/bookmark-curation.js';
import { mergeBookmarkAnalysisRecords } from '../src/bookmark-analysis-store.js';
import { readBookmarkCurationMeta, readBookmarkCurationRecords } from '../src/bookmark-curation-store.js';
import { writeJson, writeJsonLines } from '../src/fs.js';
import { buildIndex } from '../src/bookmarks-db.js';
import type { BookmarkCurationDraft, BookmarkCurationRecord } from '../src/bookmark-curation-types.js';
import type { BookmarkCurationInput } from '../src/bookmark-curation-provider.js';
import type { BookmarkAnalysisMeta, BookmarkAnalysisModelInfo, BookmarkAnalysisRecord } from '../src/bookmark-analysis-types.js';

function bookmark(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const id = String(overrides.id ?? '1');
  return {
    id,
    tweetId: String(overrides.tweetId ?? id),
    url: `https://x.com/${String(overrides.authorHandle ?? 'alice')}/status/${String(overrides.tweetId ?? id)}`,
    text: 'A GitHub repo for practical agent evaluation.',
    authorHandle: 'alice',
    authorName: 'Alice',
    syncedAt: '2026-04-01T00:00:00Z',
    postedAt: '2026-04-01T00:00:00Z',
    bookmarkedAt: '2026-04-02T00:00:00Z',
    links: ['https://github.com/example/evals'],
    githubUrls: ['https://github.com/example/evals'],
    tags: [],
    mediaObjects: [],
    ingestedVia: 'graphql',
    ...overrides,
  };
}

function analysis(overrides: Partial<BookmarkAnalysisRecord> = {}): BookmarkAnalysisRecord {
  const tweetId = overrides.tweetId ?? '1';
  return {
    id: String(overrides.id ?? tweetId),
    tweetId,
    url: `https://x.com/alice/status/${tweetId}`,
    sourceBookmarkId: String(overrides.sourceBookmarkId ?? tweetId),
    authorHandle: 'alice',
    primaryCategory: 'ai',
    subcategory: 'agent-evals',
    contentType: 'repo',
    tags: ['agent-evals', 'open-source'],
    summary: 'A repo about practical agent evaluation.',
    confidence: 0.9,
    rationale: 'GitHub repo and evaluation text.',
    evidence: ['GitHub repository link detected.'],
    deterministicHints: ['content-type:repo'],
    model: { provider: 'mock', model: 'mock' },
    classifiedAt: '2026-04-29T00:00:00Z',
    sourceUpdatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function analysisMeta(overrides: Partial<BookmarkAnalysisMeta> = {}): BookmarkAnalysisMeta {
  return {
    schemaVersion: 1,
    generatedAt: '2026-04-29T00:00:00Z',
    source: 'bookmarks',
    sourceCount: 2,
    analyzedCount: 2,
    failedCount: 0,
    model: { provider: 'mock', model: 'mock' },
    ...overrides,
  };
}

async function withIndexedBookmarks(
  fn: (dir: string) => Promise<void>,
  records: Record<string, unknown>[] = [bookmark()],
): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-bookmark-curation-'));
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

class FailingCurationProvider {
  readonly model: BookmarkAnalysisModelInfo = { provider: 'mock', model: 'flaky-curator' };
  private readonly failedTweetIds: Set<string>;

  constructor(failedTweetIds: string[]) {
    this.failedTweetIds = new Set(failedTweetIds);
  }

  async curate(inputs: BookmarkCurationInput[]): Promise<BookmarkCurationDraft[]> {
    if (inputs.some((item) => this.failedTweetIds.has(item.input.tweetId))) {
      throw new Error('provider failed');
    }
    return inputs.map((item) => ({
      decision: item.analysis.contentType === 'repo' ? 'keep' : 'review',
      value: 5,
      freshness: 'fresh',
      confidence: 0.82,
      rationale: `Curated ${item.input.tweetId}`,
      signals: ['practice-oriented', item.analysis.contentType],
      evidence: item.analysis.evidence,
    }));
  }
}

test('runBookmarkCuration curates classified bookmarks into sidecar records', async () => {
  await withIndexedBookmarks(async () => {
    await mergeBookmarkAnalysisRecords([analysis()], analysisMeta({ sourceCount: 1, analyzedCount: 1 }));

    const result = await runBookmarkCuration({
      config: { provider: 'mock', model: 'mock', batchSize: 1 },
      now: () => new Date('2026-04-29T00:00:00Z'),
    });

    assert.equal(result.meta.sourceCount, 1);
    assert.equal(result.meta.curatedCount, 1);
    assert.equal(result.meta.model.provider, 'mock');
    assert.equal(result.usedDefaultProfile, true);

    const records = await readBookmarkCurationRecords();
    assert.equal(records.length, 1);
    assert.equal(records[0]?.decision, 'keep');
    assert.ok(records[0]?.signals.includes('practice-oriented'));
  });
});

test('runBookmarkCuration falls back to item retries and persists partial progress', async () => {
  await withIndexedBookmarks(async () => {
    await mergeBookmarkAnalysisRecords([
      analysis({ id: '1', tweetId: '1', sourceUpdatedAt: '2026-04-03T00:00:00Z' }),
      analysis({ id: '2', tweetId: '2', sourceUpdatedAt: '2026-04-02T00:00:00Z' }),
    ], analysisMeta());

    const progress: Array<{ completed: number; total: number; failed: number }> = [];
    const result = await runBookmarkCuration({
      config: { provider: 'mock', model: 'mock', batchSize: 2 },
      provider: new FailingCurationProvider(['2']),
      batchSize: 2,
      now: () => new Date('2026-04-29T00:00:00Z'),
      onProgress: (entry) => progress.push({
        completed: entry.completed,
        total: entry.total,
        failed: entry.failed,
      }),
    });

    assert.equal(result.meta.sourceCount, 2);
    assert.equal(result.meta.curatedCount, 1);
    assert.equal(result.meta.failedCount, 1);
    assert.equal(result.records.length, 1);
    assert.equal(result.records[0]?.tweetId, '1');
    assert.deepEqual(progress.at(-1), { completed: 2, total: 2, failed: 1 });

    const meta = await readBookmarkCurationMeta();
    assert.equal(meta?.failedCount, 1);
  }, [
    bookmark({ id: '1', tweetId: '1', bookmarkedAt: '2026-04-03T00:00:00Z' }),
    bookmark({ id: '2', tweetId: '2', bookmarkedAt: '2026-04-02T00:00:00Z' }),
  ]);
});

test('runBookmarkCuration skips existing records on rerun without duplicates', async () => {
  await withIndexedBookmarks(async () => {
    await mergeBookmarkAnalysisRecords([
      analysis({ id: '1', tweetId: '1', sourceUpdatedAt: '2026-04-03T00:00:00Z' }),
      analysis({ id: '2', tweetId: '2', sourceUpdatedAt: '2026-04-02T00:00:00Z' }),
    ], analysisMeta());

    await runBookmarkCuration({
      config: { provider: 'mock', model: 'mock', batchSize: 2 },
      provider: new FailingCurationProvider(['2']),
      batchSize: 2,
      now: () => new Date('2026-04-29T00:00:00Z'),
    });

    const retry = await runBookmarkCuration({
      config: { provider: 'mock', model: 'mock', batchSize: 2 },
      provider: new FailingCurationProvider([]),
      batchSize: 2,
      now: () => new Date('2026-04-30T00:00:00Z'),
    });

    assert.equal(retry.skippedCount, 1);
    assert.equal(retry.meta.curatedCount, 2);
    assert.equal(retry.meta.failedCount, 0);
    assert.deepEqual((await readBookmarkCurationRecords()).map((record: BookmarkCurationRecord) => record.tweetId).sort(), ['1', '2']);
  }, [
    bookmark({ id: '1', tweetId: '1', bookmarkedAt: '2026-04-03T00:00:00Z' }),
    bookmark({ id: '2', tweetId: '2', bookmarkedAt: '2026-04-02T00:00:00Z' }),
  ]);
});

test('runBookmarkCuration requires classification records for non-empty archives', async () => {
  await withIndexedBookmarks(async () => {
    await assert.rejects(
      () => runBookmarkCuration({
        config: { provider: 'mock', model: 'mock', batchSize: 1 },
      }),
      /Run `ft bookmarks classify`/,
    );
  });
});
