import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOOKMARK_CONTENT_TYPES,
  BOOKMARK_PRIMARY_CATEGORIES,
  normalizeBookmarkAnalysisConfidence,
  normalizeBookmarkAnalysisEvidence,
  normalizeBookmarkAnalysisTags,
  normalizeBookmarkAnalysisText,
  normalizeBookmarkContentType,
  normalizeBookmarkPrimaryCategory,
} from '../src/bookmark-analysis-types.js';

test('bookmark analysis vocabularies include stable fallback values', () => {
  assert.ok(BOOKMARK_PRIMARY_CATEGORIES.includes('other'));
  assert.ok(BOOKMARK_CONTENT_TYPES.includes('other'));
});

test('normalizeBookmarkPrimaryCategory accepts known categories and falls back to other', () => {
  assert.equal(normalizeBookmarkPrimaryCategory('Software Engineering'), 'software-engineering');
  assert.equal(normalizeBookmarkPrimaryCategory('unexpected category'), 'other');
});

test('normalizeBookmarkContentType accepts known types and falls back to other', () => {
  assert.equal(normalizeBookmarkContentType('GitHub repo'), 'other');
  assert.equal(normalizeBookmarkContentType('repo'), 'repo');
  assert.equal(normalizeBookmarkContentType('unknown'), 'other');
});

test('normalizeBookmarkAnalysisTags produces short unique kebab-case tags', () => {
  assert.deepEqual(
    normalizeBookmarkAnalysisTags(['Agent Memory', 'agent_memory', 'AI!', '', 'x', 'Claude Code'], 3),
    ['agent-memory', 'ai', 'claude-code'],
  );
});

test('bookmark analysis normalizers clamp confidence and text evidence', () => {
  assert.equal(normalizeBookmarkAnalysisConfidence(2), 1);
  assert.equal(normalizeBookmarkAnalysisConfidence(-1), 0);
  assert.equal(normalizeBookmarkAnalysisConfidence('0.42'), 0.42);
  assert.equal(normalizeBookmarkAnalysisText('  hello   world  '), 'hello world');
  assert.deepEqual(normalizeBookmarkAnalysisEvidence([' a ', '', 'b', 'c', 'd'], 2), ['a', 'b']);
});
