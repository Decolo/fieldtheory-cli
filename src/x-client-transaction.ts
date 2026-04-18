import ClientTransaction from 'x-client-transaction-id';
import { DOMParser } from 'linkedom';
import { fetchXResource, xGraphqlOrigin, type XSessionAuth } from './x-graphql.js';

let cachedOrigin: string | null = null;
let cachedHtml: string | null = null;
let cachedTransaction: ClientTransaction | null = null;
let cacheExpiresAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;
export const HOME_FETCH_TIMEOUT_MS = 30_000;
const HOME_FETCH_MAX_ATTEMPTS = 2;

interface ClientTransactionLike {
  generateTransactionId(method: string, path: string): Promise<string>;
}

interface ResolveXClientTransactionDeps {
  fetchHomeDocument?: (session: XSessionAuth, signal: AbortSignal) => Promise<Document>;
  createClientTransaction?: (document: Document) => Promise<ClientTransactionLike>;
}

export function resetXClientTransactionCache(): void {
  cachedOrigin = null;
  cachedHtml = null;
  cachedTransaction = null;
  cacheExpiresAt = 0;
}

function buildHomeHeaders(session: XSessionAuth): Record<string, string> {
  const origin = xGraphqlOrigin();
  return {
    accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'accept-language': 'en-US,en;q=0.9',
    referer: `${origin}/`,
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    cookie: session.cookieHeader ?? `ct0=${session.csrfToken}`,
  };
}

async function fetchHomeDocument(session: XSessionAuth, signal: AbortSignal): Promise<Document> {
  const origin = xGraphqlOrigin();
  const response = await fetchXResource(origin, {
    headers: buildHomeHeaders(session),
    redirect: 'follow',
    signal,
  });
  const html = await response.text();
  cachedOrigin = origin;
  cachedHtml = html;
  return new DOMParser().parseFromString(html, 'text/html') as unknown as Document;
}

async function getClientTransaction(
  session: XSessionAuth,
  deps: ResolveXClientTransactionDeps = {},
): Promise<ClientTransactionLike> {
  const origin = xGraphqlOrigin();
  if (cachedTransaction && cachedHtml && cachedOrigin === origin && cacheExpiresAt > Date.now()) {
    return cachedTransaction;
  }

  const loadDocument = deps.fetchHomeDocument ?? fetchHomeDocument;
  const createTransaction = deps.createClientTransaction ?? ((document: Document) => ClientTransaction.create(document));
  let lastError: unknown;

  for (let attempt = 0; attempt < HOME_FETCH_MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HOME_FETCH_TIMEOUT_MS);

    try {
      const document = await loadDocument(session, controller.signal);
      const transaction = await createTransaction(document);
      cachedTransaction = transaction as ClientTransaction;
      cacheExpiresAt = Date.now() + CACHE_TTL_MS;
      return transaction;
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError;
}

export async function resolveXClientTransactionId(
  session: XSessionAuth,
  operationPath: string,
  deps: ResolveXClientTransactionDeps = {},
): Promise<string | null> {
  if (process.env.FT_X_CLIENT_TRANSACTION_ID) return process.env.FT_X_CLIENT_TRANSACTION_ID;

  try {
    const transaction = await getClientTransaction(session, deps);
    return await transaction.generateTransactionId('POST', operationPath);
  } catch {
    return null;
  }
}
