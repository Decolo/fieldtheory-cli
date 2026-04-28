import test from 'node:test';
import assert from 'node:assert/strict';
import { repairLikes } from '../src/like-repair.js';

test('repairLikes delegates to the likes repair service', async () => {
  let receivedDelayMs: number | undefined;

  const result = await repairLikes(
    { delayMs: 123 },
    {
      syncGaps: async (options) => {
        receivedDelayMs = options?.delayMs;
        return {
          quotedTweetsFilled: 0,
          textExpanded: 0,
          likedAtMissing: 0,
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
