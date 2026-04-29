import { readBookmarkAnalysisRecords, getBookmarkAnalysisStatus } from './bookmark-analysis-store.js';
import type { BookmarkAnalysisRecord } from './bookmark-analysis-types.js';

const ESC = '\x1b[';
const RESET = `${ESC}0m`;
const BOLD = `${ESC}1m`;
const DIM = `${ESC}2m`;

const rgb = (r: number, g: number, b: number) => `${ESC}38;2;${r};${g};${b}m`;

const C = {
  title: rgb(130, 170, 255),
  accent: rgb(120, 220, 170),
  warm: rgb(255, 180, 120),
  dim: rgb(100, 100, 120),
  text: rgb(200, 200, 210),
  gold: rgb(240, 200, 100),
  cyan: rgb(100, 220, 230),
  violet: rgb(170, 130, 255),
};

const BLOCKS = [' ', '▏', '▎', '▍', '▌', '▋', '▊', '▉', '█'];

interface CountEntry {
  name: string;
  count: number;
}

export interface BookmarkAnalysisVizOptions {
  limitTags?: number;
  width?: number;
}

function bar(value: number, max: number, width: number, color: string): string {
  const ratio = max > 0 ? value / max : 0;
  const filled = ratio * width;
  const full = Math.floor(filled);
  const partial = Math.round((filled - full) * 8);
  return (
    color +
    '█'.repeat(full) +
    (partial > 0 ? BLOCKS[partial] : '') +
    RESET +
    ' '.repeat(Math.max(0, width - full - (partial > 0 ? 1 : 0)))
  );
}

function countBy(records: BookmarkAnalysisRecord[], selector: (record: BookmarkAnalysisRecord) => string): CountEntry[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = selector(record);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return sortCounts(counts);
}

function tagCounts(records: BookmarkAnalysisRecord[]): CountEntry[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    for (const tag of record.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return sortCounts(counts);
}

function sortCounts(counts: Map<string, number>): CountEntry[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({ name, count }));
}

function section(title: string): string {
  return `\n${C.title}${BOLD}${title}${RESET}`;
}

function renderBars(entries: CountEntry[], options: { width: number; labelWidth: number; color: string; limit?: number }): string[] {
  const visible = entries.slice(0, options.limit ?? entries.length);
  const max = Math.max(...visible.map((entry) => entry.count), 1);
  return visible.map((entry) => {
    const label = entry.name.length > options.labelWidth
      ? `${entry.name.slice(0, options.labelWidth - 1)}…`
      : entry.name.padEnd(options.labelWidth);
    return `  ${C.text}${label}${RESET}  ${bar(entry.count, max, options.width, options.color)} ${C.gold}${entry.count}${RESET}`;
  });
}

function renderMatrix(records: BookmarkAnalysisRecord[], categories: CountEntry[], contentTypes: CountEntry[]): string[] {
  const visibleCategories = categories.slice(0, 8).map((entry) => entry.name);
  const visibleTypes = contentTypes.slice(0, 6).map((entry) => entry.name);
  if (visibleCategories.length === 0 || visibleTypes.length === 0) return ['  no classified bookmarks'];

  const labelWidth = Math.max(16, ...visibleCategories.map((category) => category.length));
  const typeWidth = Math.max(6, ...visibleTypes.map((type) => type.length));
  const rows: string[] = [];
  rows.push(`  ${' '.repeat(labelWidth)}  ${visibleTypes.map((type) => type.padStart(typeWidth)).join(' ')}`);
  for (const category of visibleCategories) {
    const cells = visibleTypes.map((type) => {
      const count = records.filter((record) => record.primaryCategory === category && record.contentType === type).length;
      return String(count || '.').padStart(typeWidth);
    });
    rows.push(`  ${C.text}${category.padEnd(labelWidth)}${RESET}  ${cells.join(' ')}`);
  }
  return rows;
}

function summarizeConfidence(records: BookmarkAnalysisRecord[]): string {
  if (records.length === 0) return 'n/a';
  const avg = records.reduce((sum, record) => sum + record.confidence, 0) / records.length;
  const low = records.filter((record) => record.confidence < 0.5).length;
  return `${avg.toFixed(2)} avg${low > 0 ? `, ${low} below 0.50` : ''}`;
}

export async function renderBookmarkAnalysisViz(options: BookmarkAnalysisVizOptions = {}): Promise<string> {
  const [records, status] = await Promise.all([
    readBookmarkAnalysisRecords(),
    getBookmarkAnalysisStatus(),
  ]);
  const width = options.width ?? 28;
  const categoryCounts = countBy(records, (record) => record.primaryCategory);
  const contentTypeCounts = countBy(records, (record) => record.contentType);
  const tags = tagCounts(records);
  const coverage = status.sourceCount > 0 ? Math.round((status.analyzedCount / status.sourceCount) * 100) : 0;

  const lines: string[] = [];
  lines.push(`${C.title}${BOLD}Bookmark Classification${RESET}`);
  lines.push(`${DIM}Generated from local sidecar analysis. Static terminal overview.${RESET}`);
  lines.push('');
  lines.push(`${C.accent}${BOLD}${status.analyzedCount}${RESET}/${status.sourceCount} classified  ${DIM}(${coverage}%)${RESET}`);
  lines.push(`${C.text}Model:${RESET} ${status.meta?.model.provider ?? '?'} / ${status.meta?.model.model ?? '?'}`);
  lines.push(`${C.text}Confidence:${RESET} ${summarizeConfidence(records)}`);

  lines.push(section('PRIMARY CATEGORIES'));
  lines.push(...renderBars(categoryCounts, { width, labelWidth: 22, color: C.accent }));

  lines.push(section('CONTENT TYPES'));
  lines.push(...renderBars(contentTypeCounts, { width, labelWidth: 22, color: C.cyan }));

  lines.push(section('TOP TAGS'));
  lines.push(...renderBars(tags, {
    width,
    labelWidth: 22,
    color: C.warm,
    limit: options.limitTags ?? 20,
  }));

  lines.push(section('CATEGORY x CONTENT TYPE'));
  lines.push(...renderMatrix(records, categoryCounts, contentTypeCounts));

  lines.push('');
  lines.push(`${DIM}Try: ft bookmarks classify list --category ${categoryCounts[0]?.name ?? 'ai'}`);
  lines.push(`     ft bookmarks classify list --content-type ${contentTypeCounts[0]?.name ?? 'repo'}`);
  lines.push(`     ft bookmarks classify list --tag ${tags[0]?.name ?? 'open-source'}${RESET}`);

  return lines.join('\n');
}
