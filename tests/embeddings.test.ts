import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingProvider, EmbeddingConfigError, loadEmbeddingProviderConfig, probeEmbeddingProvider } from '../src/embeddings.js';

test('loadEmbeddingProviderConfig defaults to aliyun bailian config', () => {
  const config = loadEmbeddingProviderConfig({
    FT_EMBEDDING_API_KEY: 'test-key',
  });

  assert.equal(config.provider, 'aliyun-bailian');
  assert.equal(config.model, 'text-embedding-v4');
  assert.equal(config.baseUrl, 'https://dashscope.aliyuncs.com/compatible-mode/v1');
  assert.equal(config.apiKey, 'test-key');
});

test('loadEmbeddingProviderConfig accepts Bailian fallback env vars', () => {
  const config = loadEmbeddingProviderConfig({
    DASHSCOPE_API_KEY: 'dashscope-key',
    FT_EMBEDDING_MODEL: 'custom-model',
  });

  assert.equal(config.apiKey, 'dashscope-key');
  assert.equal(config.model, 'custom-model');
});

test('loadEmbeddingProviderConfig rejects missing API key', () => {
  assert.throws(
    () => loadEmbeddingProviderConfig({}),
    (error: unknown) => error instanceof EmbeddingConfigError && /Missing embedding API key/.test(error.message),
  );
});

test('createEmbeddingProvider sends OpenAI-compatible request and preserves order', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')),
    });
    return new Response(JSON.stringify({
      data: [
        { index: 1, embedding: [0.2, 0.8] },
        { index: 0, embedding: [1, 0] },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;

  try {
    const provider = createEmbeddingProvider(loadEmbeddingProviderConfig({
      FT_EMBEDDING_API_KEY: 'test-key',
      FT_EMBEDDING_BATCH_SIZE: '8',
    }));
    const vectors = await provider.embed(['alpha', 'beta']);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings');
    assert.deepEqual(calls[0].body, {
      model: 'text-embedding-v4',
      input: ['alpha', 'beta'],
    });
    assert.deepEqual(vectors, [[1, 0], [0.2, 0.8]]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('probeEmbeddingProvider returns embedding dimensions', async () => {
  const provider = {
    name: 'aliyun-bailian' as const,
    model: 'text-embedding-v4',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    async embed(): Promise<number[][]> {
      return [[1, 2, 3]];
    },
  };
  const result = await probeEmbeddingProvider(provider);
  assert.equal(result.dimensions, 3);
});
