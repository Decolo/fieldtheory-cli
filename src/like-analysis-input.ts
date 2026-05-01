import { listLikeProjections, type LikeProjectionItem } from './archive-projections.js';
import type { LikeContentType } from './like-analysis-types.js';

export interface LikeAnalysisInput {
  id: string;
  tweetId: string;
  url: string;
  text: string;
  authorHandle?: string;
  authorName?: string;
  postedAt?: string | null;
  likedAt?: string | null;
  links: string[];
  domains: string[];
  mediaCount: number;
  linkCount: number;
  deterministicHints: LikeAnalysisHint[];
}

export interface LikeAnalysisHint {
  kind: 'content-type' | 'tag' | 'domain' | 'structure';
  value: string;
  reason: string;
  confidence: number;
}

function domainFromUrl(value: string): string | undefined {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return undefined;
  }
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isGithubRepoUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.hostname.replace(/^www\./, '').toLowerCase() !== 'github.com') return false;
    const parts = url.pathname.split('/').filter(Boolean);
    return parts.length >= 2 && !['topics', 'trending', 'marketplace', 'features'].includes(parts[0]!.toLowerCase());
  } catch {
    return false;
  }
}

function hasAnyDomain(domains: string[], patterns: RegExp[]): boolean {
  return domains.some((domain) => patterns.some((pattern) => pattern.test(domain)));
}

function textLooksLikeThread(text: string): boolean {
  const normalized = text.toLowerCase();
  return /\b(thread|1\/\d+|\d+\/\d+|🧵)\b/u.test(normalized);
}

function textLooksLikeAnnouncement(text: string): boolean {
  return /\b(launch|launched|introducing|announce|released|shipping|new:)\b/i.test(text);
}

function textLooksLikeTutorial(text: string): boolean {
  return /\b(how to|guide|tutorial|walkthrough|step-by-step|learn how)\b/i.test(text);
}

function hint(
  kind: LikeAnalysisHint['kind'],
  value: string,
  reason: string,
  confidence: number,
): LikeAnalysisHint {
  return { kind, value, reason, confidence };
}

export function deriveLikeAnalysisHints(item: Pick<LikeProjectionItem, 'text' | 'links' | 'mediaCount'>): LikeAnalysisHint[] {
  const links = unique(item.links ?? []);
  const domains = unique(links.flatMap((link) => domainFromUrl(link) ?? []));
  const hints: LikeAnalysisHint[] = [];

  if (links.some(isGithubRepoUrl)) {
    hints.push(hint('content-type', 'repo', 'GitHub repository link detected.', 0.92));
    hints.push(hint('tag', 'open-source', 'GitHub repository link detected.', 0.7));
  }

  if (hasAnyDomain(domains, [/^arxiv\.org$/, /(^|\.)semanticscholar\.org$/, /(^|\.)aclanthology\.org$/, /(^|\.)openreview\.net$/])) {
    hints.push(hint('content-type', 'paper', 'Research paper domain detected.', 0.9));
    hints.push(hint('tag', 'research-paper', 'Research paper domain detected.', 0.75));
  }

  if (hasAnyDomain(domains, [/^youtube\.com$/, /^youtu\.be$/, /(^|\.)vimeo\.com$/, /(^|\.)loom\.com$/])) {
    hints.push(hint('content-type', 'demo', 'Video or demo domain detected.', 0.78));
  }

  if (hasAnyDomain(domains, [/^huggingface\.co$/, /(^|\.)kaggle\.com$/])) {
    hints.push(hint('content-type', 'dataset', 'Dataset/model hub domain detected.', 0.72));
  }

  if (textLooksLikeThread(item.text)) {
    hints.push(hint('content-type', 'thread', 'Thread-like text marker detected.', 0.7));
  }

  if (textLooksLikeAnnouncement(item.text)) {
    hints.push(hint('content-type', 'announcement', 'Launch or announcement language detected.', 0.62));
  }

  if (textLooksLikeTutorial(item.text)) {
    hints.push(hint('content-type', 'tutorial', 'How-to or tutorial language detected.', 0.67));
  }

  if (links.length > 0 && !hints.some((entry) => entry.kind === 'content-type')) {
    hints.push(hint('content-type', 'article', 'External link detected without a more specific type.', 0.45));
  }

  if ((item.mediaCount ?? 0) > 0) {
    hints.push(hint('structure', 'has-media', 'Like includes media.', 0.5));
  }

  for (const domain of domains.slice(0, 5)) {
    hints.push(hint('domain', domain, 'External link domain extracted from like.', 1));
  }

  return hints;
}

export function preferredContentTypeHint(hints: LikeAnalysisHint[]): LikeContentType | undefined {
  const contentHints = hints
    .filter((entry) => entry.kind === 'content-type')
    .sort((left, right) => right.confidence - left.confidence);
  return contentHints[0]?.value as LikeContentType | undefined;
}

export function buildLikeAnalysisInput(item: LikeProjectionItem): LikeAnalysisInput {
  const links = unique(item.links ?? []);
  const domains = unique(links.flatMap((link) => domainFromUrl(link) ?? []));
  const deterministicHints = deriveLikeAnalysisHints(item);

  return {
    id: item.id,
    tweetId: item.tweetId,
    url: item.url,
    text: item.text,
    authorHandle: item.authorHandle,
    authorName: item.authorName,
    postedAt: item.postedAt ?? null,
    likedAt: item.likedAt ?? null,
    links,
    domains,
    mediaCount: item.mediaCount ?? 0,
    linkCount: item.linkCount ?? links.length,
    deterministicHints,
  };
}

export async function listLikeAnalysisInputs(options: { limit?: number } = {}): Promise<LikeAnalysisInput[]> {
  const items = await listLikeProjections({
    limit: options.limit,
  });
  return items.map(buildLikeAnalysisInput);
}
