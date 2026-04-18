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
