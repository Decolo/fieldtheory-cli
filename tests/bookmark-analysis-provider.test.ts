import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  createBookmarkAnalysisProvider,
  normalizeBookmarkAnalysisDraft,
  OpenAICompatibleBookmarkAnalysisProvider,
} from '../src/bookmark-analysis-provider.js';
import { loadBookmarkAnalysisProviderConfig } from '../src/config.js';
import type { BookmarkAnalysisInput } from '../src/bookmark-analysis-input.js';

async function withIsolatedAnalysisEnv(fn: () => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-bookmark-analysis-provider-env-'));
  const saved = {
    dataDir: process.env.FT_DATA_DIR,
    provider: process.env.FT_BOOKMARK_ANALYSIS_PROVIDER,
    apiKey: process.env.FT_BOOKMARK_ANALYSIS_API_KEY,
    model: process.env.FT_BOOKMARK_ANALYSIS_MODEL,
    baseUrl: process.env.FT_BOOKMARK_ANALYSIS_BASE_URL,
    batchSize: process.env.FT_BOOKMARK_ANALYSIS_BATCH_SIZE,
  };
  try {
    process.env.FT_DATA_DIR = dir;
    delete process.env.FT_BOOKMARK_ANALYSIS_PROVIDER;
    delete process.env.FT_BOOKMARK_ANALYSIS_API_KEY;
    delete process.env.FT_BOOKMARK_ANALYSIS_MODEL;
    delete process.env.FT_BOOKMARK_ANALYSIS_BASE_URL;
    delete process.env.FT_BOOKMARK_ANALYSIS_BATCH_SIZE;
    await fn();
  } finally {
    if (saved.dataDir !== undefined) process.env.FT_DATA_DIR = saved.dataDir;
    else delete process.env.FT_DATA_DIR;
    if (saved.provider !== undefined) process.env.FT_BOOKMARK_ANALYSIS_PROVIDER = saved.provider;
    else delete process.env.FT_BOOKMARK_ANALYSIS_PROVIDER;
    if (saved.apiKey !== undefined) process.env.FT_BOOKMARK_ANALYSIS_API_KEY = saved.apiKey;
    else delete process.env.FT_BOOKMARK_ANALYSIS_API_KEY;
    if (saved.model !== undefined) process.env.FT_BOOKMARK_ANALYSIS_MODEL = saved.model;
    else delete process.env.FT_BOOKMARK_ANALYSIS_MODEL;
    if (saved.baseUrl !== undefined) process.env.FT_BOOKMARK_ANALYSIS_BASE_URL = saved.baseUrl;
    else delete process.env.FT_BOOKMARK_ANALYSIS_BASE_URL;
    if (saved.batchSize !== undefined) process.env.FT_BOOKMARK_ANALYSIS_BATCH_SIZE = saved.batchSize;
    else delete process.env.FT_BOOKMARK_ANALYSIS_BATCH_SIZE;
    await rm(dir, { recursive: true, force: true });
  }
}

function input(overrides: Partial<BookmarkAnalysisInput> = {}): BookmarkAnalysisInput {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    text: 'A GitHub repo for Claude Code agent memory',
    authorHandle: 'alice',
    links: ['https://github.com/example/agent-memory'],
    domains: ['github.com'],
    githubUrls: ['https://github.com/example/agent-memory'],
    mediaCount: 0,
    linkCount: 1,
    deterministicHints: [
      { kind: 'content-type', value: 'repo', reason: 'GitHub repository link detected.', confidence: 0.92 },
      { kind: 'tag', value: 'open-source', reason: 'GitHub repository link detected.', confidence: 0.7 },
    ],
    ...overrides,
  };
}

test('loadBookmarkAnalysisProviderConfig defaults to mock provider', async () => {
  await withIsolatedAnalysisEnv(() => {
    const config = loadBookmarkAnalysisProviderConfig({});
    assert.equal(config.provider, 'mock');
    assert.equal(config.model, 'mock-classifier');
  });
});

test('loadBookmarkAnalysisProviderConfig requires API key for real provider', async () => {
  await withIsolatedAnalysisEnv(() => {
    assert.throws(
      () => loadBookmarkAnalysisProviderConfig({
        FT_BOOKMARK_ANALYSIS_PROVIDER: 'openai-compatible',
        FT_BOOKMARK_ANALYSIS_API_KEY: '',
      }),
      /Missing bookmark analysis API key/,
    );
  });
});

test('loadBookmarkAnalysisProviderConfig merges dotenv values before explicit overrides', async () => {
  await withIsolatedAnalysisEnv(async () => {
    const dir = process.env.FT_DATA_DIR!;
    await writeFile(path.join(dir, '.env.local'), [
      'FT_BOOKMARK_ANALYSIS_PROVIDER=openai-compatible',
      'FT_BOOKMARK_ANALYSIS_API_KEY=dotenv-key',
      'FT_BOOKMARK_ANALYSIS_MODEL=dotenv-model',
      'FT_BOOKMARK_ANALYSIS_BASE_URL=https://example.test/v1/',
      'FT_BOOKMARK_ANALYSIS_BATCH_SIZE=7',
      '',
    ].join('\n'), 'utf8');

    const config = loadBookmarkAnalysisProviderConfig({
      FT_BOOKMARK_ANALYSIS_MODEL: 'override-model',
    });

    assert.equal(config.provider, 'openai-compatible');
    assert.equal(config.apiKey, 'dotenv-key');
    assert.equal(config.model, 'override-model');
    assert.equal(config.baseUrl, 'https://example.test/v1');
    assert.equal(config.batchSize, 7);
  });
});

test('mock provider classifies without network and preserves deterministic hints', async () => {
  const provider = createBookmarkAnalysisProvider({ provider: 'mock', model: 'mock', batchSize: 10 });
  const [result] = await provider.classify([input()]);

  assert.equal(provider.model.provider, 'mock');
  assert.equal(result?.contentType, 'repo');
  assert.ok(result?.tags.includes('open-source'));
  assert.ok(result?.summary);
});

test('normalizeBookmarkAnalysisDraft normalizes invalid provider output', () => {
  const result = normalizeBookmarkAnalysisDraft({
    primaryCategory: 'weird',
    contentType: 'strange',
    tags: ['Agent Memory', 'Agent Memory', 'Claude Code', 'Open Source', 'Extra', 'Another', 'Overflow'],
    confidence: 9,
  }, input());

  assert.equal(result.primaryCategory, 'other');
  assert.equal(result.contentType, 'other');
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.tags, ['agent-memory', 'claude-code', 'open-source', 'extra', 'another', 'overflow']);
});

test('openai-compatible provider parses structured JSON response', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          items: [{
            tweetId: '1',
            primaryCategory: 'ai',
            subcategory: 'agent-memory',
            contentType: 'repo',
            tags: ['agent-memory', 'claude-code'],
            summary: 'A repo about agent memory.',
            confidence: 0.88,
            rationale: 'The text and GitHub link mention agent memory.',
            evidence: ['GitHub repository link detected.'],
          }],
        }),
      },
    }],
  }), { status: 200 }) as Promise<Response>;

  const provider = new OpenAICompatibleBookmarkAnalysisProvider({
    provider: 'openai-compatible',
    model: 'cheap-model',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    batchSize: 10,
  }, fetchImpl as typeof fetch);

  const [result] = await provider.classify([input()]);
  assert.equal(result?.primaryCategory, 'ai');
  assert.equal(result?.contentType, 'repo');
  assert.equal(result?.confidence, 0.88);
});
