import { Clock } from 'lucide-react';
import { filesApi } from '../api/endpoints';
import { ItemBrowser } from '../components/files/ItemBrowser';
import { EmptyState } from '../components/ui/EmptyState';
import { useLoader } from '../hooks/useLoader';
import { formatDate } from '../lib/format';

export function RecentPage() {
  const { data, loading, error, reload } = useLoader(() => filesApi.recent(), []);

  return (
    <ItemBrowser
      title={<h1 className="px-2 py-1 text-xl text-slate-700">Recent</h1>}
      folders={[]}
      files={data?.files ?? []}
      loading={loading && !data}
      error={error}
      onRetry={reload}
      dateColumn={{
        label: 'Last opened',
        value: (e) => (e.type === 'file' ? formatDate(e.item.lastAccessedAt) : ''),
      }}
      empty={<EmptyState icon={Clock} title="No recent files" message="Files you upload or open will show up here." />}
    />
  );
}
