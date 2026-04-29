import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  getBookmarkAnalysisCategoryCounts,
  getBookmarkAnalysisRecord,
  listBookmarkAnalysisRecords,
  mergeBookmarkAnalysisRecords,
  readBookmarkAnalysisRecords,
} from '../src/bookmark-analysis-store.js';
import type { BookmarkAnalysisMeta, BookmarkAnalysisRecord } from '../src/bookmark-analysis-types.js';

function record(overrides: Partial<BookmarkAnalysisRecord> = {}): BookmarkAnalysisRecord {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    sourceBookmarkId: '1',
    authorHandle: 'alice',
    primaryCategory: 'ai',
    subcategory: 'agent-memory',
    contentType: 'repo',
    tags: ['agent-memory', 'open-source'],
    summary: 'A repo about agent memory.',
    confidence: 0.8,
    rationale: 'GitHub repo and agent text.',
    evidence: ['GitHub repository link detected.'],
    deterministicHints: ['content-type:repo'],
    model: { provider: 'mock', model: 'mock' },
    classifiedAt: '2026-04-29T00:00:00Z',
    sourceUpdatedAt: '2026-04-01T00:00:00Z',
    ...overrides,
  };
}

function meta(overrides: Partial<BookmarkAnalysisMeta> = {}): BookmarkAnalysisMeta {
  return {
    schemaVersion: 1,
    generatedAt: '2026-04-29T00:00:00Z',
    source: 'bookmarks',
    sourceCount: 2,
    analyzedCount: 1,
    failedCount: 0,
    model: { provider: 'mock', model: 'mock' },
    ...overrides,
  };
}

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-bookmark-analysis-store-'));
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

test('mergeBookmarkAnalysisRecords upserts by tweet id and supports filters', async () => {
  await withDataDir(async () => {
    await mergeBookmarkAnalysisRecords([record()], meta());
    await mergeBookmarkAnalysisRecords([
      record({ summary: 'Updated summary.', tags: ['updated'], sourceUpdatedAt: '2026-04-02T00:00:00Z' }),
      record({ id: '2', tweetId: '2', primaryCategory: 'software-engineering', contentType: 'article', tags: ['typescript'] }),
    ], meta({ sourceCount: 2 }));

    const records = await readBookmarkAnalysisRecords();
    assert.equal(records.length, 2);
    assert.equal(records.find((entry) => entry.tweetId === '1')?.summary, 'Updated summary.');

    const repos = await listBookmarkAnalysisRecords({ contentType: 'repo', tag: 'updated' });
    assert.equal(repos.length, 1);
    assert.equal(repos[0]?.tweetId, '1');

    const found = await getBookmarkAnalysisRecord('2');
    assert.equal(found?.primaryCategory, 'software-engineering');
  });
});

test('getBookmarkAnalysisCategoryCounts aggregates category, content type, and tags', async () => {
  await withDataDir(async () => {
    await mergeBookmarkAnalysisRecords([
      record(),
      record({ id: '2', tweetId: '2', contentType: 'article', tags: ['agent-memory'] }),
    ], meta({ sourceCount: 2 }));

    const counts = await getBookmarkAnalysisCategoryCounts();
    assert.equal(counts.primaryCategories.ai, 2);
    assert.equal(counts.contentTypes.repo, 1);
    assert.equal(counts.contentTypes.article, 1);
    assert.equal(counts.tags['agent-memory'], 2);
  });
});

test('readBookmarkAnalysisRecords reports corrupt JSONL lines', async () => {
  await withDataDir(async (dir) => {
    await writeFile(path.join(dir, 'bookmark-analysis.jsonl'), '{"tweetId":"1"}\nnot-json\n');

    await assert.rejects(
      () => readBookmarkAnalysisRecords(),
      /Invalid bookmark analysis JSONL at line 2/,
    );
  });
});
