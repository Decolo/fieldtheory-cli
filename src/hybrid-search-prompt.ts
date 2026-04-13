import type { HybridSearchMode, HybridSearchResult } from './search-types.js';

export function buildHybridExpansionPrompt(query: string): string {
  return [
    'Rewrite the user query into a few short search probes for a local SQLite FTS archive.',
    'Return only strict JSON in this shape: {"probes":["...", "..."]}',
    'Rules:',
    '- 2 to 4 probes only',
    '- each probe must be 2 to 5 words',
    '- prefer topic phrases and adjacent terms, not long sentences',
    '- do not include operators, quotes, markdown, or explanations',
    `Query: ${query}`,
  ].join('\n');
}

export function buildHybridSummaryPrompt(
  query: string,
  mode: HybridSearchMode,
  results: HybridSearchResult[],
): string {
  const items = results.slice(0, 8).map((item, index) => (
    `${index + 1}. [${item.sources.join('+')}] @${item.authorHandle ?? 'unknown'}\n${item.text}\n${item.url}`
  )).join('\n\n');

  return [
    'Summarize these local X archive search results for the user.',
    'Keep it concise: one short paragraph followed by 2 to 4 bullets.',
    'Do not invent facts beyond the provided results.',
    `Query: ${query}`,
    `Ranking mode: ${mode}`,
    '',
    items,
  ].join('\n');
}
