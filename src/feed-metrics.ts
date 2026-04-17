import { readFile } from 'node:fs/promises';
import { readJsonLines } from './fs.js';
import { twitterBookmarksCachePath, twitterFeedDaemonLogPath, twitterLikesCachePath } from './paths.js';
import type { BookmarkRecord, LikeRecord } from './types.js';

export interface FeedMetricWindow {
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface FeedMetricDay {
  date: string;
  attempts: number;
  successes: number;
  failures: number;
  successRate: number;
}

export interface FeedActionDay {
  date: string;
  likes: number;
  bookmarks: number;
}

export interface FeedMetricsSnapshot {
  generatedAt: string;
  feedCollection: {
    windows: {
      last24h: FeedMetricWindow;
      last7d: FeedMetricWindow;
    };
    daily: FeedMetricDay[];
    lastOutcome: {
      timestamp: string;
      outcome: 'success' | 'error';
      kind?: string;
      summary?: string;
    } | null;
  };
  actions: {
    totals: {
      likes: number;
      bookmarks: number;
    };
    daily: FeedActionDay[];
    latestLikeAt: string | null;
    latestBookmarkAt: string | null;
  };
}

interface ParsedDaemonLogLine {
  timestamp: string;
  fields: Record<string, string>;
}

function parseLogLine(line: string): ParsedDaemonLogLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const firstSpace = trimmed.indexOf(' ');
  if (firstSpace <= 0) return null;
  const timestamp = trimmed.slice(0, firstSpace);
  const rest = trimmed.slice(firstSpace + 1);
  const fields: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_]+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(rest)) != null) {
    const key = match[1]!;
    const rawValue = match[2]!;
    fields[key] = rawValue.startsWith('"') ? JSON.parse(rawValue) : rawValue;
  }
  return { timestamp, fields };
}

function isoDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  return new Date(parsed).toISOString().slice(0, 10);
}

function startOfUtcDayMs(timestampMs: number): number {
  const date = new Date(timestampMs);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function listUtcDates(days: number, nowMs: number): string[] {
  const lastDayStart = startOfUtcDayMs(nowMs);
  return Array.from({ length: days }, (_value, index) => {
    const dayMs = lastDayStart - (days - index - 1) * 86_400_000;
    return new Date(dayMs).toISOString().slice(0, 10);
  });
}

function buildWindow(entries: Array<{ timestampMs: number; outcome: 'success' | 'error' }>, cutoffMs: number): FeedMetricWindow {
  let attempts = 0;
  let successes = 0;
  let failures = 0;
  for (const entry of entries) {
    if (entry.timestampMs < cutoffMs) continue;
    attempts += 1;
    if (entry.outcome === 'success') successes += 1;
    else failures += 1;
  }
  return {
    attempts,
    successes,
    failures,
    successRate: attempts > 0 ? successes / attempts : 0,
  };
}

async function readDaemonEvents(): Promise<Array<{ timestamp: string; timestampMs: number; outcome: 'success' | 'error'; kind?: string; summary?: string }>> {
  let raw = '';
  try {
    raw = await readFile(twitterFeedDaemonLogPath(), 'utf8');
  } catch {
    raw = '';
  }

  const lines = raw.split('\n');
  const events: Array<{ timestamp: string; timestampMs: number; outcome: 'success' | 'error'; kind?: string; summary?: string }> = [];
  for (const line of lines) {
    const parsed = parseLogLine(line);
    if (!parsed) continue;
    if (parsed.fields.event !== 'fetch_ok' && parsed.fields.event !== 'fetch_error') continue;
    const timestampMs = Date.parse(parsed.timestamp);
    if (!Number.isFinite(timestampMs)) continue;
    events.push({
      timestamp: parsed.timestamp,
      timestampMs,
      outcome: parsed.fields.event === 'fetch_ok' ? 'success' : 'error',
      kind: parsed.fields.kind,
      summary: parsed.fields.summary,
    });
  }
  return events.sort((left, right) => left.timestampMs - right.timestampMs);
}

function buildDailyFeedMetrics(
  events: Array<{ timestampMs: number; outcome: 'success' | 'error' }>,
  days: number,
  nowMs: number,
): FeedMetricDay[] {
  const rows = new Map<string, FeedMetricDay>();
  for (const date of listUtcDates(days, nowMs)) {
    rows.set(date, {
      date,
      attempts: 0,
      successes: 0,
      failures: 0,
      successRate: 0,
    });
  }

  for (const event of events) {
    const date = isoDate(new Date(event.timestampMs).toISOString());
    if (!date) continue;
    const row = rows.get(date);
    if (!row) continue;
    row.attempts += 1;
    if (event.outcome === 'success') row.successes += 1;
    else row.failures += 1;
  }

  for (const row of rows.values()) {
    row.successRate = row.attempts > 0 ? row.successes / row.attempts : 0;
  }

  return Array.from(rows.values());
}

function buildDailyActionMetrics(likes: LikeRecord[], bookmarks: BookmarkRecord[], days: number, nowMs: number): FeedActionDay[] {
  const rows = new Map<string, FeedActionDay>();
  for (const date of listUtcDates(days, nowMs)) {
    rows.set(date, { date, likes: 0, bookmarks: 0 });
  }

  for (const record of likes) {
    const date = isoDate(record.likedAt ?? null);
    if (!date) continue;
    const row = rows.get(date);
    if (row) row.likes += 1;
  }

  for (const record of bookmarks) {
    const date = isoDate(record.bookmarkedAt ?? null);
    if (!date) continue;
    const row = rows.get(date);
    if (row) row.bookmarks += 1;
  }

  return Array.from(rows.values());
}

export async function getFeedMetricsSnapshot(): Promise<FeedMetricsSnapshot> {
  const now = new Date().toISOString();
  const nowMs = Date.parse(now);
  const [likes, bookmarks, daemonEvents] = await Promise.all([
    readJsonLines<LikeRecord>(twitterLikesCachePath()),
    readJsonLines<BookmarkRecord>(twitterBookmarksCachePath()),
    readDaemonEvents(),
  ]);

  const dailyWindowDays = 14;
  const lastOutcome = daemonEvents.length > 0
    ? daemonEvents[daemonEvents.length - 1]!
    : null;

  return {
    generatedAt: now,
    feedCollection: {
      windows: {
        last24h: buildWindow(daemonEvents, nowMs - 24 * 60 * 60 * 1000),
        last7d: buildWindow(daemonEvents, nowMs - 7 * 24 * 60 * 60 * 1000),
      },
      daily: buildDailyFeedMetrics(daemonEvents, dailyWindowDays, nowMs),
      lastOutcome: lastOutcome
        ? {
            timestamp: lastOutcome.timestamp,
            outcome: lastOutcome.outcome,
            kind: lastOutcome.kind,
            summary: lastOutcome.summary,
          }
        : null,
    },
    actions: {
      totals: {
        likes: likes.filter((record) => Boolean(record.likedAt)).length,
        bookmarks: bookmarks.filter((record) => Boolean(record.bookmarkedAt)).length,
      },
      daily: buildDailyActionMetrics(likes, bookmarks, dailyWindowDays, nowMs),
      latestLikeAt: likes
        .map((record) => record.likedAt ?? null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      latestBookmarkAt: bookmarks
        .map((record) => record.bookmarkedAt ?? null)
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    },
  };
}
