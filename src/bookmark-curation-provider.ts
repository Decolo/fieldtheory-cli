import type { BookmarkAnalysisInput } from './bookmark-analysis-input.js';
import type { BookmarkAnalysisRecord, BookmarkAnalysisModelInfo } from './bookmark-analysis-types.js';
import { loadBookmarkAnalysisProviderConfig, type BookmarkAnalysisProviderConfig } from './config.js';
import {
  normalizeBookmarkCurationConfidence,
  normalizeBookmarkCurationDecision,
  normalizeBookmarkCurationEvidence,
  normalizeBookmarkCurationFreshness,
  normalizeBookmarkCurationSignals,
  normalizeBookmarkCurationText,
  normalizeBookmarkCurationValue,
  type BookmarkCurationDraft,
} from './bookmark-curation-types.js';

export interface BookmarkCurationInput {
  input: BookmarkAnalysisInput;
  analysis: BookmarkAnalysisRecord;
}

export interface BookmarkCurationProvider {
  readonly model: BookmarkAnalysisModelInfo;
  curate(inputs: BookmarkCurationInput[], profile: string): Promise<BookmarkCurationDraft[]>;
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

export interface NormalizedBookmarkCurationDraft {
  decision: 'keep' | 'review' | 'remove';
  value: number;
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  confidence: number;
  rationale: string;
  signals: string[];
  evidence: string[];
}

export class BookmarkCurationProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BookmarkCurationProviderError';
  }
}

function hasMarketingLanguage(text: string): boolean {
  return /\b(launch|launched|introducing|announce|announcing|released|shipping|new:|excited|game[- ]?changer|revolutionary)\b/i.test(text);
}

function hasPracticeLanguage(text: string): boolean {
  return /\b(how to|guide|tutorial|walkthrough|architecture|implementation|production|case study|lessons|eval|evaluation|benchmark|code|repo|open source|github|debug|workflow)\b/i.test(text);
}

function fallbackDraft(item: BookmarkCurationInput): NormalizedBookmarkCurationDraft {
  const text = `${item.input.text} ${item.analysis.summary} ${item.analysis.tags.join(' ')}`;
  const isDurable = ['repo', 'tutorial', 'paper', 'article'].includes(item.analysis.contentType) || hasPracticeLanguage(text);
  const isMarketing = item.analysis.contentType === 'announcement' || hasMarketingLanguage(text);

  if (isDurable && !isMarketing) {
    return {
      decision: 'keep',
      value: item.analysis.primaryCategory === 'ai' ? 5 : 4,
      freshness: 'unknown',
      confidence: 0.6,
      rationale: 'Looks like durable, reusable practice-oriented material.',
      signals: ['practice-oriented', item.analysis.contentType],
      evidence: item.analysis.evidence.slice(0, 2),
    };
  }

  if (isMarketing && !hasPracticeLanguage(text)) {
    return {
      decision: 'remove',
      value: 2,
      freshness: 'aging',
      confidence: 0.58,
      rationale: 'Looks like announcement or marketing content with limited reusable detail.',
      signals: ['marketing-like', 'low-practice-signal'],
      evidence: item.analysis.evidence.slice(0, 2),
    };
  }

  return {
    decision: 'review',
    value: 3,
    freshness: 'unknown',
    confidence: 0.45,
    rationale: 'Value is ambiguous from available text and classification metadata.',
    signals: ['needs-human-review'],
    evidence: item.analysis.evidence.slice(0, 2),
  };
}

export function normalizeBookmarkCurationDraft(
  draft: BookmarkCurationDraft,
  item: BookmarkCurationInput,
): NormalizedBookmarkCurationDraft {
  const fallback = fallbackDraft(item);
  return {
    decision: normalizeBookmarkCurationDecision(draft.decision ?? fallback.decision),
    value: normalizeBookmarkCurationValue(draft.value ?? fallback.value),
    freshness: normalizeBookmarkCurationFreshness(draft.freshness ?? fallback.freshness),
    confidence: normalizeBookmarkCurationConfidence(draft.confidence ?? fallback.confidence),
    rationale: normalizeBookmarkCurationText(draft.rationale, fallback.rationale),
    signals: normalizeBookmarkCurationSignals(draft.signals?.length ? draft.signals : fallback.signals, 6),
    evidence: normalizeBookmarkCurationEvidence(draft.evidence?.length ? draft.evidence : fallback.evidence, 3),
  };
}

