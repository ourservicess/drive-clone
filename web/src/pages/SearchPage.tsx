import { SearchX } from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { filesApi } from '../api/endpoints';
import { ItemBrowser } from '../components/files/ItemBrowser';
import { EmptyState } from '../components/ui/EmptyState';
import { useLoader } from '../hooks/useLoader';

export function SearchPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim();

  const { data, loading, error, reload } = useLoader(
    (signal) => (q ? filesApi.search(q, signal) : Promise.resolve({ files: [], folders: [] })),
    [q],
  );

  return (
    <ItemBrowser
      title={
        <h1 className="truncate px-2 py-1 text-xl text-slate-700">
          {q ? <>Results for “{q}”</> : 'Search'}
        </h1>
      }
      folders={data?.folders ?? []}
      files={data?.files ?? []}
      loading={loading && !data}
      error={error}
      onRetry={reload}
      empty={
        <EmptyState
          icon={SearchX}
          title={q ? 'No matching files' : 'Search your Drive'}
          message={q ? 'Try a different word or part of the file name.' : 'Type a file or folder name in the search box.'}
        />
      }
    />
  );
}
