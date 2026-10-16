import { Trash2 } from 'lucide-react';
import { useState } from 'react';
import { trashApi } from '../api/endpoints';
import { ConfirmDialog } from '../components/dialogs/ConfirmDialog';
import { ItemBrowser } from '../components/files/ItemBrowser';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { useDrive } from '../context/DriveContext';
import { useToast } from '../context/ToastContext';
import { useLoader } from '../hooks/useLoader';
import { formatDate } from '../lib/format';

export function TrashPage() {
  const { refresh } = useDrive();
  const { toast } = useToast();
  const [confirmEmpty, setConfirmEmpty] = useState(false);
  const { data, loading, error, reload } = useLoader(() => trashApi.list(), []);
  const count = (data?.files.length ?? 0) + (data?.folders.length ?? 0);

  return (
    <>
      <ItemBrowser
        variant="trash"
        title={<h1 className="px-2 py-1 text-xl text-slate-700">Trash</h1>}
        headerActions={
          count > 0 && (
            <Button variant="ghost" onClick={() => setConfirmEmpty(true)}>
              Empty Trash
            </Button>
          )
        }
        notice={
          count > 0 && (
            <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
              Items in Trash still use storage until you delete them forever.
            </p>
          )
        }
        folders={data?.folders ?? []}
        files={data?.files ?? []}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        dateColumn={{ label: 'Trashed', value: (e) => (e.item.trashedAt ? formatDate(e.item.trashedAt) : '') }}
        empty={<EmptyState icon={Trash2} title="Trash is empty" message="Items you delete will appear here." />}
      />
      <ConfirmDialog
        open={confirmEmpty}
        title="Empty Trash?"
        message={`All ${count} item${count === 1 ? '' : 's'} in Trash will be deleted forever. This cannot be undone.`}
        confirmLabel="Empty Trash"
        danger
        onClose={() => setConfirmEmpty(false)}
        onConfirm={async () => {
          const res = await trashApi.empty();
          toast(`Deleted ${res.deletedFiles} file(s) and ${res.deletedFolders} folder(s) forever`, 'success');
          refresh();
        }}
      />
    </>
  );
}
