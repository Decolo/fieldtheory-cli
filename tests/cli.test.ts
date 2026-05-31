import test from 'node:test';
import assert from 'node:assert/strict';
import { compareVersions, extractTweetId, runWithSpinner, buildCli } from '../src/cli.js';

test('compareVersions: equal versions return 0', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('compareVersions: newer patch returns positive', () => {
  assert.ok(compareVersions('1.2.4', '1.2.3') > 0);
});

test('compareVersions: older patch returns negative', () => {
  assert.ok(compareVersions('1.2.3', '1.2.4') < 0);
});

test('compareVersions: minor beats patch', () => {
  assert.ok(compareVersions('1.3.0', '1.2.9') > 0);
});

test('compareVersions: major beats minor', () => {
  assert.ok(compareVersions('2.0.0', '1.99.99') > 0);
});

test('compareVersions: handles double-digit segments', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
});

test('runWithSpinner: stops spinner after success', async () => {
  let stopped = 0;

  const result = await runWithSpinner(
    { stop: () => { stopped += 1; } },
    async () => 'ok',
  );

  assert.equal(result, 'ok');
  assert.equal(stopped, 1);
});

test('runWithSpinner: stops spinner after error', async () => {
  let stopped = 0;

  await assert.rejects(
    runWithSpinner(
      { stop: () => { stopped += 1; } },
      async () => {
        throw new Error('boom');
      },
    ),
    /boom/,
  );

  assert.equal(stopped, 1);
});

test('extractTweetId: accepts raw numeric ids', () => {
  assert.equal(extractTweetId('2049847048690938030'), '2049847048690938030');
});

test('extractTweetId: extracts ids from X status URLs', () => {
  assert.equal(
    extractTweetId('https://x.com/jukan05/status/2049847048690938030?s=20'),
    '2049847048690938030',
  );
});

test('extractTweetId: extracts ids from Twitter status URLs', () => {
  assert.equal(
    extractTweetId('https://twitter.com/jukan05/statuses/2049847048690938030'),
    '2049847048690938030',
  );
});

test('extractTweetId: rejects invalid inputs', () => {
  assert.throws(() => extractTweetId('https://x.com/jukan05'), /Invalid tweet id or URL/);
});

test('tweet search rejects invalid filter values', async () => {
  const cli = buildCli();
  const originalExitCode = process.exitCode;
  const originalError = console.error;
  const errors: string[] = [];
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    process.exitCode = 0;
    await cli.parseAsync(['node', 'ft', 'tweet', 'search', 'mlcc', '--filter', 'latest'], { from: 'node' });
    assert.equal(process.exitCode, 1);
    assert.match(errors.join('\n'), /Invalid tweet search filter/i);
  } finally {
    process.exitCode = originalExitCode;
    console.error = originalError;
  }
});
