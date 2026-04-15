import { loadPreferences, savePreferences } from './preferences.js';
import type {
  FeedPreferenceActionKind,
  FeedPreferenceBucket,
  FeedPreferenceDisposition,
  FeedPreferenceRule,
  FeedPreferenceTargetKind,
  FeedPreferences,
} from './types.js';

function emptyBucket(): FeedPreferenceBucket {
  return { prefer: [], avoid: [] };
}

export function defaultFeedPreferences(): FeedPreferences {
  return {
    like: emptyBucket(),
    bookmark: emptyBucket(),
  };
}

export function normalizePreferenceValue(kind: FeedPreferenceTargetKind, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Preference value cannot be empty.');
  if (kind === 'author') {
    return trimmed.startsWith('@') ? trimmed.slice(1).toLowerCase() : trimmed.toLowerCase();
  }
  if (kind === 'domain') {
    return trimmed.replace(/^https?:\/\//i, '').replace(/^www\./i, '').replace(/\/.*$/, '').toLowerCase();
  }
  return trimmed.toLowerCase().replace(/\s+/g, ' ');
}

export function loadFeedPreferences(): FeedPreferences {
  return loadPreferences().feedPreferences ?? defaultFeedPreferences();
}

export function saveFeedPreferences(feedPreferences: FeedPreferences): void {
  const prefs = loadPreferences();
  savePreferences({
    ...prefs,
    feedPreferences,
  });
}

export function addFeedPreference(
  action: FeedPreferenceActionKind,
  disposition: FeedPreferenceDisposition,
  kind: FeedPreferenceTargetKind,
  value: string,
): FeedPreferences {
  const normalized = normalizePreferenceValue(kind, value);
  const feedPreferences = loadFeedPreferences();
  const bucket = feedPreferences[action][disposition];
  if (!bucket.some((rule) => rule.kind === kind && rule.value === normalized)) {
    bucket.push({
      kind,
      value: normalized,
      createdAt: new Date().toISOString(),
    });
  }
  saveFeedPreferences(feedPreferences);
  return feedPreferences;
}

export function removeFeedPreference(
  action: FeedPreferenceActionKind,
  disposition: FeedPreferenceDisposition,
  kind: FeedPreferenceTargetKind,
  value: string,
): FeedPreferences {
  const normalized = normalizePreferenceValue(kind, value);
  const feedPreferences = loadFeedPreferences();
  feedPreferences[action][disposition] = feedPreferences[action][disposition]
    .filter((rule) => !(rule.kind === kind && rule.value === normalized));
  saveFeedPreferences(feedPreferences);
  return feedPreferences;
}

export function formatFeedPreferences(feedPreferences: FeedPreferences): string {
  const lines = ['Feed Preferences'];
  const render = (action: FeedPreferenceActionKind, disposition: FeedPreferenceDisposition, label: string): void => {
    const rules = feedPreferences[action][disposition];
    lines.push(`  ${label}: ${rules.length}`);
    for (const rule of rules) {
      const prefix = rule.kind === 'author' ? '@' : '';
      lines.push(`    - ${rule.kind}: ${prefix}${rule.value}`);
    }
  };

  render('like', 'prefer', 'like');
  render('like', 'avoid', 'avoid-like');
  render('bookmark', 'prefer', 'bookmark');
  render('bookmark', 'avoid', 'avoid-bookmark');
  return lines.join('\n');
}

export function listFeedPreferenceRules(
  feedPreferences: FeedPreferences,
  action: FeedPreferenceActionKind,
  disposition: FeedPreferenceDisposition,
  kind: FeedPreferenceTargetKind,
): FeedPreferenceRule[] {
  return feedPreferences[action][disposition].filter((rule) => rule.kind === kind);
}
