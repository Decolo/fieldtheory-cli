const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

export function parseTimestampMs(value?: string | null): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeDateInput(value: string, label = 'date'): string {
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    throw new Error(`Invalid ${label} date: "${value}". Use YYYY-MM-DD.`);
  }
  const parsed = Date.parse(`${normalized}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== normalized) {
    throw new Error(`Invalid ${label} date: "${value}". Use YYYY-MM-DD.`);
  }
  return normalized;
}

export function toIsoDate(value?: string | null): string | null {
  const ms = parseTimestampMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString().slice(0, 10);
}

export function toIsoMonth(value?: string | null): string | null {
  const ms = parseTimestampMs(value);
  if (ms == null) return null;
  return new Date(ms).toISOString().slice(0, 7);
}

export function toWeekdayShort(value?: string | null): string | null {
  const ms = parseTimestampMs(value);
  if (ms == null) return null;
  return WEEKDAYS[new Date(ms).getUTCDay()] ?? null;
}

export function toUtcHour(value?: string | null): number | null {
  const ms = parseTimestampMs(value);
  if (ms == null) return null;
  return new Date(ms).getUTCHours();
}

export function toYearLabel(value?: string | null): string {
  const ms = parseTimestampMs(value);
  if (ms == null) return value?.slice(-4) ?? '????';
  return new Date(ms).toISOString().slice(0, 4);
}

export function toMonthDayLabel(value?: string | null): string {
  const ms = parseTimestampMs(value);
  if (ms == null) return value?.slice(4, 10) ?? ' ?? ??';
  return new Date(ms).toLocaleDateString('en-US', {
    month: 'short',
    day: '2-digit',
    timeZone: 'UTC',
  });
}
