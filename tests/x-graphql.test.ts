import test from 'node:test';
import assert from 'node:assert/strict';
import { XRequestError, buildXGraphqlHeaders, sanitizeSensitiveText } from '../src/x-graphql.js';

test('sanitizeSensitiveText redacts X session secrets from command text', () => {
  const raw = [
    'curl -H authorization: Bearer secret-bearer-token',
    '-H x-csrf-token: csrf-secret-token',
    '-H cookie: ct0=csrf-secret-token; auth_token=auth-secret-token; lang=en',
    'https://x.com/test?auth_token=auth-secret-token&ct0=csrf-secret-token',
  ].join(' ');

  const sanitized = sanitizeSensitiveText(raw);
  assert.doesNotMatch(sanitized, /secret-bearer-token/);
  assert.doesNotMatch(sanitized, /csrf-secret-token/);
  assert.doesNotMatch(sanitized, /auth-secret-token/);
  assert.match(sanitized, /Bearer \[REDACTED\]/);
  assert.match(sanitized, /ct0=\[REDACTED\]/);
  assert.match(sanitized, /auth_token=\[REDACTED\]/);
});

test('XRequestError preserves typed metadata for daemon classification', () => {
  const error = new XRequestError('connection reset by peer', {
    kind: 'network',
    status: 0,
    fallbackUsed: true,
  });

  assert.equal(error.name, 'XRequestError');
  assert.equal(error.kind, 'network');
  assert.equal(error.status, 0);
  assert.equal(error.fallbackUsed, true);
  assert.equal(error.summary, 'connection reset by peer');
});

test('buildXGraphqlHeaders aligns baseline language and origin headers with web requests', () => {
  process.env.FT_X_API_ORIGIN = 'https://x.test';

  try {
    const headers = buildXGraphqlHeaders({
      csrfToken: 'ct0-token',
      cookieHeader: 'ct0=ct0-token; auth_token=auth',
    });

    assert.equal(headers['x-twitter-client-language'], 'en');
    assert.equal(headers.accept, '*/*');
    assert.equal(headers['accept-language'], 'en-US,en;q=0.9');
    assert.equal(headers.origin, 'https://x.test');
    assert.equal(headers.referer, 'https://x.test/home');
  } finally {
    delete process.env.FT_X_API_ORIGIN;
  }
});
