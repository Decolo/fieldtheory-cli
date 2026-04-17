import type {
  ArchiveSource,
  BookmarkItem,
  FeedMetricsResponse,
  HybridSearchMode,
  HybridSearchResult,
  LikeItem,
  StatusResponse,
  ViewSource,
} from '../types';
import { DashboardPanel } from './dashboard-panel';
import { DetailPane } from './detail-pane';
import { ItemList } from './item-list';
import { SearchBar } from './search-bar';

interface ArchiveLayoutProps {
  source: ViewSource;
  archiveSource: ArchiveSource;
  searchMode: HybridSearchMode;
  status: StatusResponse | null;
  metrics: FeedMetricsResponse | null;
  items: Array<BookmarkItem | LikeItem | HybridSearchResult>;
  selectedId: string | null;
  selectedItem: BookmarkItem | LikeItem | HybridSearchResult | null;
  listLoading: boolean;
  detailLoading: boolean;
  detailError: string | null;
  metricsLoading: boolean;
  metricsError: string | null;
  summary: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSearch: () => void;
  onSelectSource: (source: ViewSource) => void;
  onSelectArchiveSource: (source: ArchiveSource) => void;
  onSelectSearchMode: (mode: HybridSearchMode) => void;
  onSelectItem: (id: string) => void;
}

function formatCount(value: number | undefined): string {
  return typeof value === 'number' ? value.toLocaleString() : '0';
}

export function ArchiveLayout(props: ArchiveLayoutProps) {
  const activeCount = props.source === 'search'
    ? props.items.length
    : props.source === 'dashboard'
      ? props.metrics?.feedCollection.windows.last7d.attempts
    : props.source === 'bookmarks'
      ? props.status?.bookmarks.total
      : props.status?.likes.total;

  return (
    <main className="app-shell">
      <section className="toolbar toolbar-primary">
        <div className="toolbar-row">
          <div className="toolbar-brand">
            <div className="eyebrow">field theory</div>
            <div className="toolbar-title">local x archive</div>
          </div>
          <div className="toolbar-stats" aria-label="Archive counts">
            <span>bm {formatCount(props.status?.bookmarks.total)}</span>
            <span>likes {formatCount(props.status?.likes.total)}</span>
            <span>feed {formatCount(props.status?.feed.total)}</span>
            <span>view {formatCount(activeCount)}</span>
          </div>
        </div>
        <div className="toolbar-row toolbar-controls">
          <div className="tabs" role="tablist" aria-label="Archive type">
            <button
              type="button"
              role="tab"
              aria-selected={props.source === 'dashboard'}
              className={`tab${props.source === 'dashboard' ? ' is-active' : ''}`}
              onClick={() => props.onSelectSource('dashboard')}
            >
              dashboard
            </button>
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
            </div>
          ) : null}
          {props.source !== 'dashboard' ? (
            <SearchBar query={props.query} onQueryChange={props.onQueryChange} onSubmit={props.onSearch} />
          ) : null}
        </div>
      </section>

      {props.source === 'dashboard' ? (
        <section className="workspace workspace-dashboard">
          <DashboardPanel
            metrics={props.metrics}
            loading={props.metricsLoading}
            error={props.metricsError}
          />
        </section>
      ) : (
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
      )}
    </main>
  );
}
