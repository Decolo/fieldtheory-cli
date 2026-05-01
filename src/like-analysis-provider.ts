import {
  LIKE_CONTENT_TYPES,
  LIKE_PRIMARY_CATEGORIES,
  normalizeLikeAnalysisConfidence,
  normalizeLikeAnalysisEvidence,
  normalizeLikeAnalysisTags,
  normalizeLikeAnalysisText,
  normalizeLikeContentType,
  normalizeLikePrimaryCategory,
  type LikeAnalysisDraft,
  type LikeAnalysisModelInfo,
  type LikeContentType,
  type LikePrimaryCategory,
} from './like-analysis-types.js';
import { preferredContentTypeHint, type LikeAnalysisInput } from './like-analysis-input.js';
import { loadLikeAnalysisProviderConfig, type LikeAnalysisProviderConfig } from './config.js';

export interface LikeAnalysisProvider {
  readonly model: LikeAnalysisModelInfo;
  classify(inputs: LikeAnalysisInput[]): Promise<LikeAnalysisDraft[]>;
}

interface OpenAICompatibleResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
  };
}

export class LikeAnalysisProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LikeAnalysisProviderError';
  }
}

export interface NormalizedLikeAnalysisDraft {
  primaryCategory: LikePrimaryCategory;
  subcategory: string;
  contentType: LikeContentType;
  tags: string[];
  summary: string;
  confidence: number;
  rationale: string;
  evidence: string[];
}

function fallbackCategory(input: LikeAnalysisInput): string {
  const haystack = `${input.text} ${input.domains.join(' ')}`.toLowerCase();
  if (/\b(agent|llm|ai|model|prompt|claude|openai|anthropic)\b/.test(haystack)) return 'ai';
  if (/\b(code|developer|software|programming|typescript|javascript|python)\b/.test(haystack)) return 'software-engineering';
  if (/\b(database|infra|kubernetes|server|cloud|postgres|redis)\b/.test(haystack)) return 'infrastructure';
  if (/\b(security|auth|vulnerability|privacy)\b/.test(haystack)) return 'security';
  if (/\b(research|paper|arxiv|study)\b/.test(haystack)) return 'research';
  return 'other';
}

function fallbackTags(input: LikeAnalysisInput): string[] {
  const hints = input.deterministicHints
    .filter((entry) => entry.kind === 'tag')
    .map((entry) => entry.value);
  const domainTags = input.domains
    .slice(0, 2)
    .map((domain) => domain.split('.')[0])
    .filter(Boolean);
  return normalizeLikeAnalysisTags([...hints, ...domainTags, fallbackCategory(input)], 6);
}

