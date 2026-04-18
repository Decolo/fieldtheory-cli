import test from 'node:test';
import assert from 'node:assert/strict';
import {
  HOME_FETCH_TIMEOUT_MS,
  resetXClientTransactionCache,
  resolveXClientTransactionId,
} from '../src/x-client-transaction.js';

const SESSION = {
  csrfToken: 'ct0-token',
  cookieHeader: 'ct0=ct0-token; auth_token=auth',
};

test('resolveXClientTransactionId retries a transient document load failure', async () => {
  resetXClientTransactionCache();
  let fetchAttempts = 0;
  let createAttempts = 0;

  const transactionId = await resolveXClientTransactionId(
    SESSION,
    '/i/api/graphql/aoDbu3RHznuiSkQ9aNM67Q/CreateBookmark',
    {
      fetchHomeDocument: async (_session, signal) => {
        assert.equal(signal.aborted, false);
        fetchAttempts += 1;
        if (fetchAttempts === 1) throw new Error('temporary fetch failure');
        return {} as Document;
      },
      createClientTransaction: async () => {
        createAttempts += 1;
        return {
          generateTransactionId: async () => 'txn-123',
        };
      },
    },
  );

  assert.equal(transactionId, 'txn-123');
  assert.equal(fetchAttempts, 2);
  assert.equal(createAttempts, 1);
});

test('resolveXClientTransactionId returns env override without loading the web shell', async () => {
  resetXClientTransactionCache();
  process.env.FT_X_CLIENT_TRANSACTION_ID = 'env-txn';

  try {
    const transactionId = await resolveXClientTransactionId(
      SESSION,
      '/i/api/graphql/aoDbu3RHznuiSkQ9aNM67Q/CreateBookmark',
      {
        fetchHomeDocument: async () => {
          throw new Error('should not fetch');
        },
      },
    );

    assert.equal(transactionId, 'env-txn');
  } finally {
    delete process.env.FT_X_CLIENT_TRANSACTION_ID;
  }
});

test('HOME_FETCH_TIMEOUT_MS allows slower real-world X shell loads', () => {
  assert.equal(HOME_FETCH_TIMEOUT_MS, 30_000);
});
