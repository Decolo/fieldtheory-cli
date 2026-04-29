import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { renderBookmarkAnalysisViz } from '../src/bookmark-analysis-viz.js';
import { mergeBookmarkAnalysisRecords } from '../src/bookmark-analysis-store.js';
import type { BookmarkAnalysisMeta, BookmarkAnalysisRecord } from '../src/bookmark-analysis-types.js';

function record(overrides: Partial<BookmarkAnalysisRecord> = {}): BookmarkAnalysisRecord {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    sourceBookmarkId: '1',
    authorHandle: 'alice',
    primaryCategory: 'ai',
    subcategory: 'agents',
    contentType: 'repo',
    tags: ['open-source', 'agents'],
    summary: 'A useful repo.',
    confidence: 0.8,
    rationale: 'GitHub repo.',
    evidence: ['GitHub repository link detected.'],
    deterministicHints: ['content-type:repo'],
    model: { provider: 'mock', model: 'mock' },
    classifiedAt: '2026-04-29T00:00:00Z',
    sourceUpdatedAt: '2026-04-29T00:00:00Z',
    ...overrides,
  };
}

function meta(overrides: Partial<BookmarkAnalysisMeta> = {}): BookmarkAnalysisMeta {
  return {
    schemaVersion: 1,
    generatedAt: '2026-04-29T00:00:00Z',
    source: 'bookmarks',
    sourceCount: 3,
    analyzedCount: 3,
    failedCount: 0,
    model: { provider: 'mock', model: 'mock' },
    ...overrides,
  };
}

async function withDataDir(fn: () => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-bookmark-analysis-viz-'));
  const saved = process.env.FT_DATA_DIR;
  process.env.FT_DATA_DIR = dir;
  try {
    await fn();
  } finally {
    if (saved !== undefined) process.env.FT_DATA_DIR = saved;
    else delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('renderBookmarkAnalysisViz prints static classification overview', async () => {
  await withDataDir(async () => {
    await mergeBookmarkAnalysisRecords([
      record(),
      record({ id: '2', tweetId: '2', primaryCategory: 'software-engineering', contentType: 'article', tags: ['typescript'] }),
      record({ id: '3', tweetId: '3', primaryCategory: 'ai', contentType: 'tool', tags: ['agents'] }),
    ], meta());

    const output = await renderBookmarkAnalysisViz({ limitTags: 3 });

    assert.match(output, /Bookmark Classification/);
    assert.match(output, /PRIMARY CATEGORIES/);
    assert.match(output, /CONTENT TYPES/);
    assert.match(output, /TOP TAGS/);
    assert.match(output, /CATEGORY x CONTENT TYPE/);
    assert.match(output, /ai/);
    assert.match(output, /repo/);
    assert.doesNotMatch(output, /interactive/i);
  });
});
