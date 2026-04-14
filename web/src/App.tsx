import { startTransition, useEffect, useState } from 'react';
import { fetchArchiveItem, fetchArchiveList, fetchHybridSearch, fetchStatus } from './api';
import { ArchiveLayout } from './components/archive-layout';
import type {
  ArchiveSource,
  BookmarkItem,
  HybridSearchMode,
  HybridSearchResult,
  LikeItem,
  StatusResponse,
  ViewSource,
} from './types';

export function App() {
  const [source, setSource] = useState<ViewSource>('search');
  const [archiveSource, setArchiveSource] = useState<ArchiveSource>('bookmarks');
  const [searchMode, setSearchMode] = useState<HybridSearchMode>('topic');
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [items, setItems] = useState<Array<BookmarkItem | LikeItem | HybridSearchResult>>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedItem, setSelectedItem] = useState<BookmarkItem | LikeItem | HybridSearchResult | null>(null);
  const [queryInput, setQueryInput] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [searchSummary, setSearchSummary] = useState<string | null>(null);
  const [listLoading, setListLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    fetchStatus().then(setStatus).catch(() => null);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setListLoading(true);
    setDetailError(null);
    setSearchSummary(null);

    const request = source === 'search'
      ? fetchHybridSearch(submittedQuery, { mode: searchMode, limit: 40 })
      : fetchArchiveList(archiveSource, { query: submittedQuery, limit: 40, offset: 0 });

    request
      .then((response) => {
        if (cancelled) return;
        const nextItems = response.items;
        setItems(nextItems);
        setSelectedId(nextItems[0]?.id ?? null);
        if (source === 'search') {
          setSelectedItem(nextItems[0] ?? null);
        }
      })
      .catch((error: Error) => {
        if (cancelled) return;
        setItems([]);
        setSelectedId(null);
        setSelectedItem(null);
        setDetailError(error.message);
      })
      .finally(() => {
        if (!cancelled) setListLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [source, archiveSource, submittedQuery, searchMode]);

  useEffect(() => {
    if (source === 'search') {
      setSelectedItem(items.find((item) => item.id === selectedId) ?? null);
      return;
    }

    if (!selectedId) {
      setSelectedItem(null);
      return;
    }

    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);

    fetchArchiveItem(archiveSource, selectedId)
      .then((item) => {
        if (!cancelled) setSelectedItem(item);
      })
      .catch((error: Error) => {
        if (!cancelled) {
          setSelectedItem(null);
          setDetailError(error.message);
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [source, archiveSource, selectedId, items]);

  return (
    <ArchiveLayout
      source={source}
      archiveSource={archiveSource}
      searchMode={searchMode}
      status={status}
      items={items}
      selectedId={selectedId}
      selectedItem={selectedItem}
      listLoading={listLoading}
      detailLoading={detailLoading}
      detailError={detailError}
      summary={searchSummary}
      query={queryInput}
      onQueryChange={setQueryInput}
      onSearch={() => {
        startTransition(() => {
          setSubmittedQuery(queryInput.trim());
        });
      }}
      onSelectSource={(nextSource) => {
        setSource(nextSource);
        setSelectedId(null);
        setSelectedItem(null);
      }}
      onSelectArchiveSource={(nextSource) => {
        setArchiveSource(nextSource);
        setSource(nextSource);
        setSelectedId(null);
        setSelectedItem(null);
      }}
      onSelectSearchMode={(nextMode) => {
        setSearchMode(nextMode);
      }}
      onSelectItem={setSelectedId}
    />
  );
}
