import ClientTransaction from 'x-client-transaction-id';
import { DOMParser } from 'linkedom';
import { fetchXResource, xGraphqlOrigin, type XSessionAuth } from './x-graphql.js';

let cachedOrigin: string | null = null;
let cachedHtml: string | null = null;
let cachedTransaction: ClientTransaction | null = null;
let cacheExpiresAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

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

async function getClientTransaction(session: XSessionAuth): Promise<ClientTransaction> {
  const origin = xGraphqlOrigin();
  if (cachedTransaction && cachedHtml && cachedOrigin === origin && cacheExpiresAt > Date.now()) {
    return cachedTransaction;
  }

  const response = await fetchXResource(origin, {
    headers: buildHomeHeaders(session),
    redirect: 'follow',
  });
  const html = await response.text();
  const document = new DOMParser().parseFromString(html, 'text/html') as unknown as Document;
  const transaction = await ClientTransaction.create(document);

  cachedOrigin = origin;
  cachedHtml = html;
  cachedTransaction = transaction;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return transaction;
}

export async function resolveXClientTransactionId(
  session: XSessionAuth,
  operationPath: string,
): Promise<string | null> {
  if (process.env.FT_X_CLIENT_TRANSACTION_ID) return process.env.FT_X_CLIENT_TRANSACTION_ID;

  try {
    const transaction = await getClientTransaction(session);
    return await transaction.generateTransactionId('POST', operationPath);
  } catch {
    return null;
  }
}
