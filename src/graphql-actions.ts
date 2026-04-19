import {
  XRequestError,
  buildGraphqlUrl,
  buildXGraphqlHeaders,
  fetchXResource,
  resolveXSessionAuth,
  type XRequestErrorKind,
  type XSessionOptions,
} from './x-graphql.js';
import { resolveXClientTransactionId } from './x-client-transaction.js';

interface MutationSpec {
  queryId: string;
  operationName: string;
  responseKey: string;
  failureLabel: string;
}

interface GraphqlActionErrorPayload {
  code?: number;
  path?: string[];
}

export class RemoteTweetActionError extends Error {
  status?: number;
  kind?: XRequestErrorKind;
  attempts: number;
  retryable: boolean;

  constructor(
    message: string,
    options: { status?: number; kind?: XRequestErrorKind; attempts?: number; retryable?: boolean } = {},
  ) {
    super(message);
    this.name = 'RemoteTweetActionError';
    this.status = options.status;
    this.kind = options.kind;
    this.attempts = options.attempts ?? 1;
    this.retryable = options.retryable ?? false;
  }
}

export interface RemoteTweetActionResult {
  tweetId: string;
  operation: 'like' | 'unlike' | 'bookmark' | 'unbookmark';
  responseKey: string;
  attempts: number;
}

export interface RemoteFollowActionResult {
  targetUserId: string;
  operation: 'unfollow';
  responseKey: string;
  attempts: number;
}

const ACTION_RETRY_BACKOFF_MS = [1000, 3000] as const;

const UNLIKE_MUTATION: MutationSpec = {
  queryId: 'ZYKSe-w7KEslx3JhSIk5LA',
  operationName: 'UnfavoriteTweet',
  responseKey: 'unfavorite_tweet',
  failureLabel: 'Failed to unlike tweet',
};

const UNBOOKMARK_MUTATION: MutationSpec = {
  queryId: 'Wlmlj2-xzyS1GN3a6cj-mQ',
  operationName: 'DeleteBookmark',
  responseKey: 'tweet_bookmark_delete',
  failureLabel: 'Failed to delete bookmark',
};

const LIKE_MUTATION: MutationSpec = {
  queryId: 'lI07N6Otwv1PhnEgXILM7A',
  operationName: 'FavoriteTweet',
  responseKey: 'favorite_tweet',
  failureLabel: 'Failed to like tweet',
};

const BOOKMARK_MUTATION: MutationSpec = {
  queryId: 'aoDbu3RHznuiSkQ9aNM67Q',
  operationName: 'CreateBookmark',
  responseKey: 'tweet_bookmark_put',
  failureLabel: 'Failed to create bookmark',
};

const UNFOLLOW_MUTATION: MutationSpec = {
  queryId: process.env.FT_X_UNFOLLOW_QUERY_ID ?? 'vf4QO8QqZ8wZ-0Hj8Vd9pA',
  operationName: process.env.FT_X_UNFOLLOW_OPERATION ?? 'UnfollowUser',
  responseKey: 'unfollow_user',
  failureLabel: 'Failed to unfollow account',
};

function shouldRetryActionFailure(error: RemoteTweetActionError): boolean {
  if (error.retryable) return true;
  if (error.kind === 'network' || error.kind === 'rate_limit') return true;
  if (typeof error.status === 'number' && error.status >= 500) return true;
  return false;
}