function summarizeText(text: string): string {
  const normalized = normalizeLikeAnalysisText(text);
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

export function normalizeLikeAnalysisDraft(
  draft: LikeAnalysisDraft,
  input: LikeAnalysisInput,
): NormalizedLikeAnalysisDraft {
  const contentTypeHint = preferredContentTypeHint(input.deterministicHints);
  const primaryCategory = normalizeLikePrimaryCategory(draft.primaryCategory ?? fallbackCategory(input));
  const contentType = normalizeLikeContentType(draft.contentType ?? contentTypeHint ?? 'other');
  const tags = normalizeLikeAnalysisTags(draft.tags?.length ? draft.tags : fallbackTags(input), 6);
  const summary = normalizeLikeAnalysisText(draft.summary, summarizeText(input.text));
  const rationale = normalizeLikeAnalysisText(
    draft.rationale,
    contentTypeHint
      ? `Used semantic content plus deterministic ${contentTypeHint} hint.`
      : 'Used semantic content and available like metadata.',
  );

  return {
    primaryCategory,
    subcategory: normalizeLikeAnalysisText(draft.subcategory, primaryCategory),
    contentType,
    tags,
    summary,
    confidence: normalizeLikeAnalysisConfidence(draft.confidence ?? (contentTypeHint ? 0.65 : 0.45)),
    rationale,
    evidence: normalizeLikeAnalysisEvidence(
      draft.evidence?.length ? draft.evidence : input.deterministicHints.slice(0, 3).map((entry) => entry.reason),
      3,
    ),
  };
}

export class MockLikeAnalysisProvider implements LikeAnalysisProvider {
  readonly model: LikeAnalysisModelInfo;

  constructor(model = 'mock-classifier') {
    this.model = { provider: 'mock', model };
  }

  async classify(inputs: LikeAnalysisInput[]): Promise<LikeAnalysisDraft[]> {
    return inputs.map((input) => normalizeLikeAnalysisDraft({
      primaryCategory: fallbackCategory(input),
      subcategory: fallbackCategory(input),
      contentType: preferredContentTypeHint(input.deterministicHints) ?? 'other',
      tags: fallbackTags(input),
      summary: summarizeText(input.text),
      confidence: preferredContentTypeHint(input.deterministicHints) ? 0.65 : 0.45,
      rationale: 'Mock classification from deterministic like hints.',
      evidence: input.deterministicHints.slice(0, 3).map((entry) => entry.reason),
    }, input));
  }
}

function buildPrompt(inputs: LikeAnalysisInput[]): string {
  const compactInputs = inputs.map((input) => ({
    tweetId: input.tweetId,
    text: input.text,
    authorHandle: input.authorHandle,
    url: input.url,
    domains: input.domains,
    links: input.links.slice(0, 5),
    deterministicHints: input.deterministicHints.map((entry) => ({
      kind: entry.kind,
      value: entry.value,
      reason: entry.reason,
    })),
  }));

  return [
    'Classify each saved X/Twitter like for browseable organization.',
    `Allowed primaryCategory values: ${LIKE_PRIMARY_CATEGORIES.join(', ')}`,
    `Allowed contentType values: ${LIKE_CONTENT_TYPES.join(', ')}`,
    'Return only JSON with this shape: {"items":[{"tweetId":"...","primaryCategory":"...","subcategory":"...","contentType":"...","tags":["kebab-case"],"summary":"one sentence","confidence":0.0,"rationale":"short reason","evidence":["short evidence"]}]}',
    'Use 3-6 specific kebab-case tags. Keep summaries and rationales concise.',
    JSON.stringify({ likes: compactInputs }),
  ].join('\n\n');
}

function parseProviderJson(text: string): Array<LikeAnalysisDraft & { tweetId?: string }> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new LikeAnalysisProviderError('Like analysis provider returned JSON without an items array.');
  }
  return (parsed as { items: Array<LikeAnalysisDraft & { tweetId?: string }> }).items;
}

export class OpenAICompatibleLikeAnalysisProvider implements LikeAnalysisProvider {
  readonly model: LikeAnalysisModelInfo;
  private readonly config: LikeAnalysisProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: LikeAnalysisProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (config.provider !== 'openai-compatible') {
      throw new LikeAnalysisProviderError('OpenAI-compatible provider requires openai-compatible config.');
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.model = {
      provider: 'openai-compatible',
      model: config.model,
      baseUrl: config.baseUrl,
    };
  }

  async classify(inputs: LikeAnalysisInput[]): Promise<LikeAnalysisDraft[]> {
    if (inputs.length === 0) return [];
    const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are a precise content classifier. Return valid JSON only.',
          },
          {
            role: 'user',
            content: buildPrompt(inputs),
          },
        ],
      }),
    });

    const json = await response.json().catch(() => ({})) as OpenAICompatibleResponse;
    if (!response.ok) {
      throw new LikeAnalysisProviderError(json.error?.message ?? `Like analysis request failed with status ${response.status}.`);
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new LikeAnalysisProviderError('Like analysis provider returned no message content.');
    }

    const byTweetId = new Map(parseProviderJson(content).map((item) => [String(item.tweetId ?? ''), item]));
    return inputs.map((input) => normalizeLikeAnalysisDraft(byTweetId.get(input.tweetId) ?? {}, input));
  }
}

export function createLikeAnalysisProvider(
  config: LikeAnalysisProviderConfig = loadLikeAnalysisProviderConfig(),
  fetchImpl: typeof fetch = fetch,
): LikeAnalysisProvider {
  if (config.provider === 'mock') return new MockLikeAnalysisProvider(config.model);
  return new OpenAICompatibleLikeAnalysisProvider(config, fetchImpl);
}
