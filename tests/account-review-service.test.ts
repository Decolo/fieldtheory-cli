import test from 'node:test';
import assert from 'node:assert/strict';
import { formatAccountReviewResults } from '../src/account-review-service.js';

test('formatAccountReviewResults prints conservative candidate summaries', () => {
  const text = formatAccountReviewResults([
    {
      targetUserId: '1',
      handle: 'alice',
      name: 'Alice',
      stage: 'stage2',
      disposition: 'candidate',
      primaryReason: 'inactive',
      score: 0.92,
      evidence: {
        inactivityDays: 100,
      },
      lastEvaluatedAt: '2026-04-19T00:00:00Z',
    },
  ]);

  assert.match(text, /^Review candidates/);
  assert.match(text, /@alice/);
  assert.match(text, /inactive \(100d\)/);
});
