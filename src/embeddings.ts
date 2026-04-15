import type { EmbeddingProviderName } from './types.js';

const DEFAULT_PROVIDER: EmbeddingProviderName = 'aliyun-bailian';
const DEFAULT_MODEL = 'text-embedding-v4';
const DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderName;
  model: string;
  baseUrl: string;
  apiKey: string;
  batchSize: number;
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly baseUrl: string;
  embed(texts: string[]): Promise<number[][]>;
}

interface EmbeddingApiResponse {
  data?: Array<{
    index?: number;
    embedding?: number[];
  }>;
  error?: {
    message?: string;
  };
}

export class EmbeddingConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EmbeddingConfigError';
  }
}

export class EmbeddingProviderError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = 'EmbeddingProviderError';
    this.status = status;
  }
}

export function loadEmbeddingProviderConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingProviderConfig {
  const provider = (env.FT_EMBEDDING_PROVIDER?.trim() || DEFAULT_PROVIDER) as EmbeddingProviderName;
  if (provider !== 'aliyun-bailian' && provider !== 'openai-compatible') {
    throw new EmbeddingConfigError(`Unsupported embedding provider: "${provider}".`);
  }

  const apiKey = env.FT_EMBEDDING_API_KEY
    || env.ALIBABA_BAILIAN_API_KEY
    || env.DASHSCOPE_API_KEY
    || '';
  if (!apiKey.trim()) {
    throw new EmbeddingConfigError(
      'Missing embedding API key. Set FT_EMBEDDING_API_KEY, ALIBABA_BAILIAN_API_KEY, or DASHSCOPE_API_KEY.',
    );
  }

  const model = env.FT_EMBEDDING_MODEL?.trim() || DEFAULT_MODEL;
  const baseUrl = (env.FT_EMBEDDING_BASE_URL?.trim() || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const batchSize = Math.max(1, Number(env.FT_EMBEDDING_BATCH_SIZE ?? 32) || 32);

  return {
    provider,
    model,
    baseUrl,
    apiKey,
    batchSize,
  };
}

class OpenAICompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly batchSize: number;

  constructor(config: EmbeddingProviderConfig) {
    this.name = config.provider;
    this.model = config.model;
    this.baseUrl = config.baseUrl;
    this.apiKey = config.apiKey;
    this.batchSize = config.batchSize;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batches: number[][] = [];
    for (let index = 0; index < texts.length; index += this.batchSize) {
      const chunk = texts.slice(index, index + this.batchSize);
      const response = await fetch(`${this.baseUrl}/embeddings`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          input: chunk.length === 1 ? chunk[0] : chunk,
        }),
      });

      const json = await response.json().catch(() => ({})) as EmbeddingApiResponse;
      if (!response.ok) {
        const message = typeof json?.error?.message === 'string'
          ? json.error.message
          : `Embedding request failed with status ${response.status}.`;
        throw new EmbeddingProviderError(message, response.status);
      }

      const data = Array.isArray(json.data) ? json.data : [];
      const vectors = data
        .sort((left: { index?: number }, right: { index?: number }) => Number(left.index ?? 0) - Number(right.index ?? 0))
        .map((entry: { embedding?: number[] }) => entry.embedding)
        .filter((embedding): embedding is number[] => Array.isArray(embedding));

      if (vectors.length !== chunk.length) {
        throw new EmbeddingProviderError(
          `Embedding provider returned ${vectors.length} vectors for ${chunk.length} inputs.`,
          response.status,
        );
      }

      batches.push(...vectors);
    }

    return batches;
  }
}

export function createEmbeddingProvider(config: EmbeddingProviderConfig = loadEmbeddingProviderConfig()): EmbeddingProvider {
  return new OpenAICompatibleEmbeddingProvider(config);
}

export async function probeEmbeddingProvider(
  provider: EmbeddingProvider = createEmbeddingProvider(),
  text = 'semantic health check',
): Promise<{ dimensions: number }> {
  const [vector] = await provider.embed([text]);
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new EmbeddingProviderError('Embedding provider returned an empty vector.');
  }
  return { dimensions: vector.length };
}
