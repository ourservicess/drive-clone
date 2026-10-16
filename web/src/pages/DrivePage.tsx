import { ChevronRight, FolderOpen, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { filesApi, foldersApi } from '../api/endpoints';
import type { Breadcrumb, SortState } from '../api/types';
import { DropZone } from '../components/files/DropZone';
import { ItemBrowser } from '../components/files/ItemBrowser';
import { EmptyState } from '../components/ui/EmptyState';
import { useDrive } from '../context/DriveContext';
import { useLoader } from '../hooks/useLoader';

/** "My Drive" (no folderId) and any folder inside it (/drive/folders/:folderId). */
export function DrivePage() {
  const { folderId = null } = useParams();
  const { setCurrentFolderId } = useDrive();
  const [sort, setSort] = useState<SortState>({ sort: 'name', order: 'asc' });

  // Tell the "New" button which folder we are in.
  useEffect(() => {
    setCurrentFolderId(folderId);
    return () => setCurrentFolderId(null);
  }, [folderId, setCurrentFolderId]);

  const { data, loading, error, reload } = useLoader(async () => {
    const [folders, files, details] = await Promise.all([
      foldersApi.list(folderId, sort),
      filesApi.list(folderId, sort),
      folderId ? foldersApi.get(folderId) : Promise.resolve(null),
    ]);
    return { folders: folders.folders, files: files.files, breadcrumbs: details?.breadcrumbs ?? [] };
  }, [folderId, sort.sort, sort.order]);

  const title = <Breadcrumbs crumbs={data?.breadcrumbs ?? []} loadingFolder={!!folderId && !data} />;

  return (
    <DropZone folderId={folderId}>
      <ItemBrowser
        title={title}
        folders={data?.folders ?? []}
        files={data?.files ?? []}
        loading={loading && !data}
        error={error}
        onRetry={reload}
        sort={sort}
        onSortChange={setSort}
        empty={
          <EmptyState
            icon={folderId ? FolderOpen : Upload}
            title={folderId ? 'This folder is empty' : 'Welcome to your Drive'}
            message="Drop files here, or use the New button to upload files and create folders."
          />
        }
      />
    </DropZone>
  );
}

function Breadcrumbs({ crumbs, loadingFolder }: { crumbs: Breadcrumb[]; loadingFolder: boolean }) {
  const last = crumbs[crumbs.length - 1];
  return (
    <nav aria-label="Folder path" className="flex min-w-0 items-center gap-1 text-xl text-slate-700">
      {crumbs.length === 0 && !loadingFolder ? (
        <h1 className="px-2 py-1">My Drive</h1>
      ) : (
        <>
          <Link to="/drive" className="shrink-0 rounded-full px-2 py-1 hover:bg-slate-100">
            My Drive
          </Link>
          {crumbs.slice(0, -1).map((c) => (
            <span key={c.id} className="flex min-w-0 items-center gap-1">
              <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
              <Link to={`/drive/folders/${c.id}`} className="truncate rounded-full px-2 py-1 hover:bg-slate-100">
                {c.name}
              </Link>
            </span>
          ))}
          <ChevronRight className="size-5 shrink-0 text-slate-400" aria-hidden />
          <h1 className="truncate px-2 py-1" aria-current="page">
            {last?.name ?? '…'}
          </h1>
        </>
      )}
    </nav>
  );
}
