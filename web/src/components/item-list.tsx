import type {
  ArchiveItem,
  HybridSearchResult,
  ViewSource,
} from '../types';

interface ItemListProps {
  items: Array<ArchiveItem | HybridSearchResult>;
  source: ViewSource;
  selectedId?: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
}

function getItemDate(source: ViewSource, item: ArchiveItem | HybridSearchResult): string {
  if (source === 'search') {
    return (item as HybridSearchResult).postedAt ?? '';
  }
  const archiveItem = item as ArchiveItem;
  const sourceDate = archiveItem.sourceDates[source as ArchiveItem['source']];
  return sourceDate ?? archiveItem.postedAt ?? '';
}

function isHybridSearchResult(item: ArchiveItem | HybridSearchResult): item is HybridSearchResult {
  return Array.isArray((item as HybridSearchResult).sources);
}

export function ItemList({ items, source, selectedId, loading, onSelect }: ItemListProps) {
  if (loading) {
    return <div className="empty-state">Loading archive…</div>;
  }

  if (items.length === 0) {
    return <div className="empty-state">No items found for this view.</div>;
  }

  return (
    <div className="item-list" role="list">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`item-row${item.id === selectedId ? ' is-selected' : ''}`}
          onClick={() => onSelect(item.id)}
        >
          <div className="item-row-top">
            <span className="item-handle">{item.authorHandle ? `@${item.authorHandle}` : '@unknown'}</span>
            <span className="item-date">{getItemDate(source, item).slice(0, 10) || 'unknown date'}</span>
          </div>
          <p className="item-text">{item.text}</p>
          <div className="item-meta">
            {source === 'search' && isHybridSearchResult(item)
              ? <span>{item.sources.join('+')}</span>
              : <span>{(item as ArchiveItem).sources.join('+')}</span>}
            {source === 'search' && isHybridSearchResult(item)
              ? <span>score {item.score.toFixed(2)}</span>
              : <span>{(item as ArchiveItem).sourceCount} sources</span>}
          </div>
        </button>
      ))}
    </div>
  );
}
