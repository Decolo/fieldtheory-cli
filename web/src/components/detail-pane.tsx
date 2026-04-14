import type {
  ArchiveSource,
  BookmarkItem,
  HybridSearchMode,
  HybridSearchResult,
  LikeItem,
  ViewSource,
} from '../types';

interface DetailPaneProps {
  source: ViewSource;
  item: BookmarkItem | LikeItem | HybridSearchResult | null;
  loading: boolean;
  error: string | null;
  mode?: HybridSearchMode;
  summary?: string | null;
}

function isHybridSearchResult(item: BookmarkItem | LikeItem | HybridSearchResult): item is HybridSearchResult {
  return Array.isArray((item as HybridSearchResult).sources);
}

function isBookmarkItem(item: BookmarkItem | LikeItem | HybridSearchResult): item is BookmarkItem {
  return Array.isArray((item as BookmarkItem).categories) && Array.isArray((item as BookmarkItem).domains);
}

function renderDateLabel(source: ViewSource, item: BookmarkItem | LikeItem | HybridSearchResult): string {
  if (source === 'search' && isHybridSearchResult(item)) {
    const result = item;
    return `Sources ${result.sources.join(' + ')} · posted ${result.postedAt?.slice(0, 10) ?? '?'}`;
  }
  if (source === 'bookmarks' && isBookmarkItem(item)) {
    const bookmark = item;
    return `Bookmarked ${bookmark.bookmarkedAt?.slice(0, 10) ?? '?'} · posted ${bookmark.postedAt?.slice(0, 10) ?? '?'}`;
  }
  const postedAt = item.postedAt?.slice(0, 10) ?? '?';
  const likedAt = 'likedAt' in item ? item.likedAt?.slice(0, 10) ?? '?' : '?';
  return `Liked ${likedAt} · posted ${postedAt}`;
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

  const bookmark = source === 'bookmarks' && isBookmarkItem(item) ? item : null;
  const searchItem = source === 'search' && isHybridSearchResult(item) ? item : null;

  return (
    <section className="detail-pane">
      <div className="detail-header">
        <div>
          <div className="eyebrow">
            {source === 'search' ? `Search result · ${mode ?? 'topic'}` : source === 'bookmarks' ? 'Bookmark' : 'Like'}
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

      <dl className="detail-stats">
        <div><dt>Likes</dt><dd>{'likeCount' in item ? item.likeCount ?? 0 : 0}</dd></div>
        <div><dt>Reposts</dt><dd>{'repostCount' in item ? item.repostCount ?? 0 : 0}</dd></div>
        <div><dt>Replies</dt><dd>{'replyCount' in item ? item.replyCount ?? 0 : 0}</dd></div>
        <div><dt>Bookmarks</dt><dd>{'bookmarkCount' in item ? item.bookmarkCount ?? 0 : 0}</dd></div>
      </dl>

      {bookmark && (bookmark.categories.length > 0 || bookmark.domains.length > 0) ? (
        <div className="detail-groups">
          {bookmark.categories.length > 0 ? (
            <div>
              <h3>Categories</h3>
              <div className="pill-row">
                {bookmark.categories.map((value) => <span key={value} className="pill">{value}</span>)}
              </div>
            </div>
          ) : null}
          {bookmark.domains.length > 0 ? (
            <div>
              <h3>Domains</h3>
              <div className="pill-row">
                {bookmark.domains.map((value) => <span key={value} className="pill">{value}</span>)}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {'links' in item && item.links.length > 0 ? (
        <div className="detail-groups">
          <h3>Links</h3>
          <div className="link-stack">
            {item.links.map((link) => (
              <a key={link} href={link} target="_blank" rel="noreferrer">{link}</a>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
