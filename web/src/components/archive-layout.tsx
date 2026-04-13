import type {
  ArchiveSource,
  BookmarkItem,
  HybridSearchMode,
  HybridSearchResult,
  LikeItem,
  StatusResponse,
  ViewSource,
} from '../types';
import { DetailPane } from './detail-pane';
import { ItemList } from './item-list';
import { SearchBar } from './search-bar';

interface ArchiveLayoutProps {
  source: ViewSource;
  archiveSource: ArchiveSource;
  searchMode: HybridSearchMode;
  status: StatusResponse | null;
  items: Array<BookmarkItem | LikeItem | HybridSearchResult>;
  selectedId: string | null;
  selectedItem: BookmarkItem | LikeItem | HybridSearchResult | null;
  listLoading: boolean;
  detailLoading: boolean;
  detailError: string | null;
  summary: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelectSource: (source: ViewSource) => void;
  onSelectArchiveSource: (source: ArchiveSource) => void;
  onSelectSearchMode: (mode: HybridSearchMode) => void;
  onSummarize: () => void;
  onSelectItem: (id: string) => void;
}

function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '0';
}

export function ArchiveLayout(props: ArchiveLayoutProps) {
  const activeCount = props.source === 'search'
    ? props.items.length
    : props.source === 'bookmarks'
      ? props.status?.bookmarks.total
      : props.status?.likes.total;

  return (
    <main className="app-shell">
      <section className="hero">
        <div>
          <div className="eyebrow">Local hybrid archive search</div>
          <h1>Search feed, likes, and bookmarks on your machine.</h1>
          <p>
            Use topic search by default, switch to action-worthiness when you want the archive to prioritize what you would likely save.
          </p>
        </div>
        <div className="hero-stats">
          <div>
            <span>Bookmarks</span>
            <strong>{formatCount(props.status?.bookmarks.total)}</strong>
          </div>
          <div>
            <span>Likes</span>
            <strong>{formatCount(props.status?.likes.total)}</strong>
          </div>
          <div>
            <span>Feed</span>
            <strong>{formatCount(props.status?.feed.total)}</strong>
          </div>
          <div>
            <span>Active view</span>
            <strong>{formatCount(activeCount)}</strong>
          </div>
        </div>
      </section>

      <section className="toolbar">
        <div className="tabs" role="tablist" aria-label="Archive type">
          <button
            type="button"
            role="tab"
            aria-selected={props.source === 'search'}
            className={`tab${props.source === 'search' ? ' is-active' : ''}`}
            onClick={() => props.onSelectSource('search')}
          >
            search
          </button>
          {(['bookmarks', 'likes'] as const).map((source) => (
            <button
              key={source}
              type="button"
              role="tab"
              aria-selected={props.source === source}
              className={`tab${props.source === source ? ' is-active' : ''}`}
              onClick={() => props.onSelectArchiveSource(source)}
            >
              {source}
            </button>
          ))}
        </div>
        {props.source === 'search' ? (
          <div className="tabs" role="tablist" aria-label="Search mode">
            {(['topic', 'action'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="tab"
                aria-selected={props.searchMode === mode}
                className={`tab${props.searchMode === mode ? ' is-active' : ''}`}
                onClick={() => props.onSelectSearchMode(mode)}
              >
                {mode}
              </button>
            ))}
            <button type="button" className="tab" onClick={props.onSummarize}>summary</button>
          </div>
        ) : null}
        <SearchBar query={props.query} onQueryChange={props.onQueryChange} onSubmit={props.onSearch} />
      </section>

      <section className="workspace">
        <aside className="list-panel">
          <ItemList
            items={props.items}
            source={props.source}
            selectedId={props.selectedId}
            loading={props.listLoading}
            onSelect={props.onSelectItem}
          />
        </aside>
        <DetailPane
          source={props.source}
          item={props.selectedItem}
          loading={props.detailLoading}
          error={props.detailError}
          mode={props.searchMode}
          summary={props.summary}
        />
      </section>
    </main>
  );
}
