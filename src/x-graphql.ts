import { loadChromeSessionConfig } from './config.js';
import { extractChromeXCookies } from './chrome-cookies.js';
import { extractFirefoxXCookies } from './firefox-cookies.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36';

export const X_PUBLIC_BEARER =
  'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

export interface XSessionOptions {
  browser?: string;
  chromeUserDataDir?: string;
  chromeProfileDirectory?: string;
  firefoxProfileDir?: string;
  csrfToken?: string;
  cookieHeader?: string;
}

export interface XSessionAuth {
  csrfToken: string;
  cookieHeader?: string;
}

const execFileAsync = promisify(execFile);

export function xGraphqlOrigin(): string {
  return (process.env.FT_X_API_ORIGIN ?? 'https://x.com').replace(/\/+$/, '');
}

export function buildGraphqlUrl(queryId: string, operationName: string): string {
  return `${xGraphqlOrigin()}/i/api/graphql/${queryId}/${operationName}`;
}

export function buildXGraphqlHeaders(session: XSessionAuth): Record<string, string> {
  return {
    authorization: `Bearer ${X_PUBLIC_BEARER}`,
    'x-csrf-token': session.csrfToken,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'content-type': 'application/json',
    'user-agent': CHROME_UA,
    cookie: session.cookieHeader ?? `ct0=${session.csrfToken}`,
  };
}

function shouldFallbackToCurl(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const codes = [
    (error as any)?.code,
    (error as any)?.cause?.code,
    (error as any)?.errno,
    (error as any)?.cause?.errno,
  ].filter((value): value is string => typeof value === 'string');

  return codes.some((code) =>
    [
      'UND_ERR_CONNECT_TIMEOUT',
      'UND_ERR_CONNECT_ERROR',
      'ECONNRESET',
      'ECONNREFUSED',
      'ETIMEDOUT',
      'EHOSTUNREACH',
      'ENETUNREACH',
    ].includes(code),
  );
}

function parseCurlHeaders(raw: string): Headers {
  const normalized = raw.replace(/\r\n/g, '\n');
  const blocks = normalized
    .split('\n\n')
    .map((block) => block.trim())
    .filter((block) => block.startsWith('HTTP/'));
  const last = blocks[blocks.length - 1] ?? '';
  const headers = new Headers();
  for (const line of last.split('\n').slice(1)) {
    const idx = line.indexOf(':');
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    headers.append(key, value);
  }
  return headers;
}

async function fetchViaCurl(input: string, init?: RequestInit): Promise<Response> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), 'ft-x-curl-'));
  const headerPath = path.join(tmpDir, 'headers.txt');
  const bodyPath = path.join(tmpDir, 'body.txt');
  const method = init?.method ?? 'GET';
  const args = ['-sS', '-L', '-X', method, input, '-D', headerPath, '-o', bodyPath];

  try {
    for (const [key, value] of Object.entries(init?.headers as Record<string, string> ?? {})) {
      args.push('-H', `${key}: ${value}`);
    }
    if (init?.body != null) {
      const bodyFile = path.join(tmpDir, 'request-body.txt');
      await writeFile(bodyFile, String(init.body));
      args.push('--data-binary', `@${bodyFile}`);
    }

    await execFileAsync('curl', args, { maxBuffer: 10 * 1024 * 1024 });
    const headerRaw = await readFile(headerPath, 'utf8');
    const body = await readFile(bodyPath, 'utf8');
    const statusLine = headerRaw
      .replace(/\r\n/g, '\n')
      .split('\n')
      .filter((line) => line.startsWith('HTTP/'))
      .pop();
    const status = Number(statusLine?.split(/\s+/)[1] ?? 0) || 0;
    return new Response(body, {
      status,
      headers: parseCurlHeaders(headerRaw),
    });
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export async function fetchXResource(input: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (error) {
    if (!shouldFallbackToCurl(error)) throw error;
    return fetchViaCurl(input, init);
  }
}

export function resolveXSessionAuth(options: XSessionOptions = {}): XSessionAuth {
  if (options.csrfToken) {
    return {
      csrfToken: options.csrfToken,
      cookieHeader: options.cookieHeader,
    };
  }

  const config = loadChromeSessionConfig({ browserId: options.browser });
  if (config.browser.cookieBackend === 'firefox') {
    return extractFirefoxXCookies(options.firefoxProfileDir);
  }

  const chromeDir = options.chromeUserDataDir ?? config.chromeUserDataDir;
  const chromeProfile = options.chromeProfileDirectory ?? config.chromeProfileDirectory;
  return extractChromeXCookies(chromeDir, chromeProfile, config.browser);
}
