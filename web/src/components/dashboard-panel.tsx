import type { FeedActionDay, FeedMetricDay, FeedMetricWindow, FeedMetricsResponse } from '../types';

interface DashboardPanelProps {
  metrics: FeedMetricsResponse | null;
  loading: boolean;
  error: string | null;
}

function formatRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatDate(value: string | null | undefined): string {
  return value ? value.slice(0, 10) : 'n/a';
}

function MetricCard(props: { label: string; value: string; note?: string }) {
  return (
    <article className="metric-card">
      <div className="eyebrow">{props.label}</div>
      <div className="metric-value">{props.value}</div>
      {props.note ? <div className="metric-note">{props.note}</div> : null}
    </article>
  );
}

function DailyFeedChart({ rows }: { rows: FeedMetricDay[] }) {
  const maxAttempts = Math.max(1, ...rows.map((row) => row.attempts));
  return (
    <div className="chart-panel">
      <div className="chart-header">
        <h3>Feed collection</h3>
        <span className="chart-caption">last 14 days</span>
      </div>
      <div className="chart-grid chart-grid-feed">
        {rows.map((row) => (
          <div key={row.date} className="chart-column">
            <div className="chart-stack">
              <div
                className="chart-bar chart-bar-success"
                style={{ height: `${(row.successes / maxAttempts) * 100}%` }}
                title={`${row.date}: ${row.successes}/${row.attempts} successful fetches`}
              />
              <div
                className="chart-bar chart-bar-failure"
                style={{ height: `${(row.failures / maxAttempts) * 100}%` }}
                title={`${row.date}: ${row.failures} failed fetches`}
              />
            </div>
            <div className="chart-rate">{formatRate(row.successRate)}</div>
            <div className="chart-label">{row.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DailyActionChart({ rows }: { rows: FeedActionDay[] }) {
  const maxValue = Math.max(1, ...rows.flatMap((row) => [row.likes, row.bookmarks]));
  return (
    <div className="chart-panel">
      <div className="chart-header">
        <h3>Daily actions</h3>
        <span className="chart-caption">likes vs bookmarks</span>
      </div>
      <div className="chart-grid chart-grid-actions">
        {rows.map((row) => (
          <div key={row.date} className="chart-column">
            <div className="chart-group">
              <div
                className="chart-bar chart-bar-like"
                style={{ height: `${(row.likes / maxValue) * 100}%` }}
                title={`${row.date}: ${row.likes} likes`}
              />
              <div
                className="chart-bar chart-bar-bookmark"
                style={{ height: `${(row.bookmarks / maxValue) * 100}%` }}
                title={`${row.date}: ${row.bookmarks} bookmarks`}
              />
            </div>
            <div className="chart-rate">{row.likes}/{row.bookmarks}</div>
            <div className="chart-label">{row.date.slice(5)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WindowCard({ label, window }: { label: string; window: FeedMetricWindow }) {
  return (
    <MetricCard
      label={label}
      value={formatRate(window.successRate)}
      note={`${window.successes} ok · ${window.failures} failed · ${window.attempts} attempts`}
    />
  );
}

export function DashboardPanel({ metrics, loading, error }: DashboardPanelProps) {
  if (loading) {
    return <section className="dashboard-panel"><div className="empty-state">Loading feed metrics…</div></section>;
  }

  if (error) {
    return <section className="dashboard-panel"><div className="empty-state">{error}</div></section>;
  }

  if (!metrics) {
    return <section className="dashboard-panel"><div className="empty-state">No feed metrics available yet.</div></section>;
  }

  return (
    <section className="dashboard-panel">
      <div className="dashboard-hero">
        <div>
          <div className="eyebrow">operations dashboard</div>
          <h2>Feed collection health and action volume</h2>
          <p className="dashboard-copy">
            Assess current daemon feed collection success, and inspect daily like/bookmark output from the local archive.
          </p>
        </div>
        <div className="dashboard-callout">
          <div className="eyebrow">last outcome</div>
          <div className={`dashboard-outcome is-${metrics.feedCollection.lastOutcome?.outcome ?? 'idle'}`}>
            {metrics.feedCollection.lastOutcome?.outcome ?? 'idle'}
          </div>
          <div className="metric-note">{metrics.feedCollection.lastOutcome?.summary ?? 'No daemon fetch outcome recorded yet.'}</div>
        </div>
      </div>

      <div className="metric-grid">
        <WindowCard label="Feed success · 24h" window={metrics.feedCollection.windows.last24h} />
        <WindowCard label="Feed success · 7d" window={metrics.feedCollection.windows.last7d} />
        <MetricCard
          label="Liked tweets"
          value={metrics.actions.totals.likes.toLocaleString()}
          note={`latest ${formatDate(metrics.actions.latestLikeAt)}`}
        />
        <MetricCard
          label="Bookmarked tweets"
          value={metrics.actions.totals.bookmarks.toLocaleString()}
          note={`latest ${formatDate(metrics.actions.latestBookmarkAt)}`}
        />
      </div>

      <div className="dashboard-charts">
        <DailyFeedChart rows={metrics.feedCollection.daily} />
        <DailyActionChart rows={metrics.actions.daily} />
      </div>
    </section>
  );
}
