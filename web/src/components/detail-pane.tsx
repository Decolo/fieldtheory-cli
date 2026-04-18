import type {
  ArchiveItem,
  HybridSearchMode,
  HybridSearchResult,
  ViewSource,
} from '../types';

interface DetailPaneProps {
  source: ViewSource;
  item: ArchiveItem | HybridSearchResult | null;
  loading: boolean;
  error: string | null;
  mode?: HybridSearchMode;
  summary?: string | null;
}

function isHybridSearchResult(item: ArchiveItem | HybridSearchResult): item is HybridSearchResult {
  return Array.isArray((item as HybridSearchResult).sources);
}

function numericStat(
  item: ArchiveItem | HybridSearchResult,
  key: 'likeCount' | 'repostCount' | 'replyCount' | 'bookmarkCount',
): number | null {
  const value = (item as unknown as Record<string, unknown>)[key];
  return typeof value === 'number' ? value : null;
}

function itemLinks(item: ArchiveItem | HybridSearchResult): string[] {
  const value = (item as unknown as Record<string, unknown>).links;
  return Array.isArray(value) ? (value as string[]) : [];
}

function archiveSourceDetail(item: ArchiveItem): Array<{ source: ArchiveItem['source']; label: string }> {
  return item.sources.map((source) => ({
    source,
    label: `${source} ${item.sourceDates[source]?.slice(0, 10) ?? '?'}`,
  }));
}

function renderArchiveDateLabel(source: ArchiveItem['source'], item: ArchiveItem): string {
  const sourceDate = item.sourceDates[source]?.slice(0, 10) ?? '?';
  const postedAt = item.postedAt?.slice(0, 10) ?? '?';
  const label = source === 'bookmarks' ? 'Bookmarked' : source === 'likes' ? 'Liked' : 'Collected';
  return `${label} ${sourceDate} · posted ${postedAt}`;
}

function renderDateLabel(source: ViewSource, item: ArchiveItem | HybridSearchResult): string {
  if (source === 'search' && isHybridSearchResult(item)) {
    const result = item;
    return `Sources ${result.sources.join(' + ')} · posted ${result.postedAt?.slice(0, 10) ?? '?'}`;
  }
  if (source === 'dashboard') {
    return 'Operational metrics dashboard';
  }
  return renderArchiveDateLabel(source as ArchiveItem['source'], item as ArchiveItem);
}

export function DetailPane({ source, item, loading, error, mode, summary }: DetailPaneProps) {
  if (loading) {
    return <section className="detail-pane"><div className="empty-state">Loading detail…</div></section>;
  }

  if (error) {
    return <section className="detail-pane"><div className="empty-state">{error}</div></section>;
  }

  if (!item) {
    return <section className="detail-pane"><div className="empty-state">Select an item to inspect it.</div></section>;
  }

  const searchItem = source === 'search' && isHybridSearchResult(item) ? item : null;
  const archiveItem = source !== 'search' ? item as ArchiveItem : null;
  const likes = numericStat(item, 'likeCount');
  const reposts = numericStat(item, 'repostCount');
  const replies = numericStat(item, 'replyCount');
  const bookmarks = numericStat(item, 'bookmarkCount');
  const stats = [
    { label: 'Likes', value: likes },
    { label: 'Reposts', value: reposts },
    { label: 'Replies', value: replies },
    { label: 'Bookmarks', value: bookmarks },
  ].filter((entry) => entry.value != null);
  const links = itemLinks(item);

  return (
    <section className="detail-pane">
      <div className="detail-header">
        <div>
          <div className="eyebrow">
            {source === 'search' ? `Search result · ${mode ?? 'topic'}` : source === 'bookmarks' ? 'Bookmark' : source === 'likes' ? 'Like' : 'Feed'}
          </div>
          <h2>{item.authorName || item.authorHandle || 'Unknown author'}</h2>
          <p className="detail-date">{renderDateLabel(source, item)}</p>
        </div>
        <a href={item.url} target="_blank" rel="noreferrer">Open on X</a>
      </div>

      <article className="detail-body">
        <p>{item.text}</p>
      </article>

      {searchItem && summary ? (
        <div className="detail-groups">
          <h3>Summary</h3>
          <p>{summary}</p>
        </div>
      ) : null}

      {stats.length > 0 ? (
        <dl className="detail-stats">
          {stats.map((entry) => (
            <div key={entry.label}><dt>{entry.label}</dt><dd>{entry.value}</dd></div>
          ))}
        </dl>
      ) : null}

      {archiveItem ? (
        <div className="detail-groups">
          <div>
            <h3>Sources</h3>
            <div className="pill-row">
              {archiveItem.sources.map((value) => <span key={value} className="pill">{value}</span>)}
            </div>
          </div>
          <div>
            <h3>Source dates</h3>
            <div className="pill-row">
              {archiveSourceDetail(archiveItem).map((entry) => <span key={entry.source} className="pill">{entry.label}</span>)}
            </div>
          </div>
        </div>
      ) : null}

      {links.length > 0 ? (
        <div className="detail-groups">
          <h3>Links</h3>
          <div className="link-stack">
            {links.map((link) => (
              <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
