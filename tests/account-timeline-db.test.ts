import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { buildAccountTimelineIndex, countAccountTimeline, getAccountTimelineById, listAccountTimeline } from '../src/account-timeline-db.js';
import { rememberAccountHandle } from '../src/account-registry.js';

const FIXTURES = [
  {
    id: '2',
    tweetId: '2',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    url: 'https://x.com/elonmusk/status/2',
    text: 'newer',
    authorHandle: 'elonmusk',
    authorName: 'Elon Musk',
    syncedAt: '2026-04-19T09:00:00Z',
    postedAt: '2026-04-19T08:00:00Z',
    links: [],
    tags: [],
    ingestedVia: 'graphql',
  },
  {
    id: '1',
    tweetId: '1',
    targetUserId: '44196397',
    targetHandle: 'elonmusk',
    url: 'https://x.com/elonmusk/status/1',
    text: 'older',
    authorHandle: 'elonmusk',
    authorName: 'Elon Musk',
    syncedAt: '2026-04-18T09:00:00Z',
    postedAt: '2026-04-18T08:00:00Z',
    links: [],
    tags: [],
    ingestedVia: 'graphql',
  },
];

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-db-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await rememberAccountHandle({ userId: '44196397', handle: '@elonmusk', name: 'Elon Musk' });
    await mkdir(path.join(dir, 'accounts', '44196397'), { recursive: true });
    await writeFile(path.join(dir, 'accounts', '44196397', 'timeline.jsonl'), FIXTURES.map((row) => JSON.stringify(row)).join('\n') + '\n');
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('buildAccountTimelineIndex and listAccountTimeline preserve chronology order', async () => {
  await withDataDir(async () => {
    const result = await buildAccountTimelineIndex('44196397');
    assert.equal(result.recordCount, 2);

    const rows = await listAccountTimeline('44196397', { limit: 10, offset: 0 });
    assert.deepEqual(rows.map((row) => row.id), ['2', '1']);
  });
});

test('countAccountTimeline and getAccountTimelineById read one account archive', async () => {
  await withDataDir(async () => {
    await buildAccountTimelineIndex('44196397');
    assert.equal(await countAccountTimeline('44196397'), 2);
    const row = await getAccountTimelineById('44196397', '2');
    assert.equal(row?.authorHandle, 'elonmusk');
  });
});
