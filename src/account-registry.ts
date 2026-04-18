import { ensureDir, pathExists, readJson, writeJson } from './fs.js';
import { dataDir, twitterAccountsRegistryPath } from './paths.js';
import type { AccountRegistry } from './types.js';

const SCHEMA_VERSION = 1;

function emptyRegistry(): AccountRegistry {
  return {
    schemaVersion: SCHEMA_VERSION,
    byHandle: {},
    byUserId: {},
  };
}

export function normalizeAccountHandle(value: string): string {
  const normalized = String(value).trim().replace(/^@+/, '').toLowerCase();
  if (!normalized) throw new Error('Account handle is required.');
  return normalized;
}

export async function readAccountRegistry(): Promise<AccountRegistry> {
  const filePath = twitterAccountsRegistryPath();
  if (!(await pathExists(filePath))) return emptyRegistry();
  const registry = await readJson<AccountRegistry>(filePath);
  return {
    schemaVersion: registry.schemaVersion ?? SCHEMA_VERSION,
    byHandle: registry.byHandle ?? {},
    byUserId: registry.byUserId ?? {},
  };
}

async function writeAccountRegistry(registry: AccountRegistry): Promise<void> {
  await ensureDir(dataDir());
  await writeJson(twitterAccountsRegistryPath(), registry);
}

export async function rememberAccountHandle(input: { userId: string; handle: string; name?: string; lastSyncedAt?: string }): Promise<AccountRegistry> {
  const registry = await readAccountRegistry();
  const normalized = normalizeAccountHandle(input.handle);
  const previousOwnerUserId = registry.byHandle[normalized];
  if (previousOwnerUserId && previousOwnerUserId !== input.userId) {
    const previousOwner = registry.byUserId[previousOwnerUserId];
    if (previousOwner) {
      const remainingHandles = previousOwner.handles.filter((handle) => handle !== normalized);
      if (remainingHandles.length === 0) {
        delete registry.byUserId[previousOwnerUserId];
      } else {
        registry.byUserId[previousOwnerUserId] = {
          ...previousOwner,
          handles: remainingHandles,
          currentHandle: remainingHandles.includes(previousOwner.currentHandle) ? previousOwner.currentHandle : remainingHandles[0],
        };
      }
    }
  }
  const existing = registry.byUserId[input.userId];
  const handles = new Set<string>(existing?.handles ?? []);
  handles.add(normalized);

  registry.byUserId[input.userId] = {
    userId: input.userId,
    currentHandle: normalized,
    handles: Array.from(handles).sort(),
    name: input.name ?? existing?.name,
    lastSyncedAt: input.lastSyncedAt ?? existing?.lastSyncedAt,
  };

  if (previousOwnerUserId && previousOwnerUserId !== input.userId) delete registry.byHandle[normalized];
  for (const handle of handles) registry.byHandle[handle] = input.userId;
  await writeAccountRegistry(registry);
  return registry;
}

export async function resolveTrackedAccount(handle: string): Promise<{ userId: string; currentHandle: string; name?: string } | null> {
  const normalized = normalizeAccountHandle(handle);
  const registry = await readAccountRegistry();
  const userId = registry.byHandle[normalized];
  if (!userId) return null;
  const entry = registry.byUserId[userId];
  if (!entry) return null;
  return {
    userId,
    currentHandle: entry.currentHandle,
    name: entry.name,
  };
}
