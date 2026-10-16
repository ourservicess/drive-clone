import { ChevronRight, HardDrive } from 'lucide-react';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { filesApi, foldersApi } from '../../api/endpoints';
import type { Breadcrumb, DriveItem, FolderItem } from '../../api/types';
import { FolderIcon } from '../files/FileIcon';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Spinner } from '../ui/Spinner';

interface Props {
  item: DriveItem | null;
  onClose: () => void;
  onMoved: (destinationName: string) => void;
}

/** Lets the user browse their folders and pick a destination. */
export function MoveDialog({ item, onClose, onMoved }: Props) {
  const [location, setLocation] = useState<string | null>(null); // null = My Drive
  const [path, setPath] = useState<Breadcrumb[]>([]);
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Start in the folder that currently contains the item.
  useEffect(() => {
    if (!item) return;
    setLocation(item.type === 'file' ? item.item.folderId : item.item.parentId);
    setError(null);
  }, [item]);

  useEffect(() => {
    if (!item) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      foldersApi.list(location, { sort: 'name', order: 'asc' }),
      location ? foldersApi.get(location) : Promise.resolve({ breadcrumbs: [] as Breadcrumb[] }),
    ])
      .then(([list, details]) => {
        if (cancelled) return;
        // A folder cannot be moved into itself, so hide it from the list.
        setFolders(list.folders.filter((f) => !(item.type === 'folder' && f.id === item.item.id)));
        setPath(details.breadcrumbs);
      })
      .catch((err) => !cancelled && setError(errorMessage(err)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [item, location]);

  if (!item) return null;

  const currentParent = item.type === 'file' ? item.item.folderId : item.item.parentId;
  const destinationName = path.length ? path[path.length - 1]!.name : 'My Drive';

  const move = async () => {
    setBusy(true);
    setError(null);
    try {
      if (item.type === 'file') await filesApi.update(item.item.id, { folderId: location });
      else await foldersApi.update(item.item.id, { parentId: location });
      onMoved(destinationName);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Move "${item.item.name}"`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={move} loading={busy} disabled={location === currentParent || loading}>
            Move here
          </Button>
        </>
      }
    >
      <nav aria-label="Destination path" className="mb-3 flex flex-wrap items-center gap-1 text-sm">
        <button type="button" onClick={() => setLocation(null)} className="rounded px-1.5 py-0.5 hover:bg-slate-100">
          My Drive
        </button>
        {path.map((crumb) => (
          <span key={crumb.id} className="flex items-center gap-1">
            <ChevronRight className="size-4 text-slate-400" aria-hidden />
            <button
              type="button"
              onClick={() => setLocation(crumb.id)}
              className="rounded px-1.5 py-0.5 hover:bg-slate-100"
            >
              {crumb.name}
            </button>
          </span>
        ))}
      </nav>

      <div className="h-64 overflow-y-auto rounded-lg border border-slate-200">
        {loading ? (
          <div className="flex h-full items-center justify-center text-brand-500">
            <Spinner />
          </div>
        ) : folders.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
            <HardDrive className="size-6" aria-hidden />
            No folders here
          </div>
        ) : (
          <ul>
            {folders.map((f) => (
              <li key={f.id}>
                <button
                  type="button"
                  onClick={() => setLocation(f.id)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-slate-100"
                >
                  <FolderIcon />
                  <span className="flex-1 truncate">{f.name}</span>
                  <ChevronRight className="size-4 text-slate-400" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {error && (
        <p className="mt-2 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}