function waitForRetry(attempt: number): Promise<void> {
  const ms = ACTION_RETRY_BACKOFF_MS[attempt] ?? 0;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyHttpStatus(status: number): XRequestErrorKind | undefined {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'upstream';
  return undefined;
}

function isAlreadyAppliedBookmarkResult(spec: MutationSpec, json: Record<string, any>): boolean {
  if (spec !== BOOKMARK_MUTATION) return false;
  const errors = Array.isArray(json?.errors) ? json.errors as GraphqlActionErrorPayload[] : [];
  return errors.some((error) =>
    error.code === 139
    && Array.isArray(error.path)
    && error.path.includes('tweet_bookmark_put'),
  );
}

function buildHttpActionError(
  spec: MutationSpec,
  status: number,
  responseText: string,
  attempts: number,
): RemoteTweetActionError {
  const retryable = status === 429 || status >= 500;
  const isBookmarkCreate404 = spec === BOOKMARK_MUTATION && status === 404;
  const kind = classifyHttpStatus(status);
  const attemptText = retryable ? ` after ${attempts} attempt${attempts === 1 ? '' : 's'}` : '';

  return new RemoteTweetActionError(
    `${spec.failureLabel} (${status})${attemptText}.\n` +
    `Response: ${responseText.slice(0, 300)}\n\n` +
    (status === 401 || status === 403
      ? 'Fix: Your X session may have expired. Open your browser, go to https://x.com, and make sure you are logged in. Then retry.'
      : isBookmarkCreate404
        ? 'X accepted the session but rejected the bookmark create route. This usually points to a web-client contract mismatch, such as missing client headers or a changed bookmark mutation path, not a temporary network issue.'
        : retryable
          ? 'This may be a temporary X issue. Try again in a few minutes.'
          : 'This request is not retryable. Check the response and retry manually if needed.'),
    { status, kind, attempts, retryable },
  );
}

function normalizeActionError(spec: MutationSpec, error: unknown, attempts: number): RemoteTweetActionError {
  if (error instanceof RemoteTweetActionError) {
    return new RemoteTweetActionError(error.message, {
      status: error.status,
      kind: error.kind,
      attempts: error.attempts ?? attempts,
      retryable: error.retryable,
    });
  }

  if (error instanceof XRequestError) {
    return new RemoteTweetActionError(
      `${spec.failureLabel} after ${attempts} attempt${attempts === 1 ? '' : 's'}.\n${error.summary}`,
      {
        status: error.status,
        kind: error.kind,
        attempts,
        retryable: error.kind === 'network' || error.kind === 'rate_limit' || (typeof error.status === 'number' && error.status >= 500),
      },
    );
  }

  return new RemoteTweetActionError(
    `${spec.failureLabel} after ${attempts} attempt${attempts === 1 ? '' : 's'}.\n${error instanceof Error ? error.message : String(error)}`,
    { attempts, retryable: false },
  );
}

function buildGraphqlHeadersForMutation(
  spec: MutationSpec,
  session: { csrfToken: string; cookieHeader?: string },
  tweetId: string,
): Record<string, string> {
  const headers = buildXGraphqlHeaders(session);
  if (spec === BOOKMARK_MUTATION) {
    headers.referer = `${new URL(buildGraphqlUrl(spec.queryId, spec.operationName)).origin}/i/web/status/${tweetId}`;
  }
  return headers;
}

async function runMutation(
  spec: MutationSpec,
  tweetId: string,
  options: XSessionOptions = {},
): Promise<RemoteTweetActionResult> {
  const session = resolveXSessionAuth(options);
  const headers = buildGraphqlHeadersForMutation(spec, session, tweetId);
  const operationPath = new URL(buildGraphqlUrl(spec.queryId, spec.operationName)).pathname;
  if (spec === BOOKMARK_MUTATION) {
    const transactionId = await resolveXClientTransactionId(session, operationPath);
    if (!transactionId) {
      throw new RemoteTweetActionError(
        'Failed to create bookmark before contacting X.\n' +
        'Could not generate x-client-transaction-id from the current X web app shell. Retry in a few seconds. If this keeps failing, your X session or the web contract may have changed.',
        { attempts: 1, retryable: true },
      );
    }
    headers['x-client-transaction-id'] = transactionId;
  }

  const request = {
    method: 'POST',
    headers,
    body: JSON.stringify({
      variables: { tweet_id: tweetId },
      queryId: spec.queryId,
    }),
  } satisfies RequestInit;

  let lastError: RemoteTweetActionError | undefined;

  for (let attempt = 0; attempt <= ACTION_RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetchXResource(buildGraphqlUrl(spec.queryId, spec.operationName), request);

      if (!response.ok) {
        const text = await response.text();
        lastError = buildHttpActionError(spec, response.status, text, attempt + 1);
        if (shouldRetryActionFailure(lastError) && attempt < ACTION_RETRY_BACKOFF_MS.length) {
          await waitForRetry(attempt);
          continue;
        }
        throw lastError;
      }

      const json = await response.json() as Record<string, any>;
      const successValue = json?.data?.[spec.responseKey]
        ?? json?.data?.tweetBookmarkPut
        ?? json?.data?.favoriteTweet;
      if (successValue !== 'Done' && !isAlreadyAppliedBookmarkResult(spec, json)) {
        throw new RemoteTweetActionError(
          `${spec.failureLabel} after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}.\n` +
          `Response: ${JSON.stringify(json).slice(0, 300)}`,
          { attempts: attempt + 1, retryable: false },
        );
      }

      return {
        tweetId,
        operation:
          spec === UNLIKE_MUTATION ? 'unlike'
          : spec === UNBOOKMARK_MUTATION ? 'unbookmark'
          : spec === LIKE_MUTATION ? 'like'
          : 'bookmark',
        responseKey: spec.responseKey,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = normalizeActionError(spec, error, attempt + 1);
      if (shouldRetryActionFailure(lastError) && attempt < ACTION_RETRY_BACKOFF_MS.length) {
        await waitForRetry(attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new RemoteTweetActionError(`${spec.failureLabel} after exhausting retries.`, {
    attempts: ACTION_RETRY_BACKOFF_MS.length + 1,
    retryable: true,
  });
}

export async function likeTweet(
  tweetId: string,
  options: XSessionOptions = {},
): Promise<RemoteTweetActionResult> {
  return runMutation(LIKE_MUTATION, tweetId, options);
}

export async function unlikeTweet(
  tweetId: string,
  options: XSessionOptions = {},
): Promise<RemoteTweetActionResult> {
  return runMutation(UNLIKE_MUTATION, tweetId, options);
}

export async function unbookmarkTweet(
  tweetId: string,
  options: XSessionOptions = {},
): Promise<RemoteTweetActionResult> {
  return runMutation(UNBOOKMARK_MUTATION, tweetId, options);
}

export async function bookmarkTweet(
  tweetId: string,
  options: XSessionOptions = {},
): Promise<RemoteTweetActionResult> {
  return runMutation(BOOKMARK_MUTATION, tweetId, options);
}

export async function unfollowAccount(
  targetUserId: string,
  options: XSessionOptions = {},
): Promise<RemoteFollowActionResult> {
  const session = resolveXSessionAuth(options);
  const request = {
    method: 'POST',
    headers: buildXGraphqlHeaders(session),
    body: JSON.stringify({
      variables: { user_id: targetUserId },
      queryId: UNFOLLOW_MUTATION.queryId,
    }),
  } satisfies RequestInit;

  let lastError: RemoteTweetActionError | undefined;

  for (let attempt = 0; attempt <= ACTION_RETRY_BACKOFF_MS.length; attempt += 1) {
    try {
      const response = await fetchXResource(buildGraphqlUrl(UNFOLLOW_MUTATION.queryId, UNFOLLOW_MUTATION.operationName), request);
      if (!response.ok) {
        const text = await response.text();
        lastError = buildHttpActionError(UNFOLLOW_MUTATION, response.status, text, attempt + 1);
        if (shouldRetryActionFailure(lastError) && attempt < ACTION_RETRY_BACKOFF_MS.length) {
          await waitForRetry(attempt);
          continue;
        }
        throw lastError;
      }

      const json = await response.json() as Record<string, any>;
      const successValue = json?.data?.[UNFOLLOW_MUTATION.responseKey]
        ?? json?.data?.unfollowUser
        ?? json?.data?.destroy_friendship;
      if (successValue !== 'Done' && successValue !== true) {
        throw new RemoteTweetActionError(
          `${UNFOLLOW_MUTATION.failureLabel} after ${attempt + 1} attempt${attempt === 0 ? '' : 's'}.\n` +
          `Response: ${JSON.stringify(json).slice(0, 300)}`,
          { attempts: attempt + 1, retryable: false },
        );
      }

      return {
        targetUserId,
        operation: 'unfollow',
        responseKey: UNFOLLOW_MUTATION.responseKey,
        attempts: attempt + 1,
      };
    } catch (error) {
      lastError = normalizeActionError(UNFOLLOW_MUTATION, error, attempt + 1);
      if (shouldRetryActionFailure(lastError) && attempt < ACTION_RETRY_BACKOFF_MS.length) {
        await waitForRetry(attempt);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new RemoteTweetActionError(`${UNFOLLOW_MUTATION.failureLabel} after exhausting retries.`, {
    attempts: ACTION_RETRY_BACKOFF_MS.length + 1,
    retryable: true,
  });
}