export class MockBookmarkCurationProvider implements BookmarkCurationProvider {
  readonly model: BookmarkAnalysisModelInfo;

  constructor(model = 'mock-curator') {
    this.model = { provider: 'mock', model };
  }

  async curate(inputs: BookmarkCurationInput[]): Promise<BookmarkCurationDraft[]> {
    return inputs.map(fallbackDraft);
  }
}

function buildPrompt(inputs: BookmarkCurationInput[], profile: string): string {
  const compactInputs = inputs.map((item) => ({
    tweetId: item.input.tweetId,
    url: item.input.url,
    authorHandle: item.input.authorHandle,
    text: item.input.text,
    postedAt: item.input.postedAt,
    bookmarkedAt: item.input.bookmarkedAt,
    domains: item.input.domains,
    links: item.input.links.slice(0, 5),
    analysis: {
      primaryCategory: item.analysis.primaryCategory,
      subcategory: item.analysis.subcategory,
      contentType: item.analysis.contentType,
      tags: item.analysis.tags,
      summary: item.analysis.summary,
      rationale: item.analysis.rationale,
    },
  }));

  return [
    'Curate saved X/Twitter bookmarks according to the user profile.',
    'Prefer keeping durable, reusable practices. Penalize marketing-heavy AI announcements, shallow launch posts, and stale release news.',
    'Decision meanings: keep = high-value enough to preserve, review = ambiguous and needs human check, remove = likely safe candidate to unbookmark later.',
    'Return only JSON with this shape: {"items":[{"tweetId":"...","decision":"keep|review|remove","value":1-5,"freshness":"fresh|aging|stale|unknown","confidence":0.0,"rationale":"short reason","signals":["kebab-case"],"evidence":["short evidence"]}]}',
    'Do not choose remove unless the bookmark is clearly low-signal, stale, marketing-like, duplicate-like, or not aligned with the profile. When unsure choose review.',
    `User profile:\n${profile}`,
    JSON.stringify({ bookmarks: compactInputs }),
  ].join('\n\n');
}

function parseProviderJson(text: string): Array<BookmarkCurationDraft & { tweetId?: string }> {
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new BookmarkCurationProviderError('Bookmark curation provider returned JSON without an items array.');
  }
  return (parsed as { items: Array<BookmarkCurationDraft & { tweetId?: string }> }).items;
}

export class OpenAICompatibleBookmarkCurationProvider implements BookmarkCurationProvider {
  readonly model: BookmarkAnalysisModelInfo;
  private readonly config: BookmarkAnalysisProviderConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: BookmarkAnalysisProviderConfig, fetchImpl: typeof fetch = fetch) {
    if (config.provider !== 'openai-compatible') {
      throw new BookmarkCurationProviderError('OpenAI-compatible provider requires openai-compatible config.');
    }
    this.config = config;
    this.fetchImpl = fetchImpl;
    this.model = {
      provider: 'openai-compatible',
      model: config.model,
      baseUrl: config.baseUrl,
    };
  }

  async curate(inputs: BookmarkCurationInput[], profile: string): Promise<BookmarkCurationDraft[]> {
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
            content: 'You are a precise personal knowledge-base curator. Return valid JSON only.',
          },
          {
            role: 'user',
            content: buildPrompt(inputs, profile),
          },
        ],
      }),
    });

    const json = await response.json().catch(() => ({})) as OpenAICompatibleResponse;
    if (!response.ok) {
      throw new BookmarkCurationProviderError(json.error?.message ?? `Bookmark curation request failed with status ${response.status}.`);
    }

    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new BookmarkCurationProviderError('Bookmark curation provider returned no message content.');
    }

    const byTweetId = new Map(parseProviderJson(content).map((item) => [String(item.tweetId ?? ''), item]));
    return inputs.map((input) => normalizeBookmarkCurationDraft(byTweetId.get(input.input.tweetId) ?? {}, input));
  }
}

export function createBookmarkCurationProvider(
  config: BookmarkAnalysisProviderConfig = loadBookmarkAnalysisProviderConfig(),
  fetchImpl: typeof fetch = fetch,
): BookmarkCurationProvider {
  if (config.provider === 'mock') return new MockBookmarkCurationProvider(config.model);
  return new OpenAICompatibleBookmarkCurationProvider(config, fetchImpl);
}
