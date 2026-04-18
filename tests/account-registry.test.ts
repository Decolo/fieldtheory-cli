import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import {
  normalizeAccountHandle,
  readAccountRegistry,
  rememberAccountHandle,
  resolveTrackedAccount,
} from '../src/account-registry.js';

async function withDataDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'ft-account-registry-'));
  process.env.FT_DATA_DIR = dir;
  try {
    await fn(dir);
  } finally {
    delete process.env.FT_DATA_DIR;
    await rm(dir, { recursive: true, force: true });
  }
}

test('normalizeAccountHandle strips @ and lowercases', () => {
  assert.equal(normalizeAccountHandle('@ElonMusk'), 'elonmusk');
  assert.equal(normalizeAccountHandle(' ElonMusk '), 'elonmusk');
});

test('rememberAccountHandle stores a resolvable local mapping', async () => {
  await withDataDir(async () => {
    await rememberAccountHandle({ userId: '44196397', handle: '@ElonMusk', name: 'Elon Musk' });

    const registry = await readAccountRegistry();
    assert.equal(registry.byUserId['44196397']?.currentHandle, 'elonmusk');
    assert.equal(registry.byHandle['elonmusk'], '44196397');

    const resolved = await resolveTrackedAccount('@elonmusk');
    assert.equal(resolved?.userId, '44196397');
    assert.equal(resolved?.currentHandle, 'elonmusk');
  });
});

test('rememberAccountHandle updates handle aliases without losing stable user id', async () => {
  await withDataDir(async () => {
    await rememberAccountHandle({ userId: '1', handle: '@OldHandle', name: 'Test User' });
    await rememberAccountHandle({ userId: '1', handle: '@NewHandle', name: 'Test User' });

    const registry = await readAccountRegistry();
    assert.equal(registry.byHandle['oldhandle'], '1');
    assert.equal(registry.byHandle['newhandle'], '1');
    assert.equal(registry.byUserId['1']?.currentHandle, 'newhandle');
  });
});

test('rememberAccountHandle reassigns a reused handle to the new owner without leaving stale aliases behind', async () => {
  await withDataDir(async () => {
    await rememberAccountHandle({ userId: '1', handle: '@foo', name: 'First User' });
    await rememberAccountHandle({ userId: '1', handle: '@first_archive', name: 'First User' });
    await rememberAccountHandle({ userId: '2', handle: '@foo', name: 'Second User' });

    const registry = await readAccountRegistry();
    assert.equal(registry.byHandle['foo'], '2');
    assert.deepEqual(registry.byUserId['1']?.handles, ['first_archive']);
    assert.equal(registry.byUserId['1']?.currentHandle, 'first_archive');
    assert.deepEqual(registry.byUserId['2']?.handles, ['foo']);
  });
});
