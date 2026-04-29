import {
  BOOKMARK_CONTENT_TYPES,
  BOOKMARK_PRIMARY_CATEGORIES,
  normalizeBookmarkAnalysisConfidence,
  normalizeBookmarkAnalysisEvidence,
  normalizeBookmarkAnalysisTags,
  normalizeBookmarkAnalysisText,
  normalizeBookmarkContentType,
  normalizeBookmarkPrimaryCategory,
  type BookmarkAnalysisDraft,
  type BookmarkAnalysisModelInfo,
  type BookmarkContentType,
  type BookmarkPrimaryCategory,
} from './bookmark-analysis-types.js';
import { preferredContentTypeHint, type BookmarkAnalysisInput } from './bookmark-analysis-input.js';
import { loadBookmarkAnalysisProviderConfig, type BookmarkAnalysisProviderConfig } from './config.js';

export interface BookmarkAnalysisProvider {
  readonly model: BookmarkAnalysisModelInfo;
  classify(inputs: BookmarkAnalysisInput[]): Promise<BookmarkAnalysisDraft[]>;
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

export class BookmarkAnalysisProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkAnalysisProviderError';
  }
}

export interface NormalizedBookmarkAnalysisDraft {
  primaryCategory: BookmarkPrimaryCategory;
  subcategory: string;
  contentType: BookmarkContentType;
  tags: string[];
  summary: string;
  confidence: number;
  rationale: string;
  evidence: string[];
}

function fallbackCategory(input: BookmarkAnalysisInput): string {
  const haystack = `${input.text} ${input.domains.join(' ')}`.toLowerCase();
  if (/\b(agent|llm|ai|model|prompt|claude|openai|anthropic)\b/.test(haystack)) return 'ai';
  if (/\b(code|developer|software|programming|typescript|javascript|python)\b/.test(haystack)) return 'software-engineering';
  if (/\b(database|infra|kubernetes|server|cloud|postgres|redis)\b/.test(haystack)) return 'infrastructure';
  if (/\b(security|auth|vulnerability|privacy)\b/.test(haystack)) return 'security';
  if (/\b(research|paper|arxiv|study)\b/.test(haystack)) return 'research';
  return 'other';
}

function fallbackTags(input: BookmarkAnalysisInput): string[] {
  const hints = input.deterministicHints
    .filter((entry) => entry.kind === 'tag')
    .map((entry) => entry.value);
  const domainTags = input.domains
    .slice(0, 2)
    .map((domain) => domain.split('.')[0])
    .filter(Boolean);
  return normalizeBookmarkAnalysisTags([...hints, ...domainTags, fallbackCategory(input)], 6);
}

function summarizeText(text: string): string {
  const normalized = normalizeBookmarkAnalysisText(text);
  if (normalized.length <= 180) return normalized;
  return `${normalized.slice(0, 177)}...`;
}

export function normalizeBookmarkAnalysisDraft(
  draft: BookmarkAnalysisDraft,
  input: BookmarkAnalysisInput,
): NormalizedBookmarkAnalysisDraft {
  const contentTypeHint = preferredContentTypeHint(input.deterministicHints);
  const primaryCategory = normalizeBookmarkPrimaryCategory(draft.primaryCategory ?? fallbackCategory(input));
  const contentType = normalizeBookmarkContentType(draft.contentType ?? contentTypeHint ?? 'other');
  const tags = normalizeBookmarkAnalysisTags(draft.tags?.length ? draft.tags : fallbackTags(input), 6);
  const summary = normalizeBookmarkAnalysisText(draft.summary, summarizeText(input.text));
  const rationale = normalizeBookmarkAnalysisText(
    draft.rationale,
    contentTypeHint
      ? `Used semantic content plus deterministic ${contentTypeHint} hint.`
      : 'Used semantic content and available bookmark metadata.',
  );

  return {
    primaryCategory,
    subcategory: normalizeBookmarkAnalysisText(draft.subcategory, primaryCategory),
    contentType,
    tags,
    summary,
    confidence: normalizeBookmarkAnalysisConfidence(draft.confidence ?? (contentTypeHint ? 0.65 : 0.45)),
    rationale,
    evidence: normalizeBookmarkAnalysisEvidence(
      draft.evidence?.length ? draft.evidence : input.deterministicHints.slice(0, 3).map((entry) => entry.reason),
      3,
    ),
  };
}

