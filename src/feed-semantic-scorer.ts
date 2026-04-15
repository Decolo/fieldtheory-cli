import { semanticDocumentId } from './semantic-indexer.js';
import { SemanticStore } from './semantic-store.js';
import type {
  FeedPreferenceActionKind,
  FeedPreferences,
  FeedRecord,
} from './types.js';

export interface ActionDecision {
  score: number;
  reasons: string[];
  blocked: boolean;
}

export interface ItemDecision {
  like: ActionDecision;
  bookmark: ActionDecision;
}

function clamp(value: number, min = 0, max = 1): number {
  return Math.max(min, Math.min(max, value));
}

function extractDomains(links: string[] | undefined): string[] {
  const domains = new Set<string>();
  for (const link of links ?? []) {
    try {
      const url = new URL(link);
      domains.add(url.hostname.replace(/^www\./, '').toLowerCase());
    } catch {}
  }
  return Array.from(domains);
}

function exactAuthorMatch(item: FeedRecord, value: string): boolean {
  return item.authorHandle?.toLowerCase() === value;
}

function exactDomainMatch(item: FeedRecord, value: string): boolean {
  return extractDomains(item.links).includes(value);
}

function bestSemanticReason(prefix: string, hits: Array<{ score: number; row: { normalizedText?: string; authorHandle?: string } }>): string | null {
  const best = hits[0];
  if (!best) return null;
  const label = best.row.normalizedText ?? best.row.authorHandle ?? 'match';
  return `${prefix}:${label}:${best.score.toFixed(2)}`;
}

function historyScore(hits: Array<{ score: number }>): number {
  if (hits.length === 0) return 0;
  const [first, second, third] = hits;
  return clamp(
    (first?.score ?? 0) * 0.8
      + (second?.score ?? 0) * 0.15
      + (third?.score ?? 0) * 0.05,
  );
}

async function scoreAction(
  store: SemanticStore,
  action: FeedPreferenceActionKind,
  explicitPreferences: FeedPreferences,
  item: FeedRecord,
): Promise<ActionDecision> {
  const reasons: string[] = [];
  const exact = explicitPreferences[action];
  for (const rule of exact.avoid) {
    if (rule.kind === 'author' && exactAuthorMatch(item, rule.value)) {
      reasons.push(`avoid-author:${rule.value}`);
      return { score: 0, reasons, blocked: true };
    }
    if (rule.kind === 'domain' && exactDomainMatch(item, rule.value)) {
      reasons.push(`avoid-domain:${rule.value}`);
      return { score: 0, reasons, blocked: true };
    }
  }

  const candidateId = semanticDocumentId('feed', item.tweetId);
  const candidate = (await store.getDocumentsByIds([candidateId])).get(candidateId);
  if (!candidate || candidate.vector.length === 0) {
    throw new Error(`Semantic vector missing for feed item ${item.tweetId}. Run feed semantic rebuild.`);
  }

  const avoidTopicHits = await store.searchPreferences(candidate.vector, action, 'avoid', 3);
  const avoidTopicScore = avoidTopicHits[0]?.score ?? 0;
  if (avoidTopicScore >= 0.68) {
    const reason = bestSemanticReason('avoid-topic-semantic', avoidTopicHits);
    if (reason) reasons.push(reason);
    return { score: 0, reasons, blocked: true };
  }

  let score = 0;
  for (const rule of exact.prefer) {
    if (rule.kind === 'author' && exactAuthorMatch(item, rule.value)) {
      score += 0.72;
      reasons.push(`prefer-author:${rule.value}`);
    }
    if (rule.kind === 'domain' && exactDomainMatch(item, rule.value)) {
      score += 0.58;
      reasons.push(`prefer-domain:${rule.value}`);
    }
  }

  const preferTopicHits = await store.searchPreferences(candidate.vector, action, 'prefer', 3);
  const preferTopicScore = preferTopicHits[0]?.score ?? 0;
  if (preferTopicScore > 0) {
    score += preferTopicScore * 0.75;
    const reason = bestSemanticReason('prefer-topic-semantic', preferTopicHits);
    if (reason) reasons.push(reason);
  }

  const historyHits = await store.searchDocuments(candidate.vector, action === 'like' ? 'likes' : 'bookmarks', 5);
  const history = historyScore(historyHits);
  if (history > 0) {
    score += history * 0.8;
    const reason = bestSemanticReason(
      action === 'like' ? 'history-like-nn' : 'history-bookmark-nn',
      historyHits,
    );
    if (reason) reasons.push(reason);
  }

  const engagementScore = clamp(((item.engagement?.likeCount ?? 0) + (item.engagement?.bookmarkCount ?? 0)) / 500) * 0.05;
  score += engagementScore;
  if (action === 'bookmark' && extractDomains(item.links).length > 0) score += 0.05;
  if (action === 'bookmark' && (item.text?.length ?? 0) > 180) score += 0.04;

  return {
    score: clamp(score),
    reasons,
    blocked: false,
  };
}

export async function scoreSemanticItem(
  store: SemanticStore,
  explicitPreferences: FeedPreferences,
  item: FeedRecord,
): Promise<ItemDecision> {
  return {
    like: await scoreAction(store, 'like', explicitPreferences, item),
    bookmark: await scoreAction(store, 'bookmark', explicitPreferences, item),
  };
}
