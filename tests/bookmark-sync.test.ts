import test from 'node:test';
import assert from 'node:assert/strict';
import { syncBookmarks } from '../src/bookmark-sync.js';

test('syncBookmarks runs incremental GraphQL sync by default', async () => {
  let syncOptions: any;

  const result = await syncBookmarks(
    {
      delayMs: 600,
    },
    {
      syncGraphql: async (options) => {
        syncOptions = options;
        return {
          added: 2,
          bookmarkedAtRepaired: 1,
          totalBookmarks: 10,
          bookmarkedAtMissing: 0,
          pages: 3,
          stopReason: 'caught up to newest stored bookmark',
          cachePath: '/tmp/bookmarks.jsonl',
          statePath: '/tmp/bookmarks-backfill-state.json',
        };
      },
    },
  );

  assert.equal(syncOptions.incremental, true);
  assert.equal(syncOptions.delayMs, 600);
  assert.equal(result.source, 'graphql');
  assert.equal(result.added, 2);
});

test('syncBookmarks switches to full GraphQL sync for rebuild', async () => {
  let syncOptions: any;

  const result = await syncBookmarks(
    {
      rebuild: true,
      targetAdds: 5,
    },
    {
      syncGraphql: async (options) => {
        syncOptions = options;
        return {
          added: 5,
          bookmarkedAtRepaired: 0,
          totalBookmarks: 12,
          bookmarkedAtMissing: 0,
          pages: 8,
          stopReason: 'end of bookmarks',
          cachePath: '/tmp/bookmarks.jsonl',
          statePath: '/tmp/bookmarks-backfill-state.json',
        };
      },
    },
  );

  assert.equal(syncOptions.incremental, false);
  assert.equal(syncOptions.targetAdds, 5);
  assert.equal(result.source, 'graphql');
  assert.equal(result.totalBookmarks, 12);
});
