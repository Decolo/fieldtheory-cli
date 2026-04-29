import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MockBookmarkCurationProvider,
  normalizeBookmarkCurationDraft,
  OpenAICompatibleBookmarkCurationProvider,
} from '../src/bookmark-curation-provider.js';
import type { BookmarkCurationInput } from '../src/bookmark-curation-provider.js';
import type { BookmarkAnalysisInput } from '../src/bookmark-analysis-input.js';
import type { BookmarkAnalysisRecord } from '../src/bookmark-analysis-types.js';

function input(overrides: Partial<BookmarkAnalysisInput> = {}): BookmarkAnalysisInput {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    text: 'A practical guide to agent evals with code.',
    authorHandle: 'alice',
    links: ['https://github.com/example/evals'],
    domains: ['github.com'],
    githubUrls: ['https://github.com/example/evals'],
    mediaCount: 0,
    linkCount: 1,
    deterministicHints: [{ kind: 'content-type', value: 'repo', reason: 'GitHub repository link detected.', confidence: 0.92 }],
    ...overrides,
  };
}

function analysis(overrides: Partial<BookmarkAnalysisRecord> = {}): BookmarkAnalysisRecord {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    sourceBookmarkId: '1',
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

function curationInput(overrides: Partial<BookmarkCurationInput> = {}): BookmarkCurationInput {
  return {
    input: input(),
    analysis: analysis(),
    ...overrides,
  };
}

test('mock curation provider keeps durable practice-oriented bookmarks', async () => {
  const provider = new MockBookmarkCurationProvider('mock-curator');
  const [result] = await provider.curate([curationInput()], 'keep practical AI implementation notes');

  assert.equal(provider.model.provider, 'mock');
  assert.equal(result?.decision, 'keep');
  assert.equal(result?.value, 5);
  assert.ok(result?.signals.includes('practice-oriented'));
});

test('normalizeBookmarkCurationDraft clamps invalid provider output', () => {
  const result = normalizeBookmarkCurationDraft({
    decision: 'delete',
    value: 99,
    freshness: 'ancient',
    confidence: 4,
    signals: ['Agent Evals', 'Agent Evals', 'Code', 'Repo', 'Useful', 'Practice', 'Overflow'],
  }, curationInput());

  assert.equal(result.decision, 'review');
  assert.equal(result.value, 5);
  assert.equal(result.freshness, 'unknown');
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.signals, ['agent-evals', 'code', 'repo', 'useful', 'practice', 'overflow']);
});

test('openai-compatible curation provider parses structured JSON response', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{
      message: {
        content: JSON.stringify({
          items: [{
            tweetId: '1',
            decision: 'keep',
            value: 5,
            freshness: 'fresh',
            confidence: 0.87,
            rationale: 'Concrete repo and implementation details match the profile.',
            signals: ['practice-oriented', 'repo'],
            evidence: ['practical guide to agent evals'],
          }],
        }),
      },
    }],
  }), { status: 200 }) as Promise<Response>;

  const provider = new OpenAICompatibleBookmarkCurationProvider({
    provider: 'openai-compatible',
    model: 'cheap-model',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    batchSize: 10,
  }, fetchImpl as typeof fetch);

  const [result] = await provider.curate([curationInput()], 'keep durable practices');
  assert.equal(result?.decision, 'keep');
  assert.equal(result?.freshness, 'fresh');
  assert.equal(result?.confidence, 0.87);
});

test('openai-compatible curation provider rejects malformed JSON envelopes', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({
    choices: [{ message: { content: JSON.stringify({ nope: [] }) } }],
  }), { status: 200 }) as Promise<Response>;

  const provider = new OpenAICompatibleBookmarkCurationProvider({
    provider: 'openai-compatible',
    model: 'cheap-model',
    baseUrl: 'https://example.test/v1',
    apiKey: 'key',
    batchSize: 10,
  }, fetchImpl as typeof fetch);

  await assert.rejects(
    () => provider.curate([curationInput()], 'keep durable practices'),
    /items array/,
  );
});
