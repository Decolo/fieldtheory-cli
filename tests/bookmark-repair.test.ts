import test from 'node:test';
import assert from 'node:assert/strict';
import { repairBookmarks } from '../src/bookmark-repair.js';

test('repairBookmarks delegates to the bookmark repair service', async () => {
  let receivedDelayMs: number | undefined;

  const result = await repairBookmarks(
    { delayMs: 123 },
    {
      syncGaps: async (options) => {
        receivedDelayMs = options?.delayMs;
        return {
          quotedTweetsFilled: 0,
          textExpanded: 0,
          bookmarkedAtRepaired: 0,
          bookmarkedAtMissing: 0,
          failed: 0,
          failures: [],
          total: 0,
        };
      },
    },
  );

  assert.equal(receivedDelayMs, 123);
  assert.equal(result.total, 0);
});
