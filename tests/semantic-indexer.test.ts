import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readJson, writeJson } from '../src/fs.js';
import {
  formatSemanticStatus,
  getSemanticStatusView,
  rebuildSemanticIndex,
  semanticDocumentId,
  syncSemanticIndexForRun,
} from '../src/semantic-indexer.js';
import { SemanticStore } from '../src/semantic-store.js';
import type { SemanticMeta } from '../src/types.js';

const BOOKMARKS = [{
  id: 'bm-1',
  tweetId: 'bm-1',
  url: 'https://x.com/alice/status/bm-1',
  text: 'AI agents for code review and code search across repos',
  authorHandle: 'alice',
  authorName: 'Alice',
  postedAt: '2026-04-01T00:00:00Z',
  bookmarkedAt: '2026-04-02T00:00:00Z',
  syncedAt: '2026-04-02T00:00:00Z',
  links: ['https://blog.example.com/agents'],
  mediaObjects: [],
  tags: [],
  ingestedVia: 'graphql',
}];

const LIKES = [{
  id: 'lk-1',
  tweetId: 'lk-1',
  url: 'https://x.com/alice/status/lk-1',
  text: 'Practical AI agents and tooling for code review',
  authorHandle: 'alice',
  authorName: 'Alice',
  postedAt: '2026-04-03T00:00:00Z',
  likedAt: '2026-04-04T00:00:00Z',
  syncedAt: '2026-04-04T00:00:00Z',
  links: ['https://blog.example.com/practical-agents'],
  mediaObjects: [],
  tags: [],
  ingestedVia: 'graphql',
}];

const FEED = [{
  id: 'fd-1',
  tweetId: 'fd-1',
  url: 'https://x.com/alice/status/fd-1',
  text: 'Collaborative autonomous software engineering workflows are improving fast',
  authorHandle: 'alice',
  authorName: 'Alice',
  postedAt: '2026-04-12T00:00:00Z',
  syncedAt: '2026-04-12T00:00:00Z',
  sortIndex: '200',
  fetchPage: 1,
  fetchPosition: 0,
  links: ['https://blog.example.com/agents'],
  tags: [],
  ingestedVia: 'graphql',
  engagement: { likeCount: 120, bookmarkCount: 40 },
}];

async function withSemanticData(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-semantic-indexer-'));
  process.env.FT_DATA_DIR = dir;
  process.env.FT_EMBEDDING_API_KEY = 'test-key';
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = JSON.parse(String(init?.body ?? '{}'));
    const input = Array.isArray(parsed.input) ? parsed.input : [parsed.input];
    return new Response(JSON.stringify({
      data: input.map((text: string, index: number) => ({
        index,
        embedding: [text.length, index + 1, 1],
      })),
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    await writeFile(path.join(dir, 'bookmarks.jsonl'), BOOKMARKS.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(dir, 'likes.jsonl'), LIKES.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeFile(path.join(dir, 'feed.jsonl'), FEED.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await writeJson(path.join(dir, 'bookmarks-meta.json'), { provider: 'twitter', schemaVersion: 1, totalBookmarks: BOOKMARKS.length });
    await writeJson(path.join(dir, 'likes-meta.json'), { provider: 'twitter', schemaVersion: 1, totalLikes: LIKES.length });
    await writeJson(path.join(dir, 'feed-meta.json'), { provider: 'twitter', schemaVersion: 1, totalItems: FEED.length, totalSkippedEntries: 0 });
    await fn(dir);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.FT_DATA_DIR;
    delete process.env.FT_EMBEDDING_API_KEY;
    await rm(dir, { recursive: true, force: true });
  }
}

test('syncSemanticIndexForRun embeds likes, bookmarks, and feed items', async () => {
  await withSemanticData(async (dir) => {
    const meta = await syncSemanticIndexForRun(FEED as any);
    assert.equal(meta.documents.feed, 1);
    assert.equal(meta.documents.likes, 1);
    assert.equal(meta.documents.bookmarks, 1);

    const store = await SemanticStore.open(path.join(dir, 'semantic.lance'));
    try {
      const docs = await store.getDocumentsByIds([
        semanticDocumentId('feed', 'fd-1'),
        semanticDocumentId('likes', 'lk-1'),
        semanticDocumentId('bookmarks', 'bm-1'),
      ]);
      assert.equal(docs.size, 3);
    } finally {
      await store.close();
    }
  });
});

test('rebuildSemanticIndex writes semantic meta and status output', async () => {
  await withSemanticData(async (dir) => {
    const meta = await rebuildSemanticIndex();
    const savedMeta = await readJson<SemanticMeta>(path.join(dir, 'semantic-meta.json'));

    assert.equal(savedMeta.model, 'text-embedding-v4');
    assert.equal(savedMeta.dimensions, 3);
    assert.equal(Boolean(savedMeta.lastFullRebuildAt), true);
    assert.equal(meta.documents.feed, 1);

    const status = await getSemanticStatusView();
    const formatted = formatSemanticStatus(status);
    assert.match(formatted, /Feed Semantic/);
    assert.match(formatted, /configured: yes/);
    assert.match(formatted, /documents: feed=1 likes=1 bookmarks=1/);
  });
});
