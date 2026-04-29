import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBookmarkAnalysisInput,
  deriveBookmarkAnalysisHints,
  preferredContentTypeHint,
} from '../src/bookmark-analysis-input.js';
import type { BookmarkProjectionItem } from '../src/archive-projections.js';

function fixture(overrides: Partial<BookmarkProjectionItem> = {}): BookmarkProjectionItem {
  return {
    id: '1',
    tweetId: '1',
    url: 'https://x.com/alice/status/1',
    text: 'A useful project for agent memory',
    authorHandle: 'alice',
    authorName: 'Alice',
    postedAt: '2026-04-01T00:00:00Z',
    bookmarkedAt: null,
    githubUrls: [],
    links: [],
    mediaCount: 0,
    linkCount: 0,
    ...overrides,
  };
}

test('buildBookmarkAnalysisInput preserves source identity and tolerates missing bookmarkedAt', () => {
  const input = buildBookmarkAnalysisInput(fixture({
    links: ['not a url', 'https://example.com/post'],
  }));

  assert.equal(input.tweetId, '1');
  assert.equal(input.url, 'https://x.com/alice/status/1');
  assert.equal(input.bookmarkedAt, null);
  assert.deepEqual(input.domains, ['example.com']);
});

test('deriveBookmarkAnalysisHints detects GitHub repository links', () => {
  const hints = deriveBookmarkAnalysisHints(fixture({
    githubUrls: ['https://github.com/example/agent-memory'],
  }));

  assert.equal(preferredContentTypeHint(hints), 'repo');
  assert.ok(hints.some((hint) => hint.kind === 'tag' && hint.value === 'open-source'));
});

test('deriveBookmarkAnalysisHints detects paper and demo domains', () => {
  const paperHints = deriveBookmarkAnalysisHints(fixture({
    links: ['https://arxiv.org/abs/2601.00001'],
  }));
  const demoHints = deriveBookmarkAnalysisHints(fixture({
    links: ['https://youtu.be/abc123'],
  }));

  assert.equal(preferredContentTypeHint(paperHints), 'paper');
  assert.equal(preferredContentTypeHint(demoHints), 'demo');
});

test('deriveBookmarkAnalysisHints detects text structure signals', () => {
  const threadHints = deriveBookmarkAnalysisHints(fixture({
    text: 'Thread: 1/7 things I learned about database tuning',
  }));
  const tutorialHints = deriveBookmarkAnalysisHints(fixture({
    text: 'A practical guide: how to evaluate LLM agents',
  }));

  assert.equal(preferredContentTypeHint(threadHints), 'thread');
  assert.equal(preferredContentTypeHint(tutorialHints), 'tutorial');
});

test('deriveBookmarkAnalysisHints falls back to article for generic links', () => {
  const hints = deriveBookmarkAnalysisHints(fixture({
    links: ['https://example.com/article'],
  }));

  assert.equal(preferredContentTypeHint(hints), 'article');
});
