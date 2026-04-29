import { config as loadDotenv } from 'dotenv';
import path from 'node:path';
import os from 'node:os';
import { dataDir } from './paths.js';
import { getBrowser, browserUserDataDir, detectBrowser, listBrowserIds } from './browsers.js';
import type { BrowserDef } from './browsers.js';

export interface ChromeSessionConfig {
  chromeUserDataDir: string;
  chromeProfileDirectory: string;
  browser: BrowserDef;
}

export interface BookmarkAnalysisProviderConfig {
  provider: 'mock' | 'openai-compatible';
  model: string;
  baseUrl?: string;
  apiKey?: string;
  batchSize: number;
}

export function loadEnv(): void {
  const dir = dataDir();
  const candidatePaths = [
    path.join(process.cwd(), '.env.local'),
    path.join(process.cwd(), '.env'),
    path.join(dir, '.env.local'),
    path.join(dir, '.env'),
  ];

  for (const envPath of candidatePaths) {
    loadDotenv({ path: envPath, quiet: true });
  }
}

export function loadChromeSessionConfig(overrides: { browserId?: string } = {}): ChromeSessionConfig {
  loadEnv();

  // Resolve browser: CLI flag > FT_BROWSER env > auto-detect
  const browserId = overrides.browserId ?? process.env.FT_BROWSER;
  const browser = browserId ? getBrowser(browserId) : detectBrowser();

  // Resolve user-data dir: env override > registry path for the browser
  const dir = process.env.FT_CHROME_USER_DATA_DIR ?? browserUserDataDir(browser);
  if (!dir) {
    const supported = listBrowserIds().join(', ');
    throw new Error(
      `Could not detect a browser data directory for ${browser.displayName} on ${os.platform()}.\n` +
      `Set FT_CHROME_USER_DATA_DIR in .env, pass --chrome-user-data-dir, or try --browser <name>.\n` +
      `Supported browsers: ${supported}`
    );
  }

  const profileDirectory = process.env.FT_CHROME_PROFILE_DIRECTORY ?? 'Default';

  return { chromeUserDataDir: dir, chromeProfileDirectory: profileDirectory, browser };
}

export function loadBookmarkAnalysisProviderConfig(env: NodeJS.ProcessEnv = process.env): BookmarkAnalysisProviderConfig {
  loadEnv();
  const mergedEnv = env === process.env ? process.env : { ...process.env, ...env };
  const providerRaw = mergedEnv.FT_BOOKMARK_ANALYSIS_PROVIDER?.trim() || 'mock';
  if (providerRaw !== 'mock' && providerRaw !== 'openai-compatible') {
    throw new Error(`Unsupported bookmark analysis provider: "${providerRaw}". Use "mock" or "openai-compatible".`);
  }

  const provider = providerRaw;
  const batchSize = Math.max(1, Number(mergedEnv.FT_BOOKMARK_ANALYSIS_BATCH_SIZE ?? 20) || 20);

  if (provider === 'mock') {
    return {
      provider,
      model: mergedEnv.FT_BOOKMARK_ANALYSIS_MODEL?.trim() || 'mock-classifier',
      batchSize,
    };
  }

  const apiKey = mergedEnv.FT_BOOKMARK_ANALYSIS_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('Missing bookmark analysis API key. Set FT_BOOKMARK_ANALYSIS_API_KEY or use FT_BOOKMARK_ANALYSIS_PROVIDER=mock.');
  }

  return {
    provider,
    model: mergedEnv.FT_BOOKMARK_ANALYSIS_MODEL?.trim() || 'gpt-4o-mini',
    baseUrl: (mergedEnv.FT_BOOKMARK_ANALYSIS_BASE_URL?.trim() || 'https://api.openai.com/v1').replace(/\/+$/, ''),
    apiKey,
    batchSize,
  };
}
