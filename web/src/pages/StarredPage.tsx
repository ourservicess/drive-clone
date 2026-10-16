import { Star } from 'lucide-react';
import { useState } from 'react';
import { filesApi } from '../api/endpoints';
import type { SortState } from '../api/types';
import { ItemBrowser } from '../components/files/ItemBrowser';
import { EmptyState } from '../components/ui/EmptyState';
import { useLoader } from '../hooks/useLoader';

export function StarredPage() {
  const [sort, setSort] = useState<SortState>({ sort: 'name', order: 'asc' });
  const { data, loading, error, reload } = useLoader(() => filesApi.starred(sort), [sort.sort, sort.order]);

  return (
    <ItemBrowser
      title={<h1 className="px-2 py-1 text-xl text-slate-700">Starred</h1>}
      folders={[]}
      files={data?.files ?? []}
      loading={loading && !data}
      error={error}
      onRetry={reload}
      sort={sort}
      onSortChange={setSort}
      empty={
        <EmptyState
          icon={Star}
          title="No starred files"
          message="Add stars to things you want to easily find later (right-click → Add to Starred)."
        />
      }
    />
  );
}