export class MockBookmarkAnalysisProvider implements BookmarkAnalysisProvider {
  readonly model: BookmarkAnalysisModelInfo;

  constructor(model = 'mock-classifier') {
    this.model = { provider: 'mock', model };
  }

  async classify(inputs: BookmarkAnalysisInput[]): Promise<BookmarkAnalysisDraft[]> {
    return inputs.map((input) => normalizeBookmarkAnalysisDraft({
      primaryCategory: fallbackCategory(input),
      subcategory: fallbackCategory(input),
      contentType: preferredContentTypeHint(input.deterministicHints) ?? 'other',
      tags: fallbackTags(input),
      summary: summarizeText(input.text),
      confidence: preferredContentTypeHint(input.deterministicHints) ? 0.65 : 0.45,
      rationale: 'Mock classification from deterministic bookmark hints.',
      evidence: input.deterministicHints.slice(0, 3).map((entry) => entry.reason),
    }, input));
  }
}

function buildPrompt(inputs: BookmarkAnalysisInput[]): string {
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
    'Classify each saved X/Twitter bookmark for browseable organization.',
    `Allowed primaryCategory values: ${BOOKMARK_PRIMARY_CATEGORIES.join(', ')}`,
    `Allowed contentType values: ${BOOKMARK_CONTENT_TYPES.join(', ')}`,
    'Return only JSON with this shape: {"items":[{"tweetId":"...","primaryCategory":"...","subcategory":"...","contentType":"...","tags":["kebab-case"],"summary":"one sentence","confidence":0.0,"rationale":"short reason","evidence":["short evidence"]}]}',
    'Use 3-6 specific kebab-case tags. Keep summaries and rationales concise.',
    JSON.stringify({ bookmarks: compactInputs }),
  ].join('\n\n');
}

function parseProviderJson(text: string): Array<BookmarkAnalysisDraft & { tweetId?: string }> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new BookmarkAnalysisProviderError('Bookmark analysis provider returned JSON without an items array.');
  }
  return (parsed as { items: Array<BookmarkAnalysisDraft & { tweetId?: string }> }).items;
}

export class OpenAICompatibleBookmarkAnalysisProvider implements BookmarkAnalysisProvider {
  readonly model: BookmarkAnalysisModelInfo;
  private readonly config: BookmarkAnalysisProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: BookmarkAnalysisProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (config.provider !== 'openai-compatible') {
      throw new BookmarkAnalysisProviderError('OpenAI-compatible provider requires openai-compatible config.');
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.model = {
      provider: 'openai-compatible',
      model: config.model,
      baseUrl: config.baseUrl,
    };
  }

  async classify(inputs: BookmarkAnalysisInput[]): Promise<BookmarkAnalysisDraft[]> {
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
      throw new BookmarkAnalysisProviderError(json.error?.message ?? `Bookmark analysis request failed with status ${response.status}.`);
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new BookmarkAnalysisProviderError('Bookmark analysis provider returned no message content.');
    }

    const byTweetId = new Map(parseProviderJson(content).map((item) => [String(item.tweetId ?? ''), item]));
    return inputs.map((input) => normalizeBookmarkAnalysisDraft(byTweetId.get(input.tweetId) ?? {}, input));
  }
}

export function createBookmarkAnalysisProvider(
  config: BookmarkAnalysisProviderConfig = loadBookmarkAnalysisProviderConfig(),
  fetchImpl: typeof fetch = fetch,
): BookmarkAnalysisProvider {
  if (config.provider === 'mock') return new MockBookmarkAnalysisProvider(config.model);
  return new OpenAICompatibleBookmarkAnalysisProvider(config, fetchImpl);
}
