import {
  ArrowDown,
  ArrowUp,
  CircleAlert,
  Download,
  Eye,
  FolderInput,
  FolderOpen,
  Info,
  LayoutGrid,
  List,
  Pencil,
  RotateCcw,
  Share2,
  Star,
  StarOff,
  Trash2,
} from 'lucide-react';
import { useCallback, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { filesApi, foldersApi } from '../../api/endpoints';
import type { DriveItem, FileItem, FolderItem, SortField, SortState } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { formatDate } from '../../lib/format';
import { ConfirmDialog } from '../dialogs/ConfirmDialog';
import { MoveDialog } from '../dialogs/MoveDialog';
import { NameDialog } from '../dialogs/NameDialog';
import { ShareDialog } from '../dialogs/ShareDialog';
import { Button, IconButton } from '../ui/Button';
import { GridSkeleton, ListSkeleton } from '../ui/Skeleton';
import { ContextMenu, type MenuAction } from './ContextMenu';
import { DetailsPanel } from './DetailsPanel';
import { ItemCard, ItemRow, ListHeader, type ItemHandlers, type ListColumns } from './ItemViews';
import { PreviewModal } from './PreviewModal';

interface Props {
  title: ReactNode;
  headerActions?: ReactNode;
  notice?: ReactNode;
  folders: FolderItem[];
  files: FileItem[];
  /** true only for the FIRST load (show skeletons) */
  loading: boolean;
  error?: string;
  onRetry: () => void;
  variant?: 'drive' | 'trash';
  empty: ReactNode;
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  dateColumn?: { label: string; value: (entry: DriveItem) => string };
}

interface ConfirmState {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
  run: () => Promise<void>;
}

const keyOf = (e: DriveItem) => `${e.type}:${e.item.id}`;

/** Starts a browser download from a short-lived signed URL. */
function triggerDownload(url: string) {
  const a = document.createElement('a');
  a.href = url;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/**
 * The heart of the UI: shows folders and files in a grid or list, and handles
 * selection, the context menu, and every action (open, download, rename,
 * star, move, details, trash, restore, delete forever).
 */
export function ItemBrowser({
  title,
  headerActions,
  notice,
  folders,
  files,
  loading,
  error,
  onRetry,
  variant = 'drive',
  empty,
  sort,
  onSortChange,
  dateColumn,
}: Props) {
  const { viewMode, setViewMode, refresh } = useDrive();
  const { toast } = useToast();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [menu, setMenu] = useState<{ entry: DriveItem; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<DriveItem | null>(null);
  const [moving, setMoving] = useState<DriveItem | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [previewing, setPreviewing] = useState<FileItem | null>(null);
  const [sharing, setSharing] = useState<FileItem | null>(null);

  const entries: DriveItem[] = [
    ...folders.map((item) => ({ type: 'folder' as const, item })),
    ...files.map((item) => ({ type: 'file' as const, item })),
  ];
  const selected = entries.find((e) => keyOf(e) === selectedKey) ?? null;

  /** Runs an API call, then shows a toast and refreshes the data. */
  const run = useCallback(
    async (task: () => Promise<unknown>, success?: string) => {
      try {
        await task();
        if (success) toast(success, 'success');
      } catch (err) {
        toast(errorMessage(err), 'error');
      } finally {
        refresh();
      }
    },
    [refresh, toast],
  );

  const download = useCallback(
    (file: FileItem) =>
      run(async () => {
        const { url } = await filesApi.download(file.id);
        triggerDownload(url);
      }),
    [run],
  );

  const closePreview = useCallback(() => setPreviewing(null), []);
  const closeMenu = useCallback(() => setMenu(null), []);

  const open = (entry: DriveItem) => {
    if (variant === 'trash') {
      toast('Restore this item to open it', 'info');
    } else if (entry.type === 'folder') {
      navigate(`/drive/folders/${entry.item.id}`);
    } else {
      setPreviewing(entry.item);
    }
  };

  const askTrash = (entry: DriveItem) =>
    setConfirm({
      title: 'Move to Trash?',
      message:
        entry.type === 'folder'
          ? `"${entry.item.name}" and everything inside it will be moved to Trash. You can restore it from there.`
          : `"${entry.item.name}" will be moved to Trash. You can restore it from there.`,
      confirmLabel: 'Move to Trash',
      danger: true,
      run: () =>
        run(
          () => (entry.type === 'file' ? filesApi.trash(entry.item.id) : foldersApi.trash(entry.item.id)),
          `"${entry.item.name}" moved to Trash`,
        ),
    });

  const askDeleteForever = (entry: DriveItem) =>
    setConfirm({
      title: 'Delete forever?',
      message: `"${entry.item.name}"${entry.type === 'folder' ? ' and everything inside it' : ''} will be deleted forever. This cannot be undone.`,
      confirmLabel: 'Delete forever',
      danger: true,
      run: () =>
        run(
          () =>
            entry.type === 'file' ? filesApi.deleteForever(entry.item.id) : foldersApi.deleteForever(entry.item.id),
          `"${entry.item.name}" deleted forever`,
        ),
    });

  const restore = (entry: DriveItem) =>
    run(
      () => (entry.type === 'file' ? filesApi.restore(entry.item.id) : foldersApi.restore(entry.item.id)),
      `"${entry.item.name}" restored`,
    );

  const showDetails = (entry: DriveItem) => {
    setSelectedKey(keyOf(entry));
    setDetailsOpen(true);
  };

  const actionsFor = (entry: DriveItem): MenuAction[] => {
    if (variant === 'trash') {
      return [
        { label: 'Restore', icon: RotateCcw, onSelect: () => restore(entry) },
        { label: 'Details', icon: Info, onSelect: () => showDetails(entry) },
        { label: 'Delete forever', icon: Trash2, danger: true, dividerBefore: true, onSelect: () => askDeleteForever(entry) },
      ];
    }
    const common: MenuAction[] = [
      { label: 'Rename', icon: Pencil, onSelect: () => setRenaming(entry) },
      { label: 'Move', icon: FolderInput, onSelect: () => setMoving(entry) },
      { label: 'Details', icon: Info, onSelect: () => showDetails(entry) },
      { label: 'Move to Trash', icon: Trash2, danger: true, dividerBefore: true, onSelect: () => askTrash(entry) },
    ];
    if (entry.type === 'folder') {
      return [{ label: 'Open', icon: FolderOpen, onSelect: () => open(entry) }, ...common];
    }
    const file = entry.item;
    return [
      { label: 'Open', icon: Eye, onSelect: () => open(entry) },
      { label: 'Download', icon: Download, onSelect: () => download(file) },
      { label: file.shared ? 'Share (link is on)' : 'Share', icon: Share2, onSelect: () => setSharing(file) },
      file.starred
        ? {
            label: 'Remove from Starred',
            icon: StarOff,
            onSelect: () => run(() => filesApi.star(file.id, false), 'Removed from Starred'),
          }
        : { label: 'Add to Starred', icon: Star, onSelect: () => run(() => filesApi.star(file.id, true), 'Added to Starred') },
      ...common,
    ];
  };

  const handlers: ItemHandlers = {
    onSelect: (entry) => setSelectedKey(keyOf(entry)),
    onOpen: open,
    onMenu: (entry, x, y) => setMenu({ entry, x, y }),
    onKeyDown: (entry, e: KeyboardEvent<HTMLElement>) => {
      if (e.target !== e.currentTarget) return; // ignore keys pressed on the inner button
      if (e.key === 'Enter') {
        open(entry);
      } else if (e.key === ' ') {
        e.preventDefault();
        setSelectedKey(keyOf(entry));
      } else if (e.key === 'Delete') {
        if (variant === 'trash') askDeleteForever(entry);
        else askTrash(entry);
      } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        setSelectedKey(keyOf(entry));
        setMenu({ entry, x: rect.left + 24, y: rect.top + rect.height / 2 });
      }
    },
  };

  const columns: ListColumns = {
    ownerLabel: (entry) => (entry.type === 'folder' || entry.item.owner.id === user?.id ? 'me' : entry.item.owner.name),
    dateLabel: dateColumn?.label ?? 'Uploaded',
    dateValue: dateColumn?.value ?? ((entry) => formatDate(entry.item.createdAt)),
  };

  const visibleFolders = entries.filter((e) => e.type === 'folder');
  const visibleFiles = entries.filter((e) => e.type === 'file');

  let body: ReactNode;
  if (loading) {
    body = viewMode === 'grid' ? <GridSkeleton /> : <ListSkeleton />;
  } else if (error) {
    body = (
      <div role="alert" className="flex flex-col items-center gap-3 py-16 text-center">
        <CircleAlert className="size-10 text-red-500" aria-hidden />
        <p className="text-slate-700">{error}</p>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  } else if (entries.length === 0) {
    body = empty;
  } else if (viewMode === 'grid') {
    body = (
      <div className="space-y-6">
        {visibleFolders.length > 0 && (
          <section aria-label="Folders">
            <h2 className="mb-3 text-sm font-medium text-slate-700">Folders</h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleFolders.map((entry) => (
                <ItemCard key={keyOf(entry)} entry={entry} selected={keyOf(entry) === selectedKey} {...handlers} />
              ))}
            </div>
          </section>
        )}
        {visibleFiles.length > 0 && (
          <section aria-label="Files">
            <h2 className="mb-3 text-sm font-medium text-slate-700">Files</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
              {visibleFiles.map((entry) => (
                <ItemCard key={keyOf(entry)} entry={entry} selected={keyOf(entry) === selectedKey} {...handlers} />
              ))}
            </div>
          </section>
        )}
      </div>
    );
  } else {
    body = (
      <div role="table" aria-label="Files and folders" className="rounded-xl border border-slate-200 bg-white">
        <ListHeader columns={columns} sort={sort} onSortChange={onSortChange} />
        {entries.map((entry) => (
          <ItemRow
            key={keyOf(entry)}
            entry={entry}
            selected={keyOf(entry) === selectedKey}
            columns={columns}
            {...handlers}
          />
        ))}
      </div>
    );
  }

  const SortArrow = sort?.order === 'asc' ? ArrowUp : ArrowDown;

  return (
    <div className="flex min-h-0 flex-1 gap-4">
      <div className="flex min-w-0 flex-1 flex-col" onClick={() => setSelectedKey(null)}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 pb-4">
          <div className="min-w-0 flex-1">{title}</div>
          {headerActions}
          {sort && onSortChange && (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <label htmlFor="sort-field" className="sr-only">
                Sort by
              </label>
              <select
                id="sort-field"
                value={sort.sort}
                onChange={(e) => onSortChange({ ...sort, sort: e.target.value as SortField })}
                className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm"
              >
                <option value="name">Name</option>
                <option value="date">Upload date</option>
                <option value="size">Size</option>
              </select>
              <IconButton
                label={sort.order === 'asc' ? 'Ascending (click for descending)' : 'Descending (click for ascending)'}
                onClick={() => onSortChange({ ...sort, order: sort.order === 'asc' ? 'desc' : 'asc' })}
              >
                <SortArrow className="size-4" />
              </IconButton>
            </div>
          )}
          <div className="flex rounded-full border border-slate-300 bg-white" role="group" aria-label="View">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewMode('list');
              }}
              aria-pressed={viewMode === 'list'}
              aria-label="List view"
              className={`rounded-l-full px-3 py-1.5 ${viewMode === 'list' ? 'bg-brand-100 text-brand-700' : 'text-slate-600'}`}
            >
              <List className="size-4" />
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setViewMode('grid');
              }}
              aria-pressed={viewMode === 'grid'}
              aria-label="Grid view"
              className={`rounded-r-full px-3 py-1.5 ${viewMode === 'grid' ? 'bg-brand-100 text-brand-700' : 'text-slate-600'}`}
            >
              <LayoutGrid className="size-4" />
            </button>
          </div>
          <IconButton
            label={detailsOpen ? 'Hide details' : 'Show details'}
            aria-pressed={detailsOpen}
            onClick={(e) => {
              e.stopPropagation();
              setDetailsOpen((o) => !o);
            }}
            className={detailsOpen ? 'bg-brand-100 text-brand-700' : ''}
          >
            <Info className="size-5" />
          </IconButton>
        </div>

        {notice}
        <div className="min-h-0 flex-1 overflow-y-auto pb-24">{body}</div>
      </div>

      {detailsOpen && <DetailsPanel item={selected} onClose={() => setDetailsOpen(false)} />}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label={`Actions for ${menu.entry.item.name}`}
          actions={actionsFor(menu.entry)}
          onClose={closeMenu}
        />
      )}

      <NameDialog
        open={renaming !== null}
        title="Rename"
        initialName={renaming?.item.name ?? ''}
        confirmLabel="Rename"
        selectBaseName={renaming?.type === 'file'}
        onClose={() => setRenaming(null)}
        onSubmit={async (name) => {
          if (!renaming) return;
          if (renaming.type === 'file') await filesApi.update(renaming.item.id, { name });
          else await foldersApi.update(renaming.item.id, { name });
          toast('Renamed', 'success');
          refresh();
        }}
      />

      <MoveDialog
        item={moving}
        onClose={() => setMoving(null)}
        onMoved={(dest) => {
          toast(`Moved to "${dest}"`, 'success');
          refresh();
        }}
      />

      <ConfirmDialog
        open={confirm !== null}
        title={confirm?.title ?? ''}
        message={confirm?.message ?? ''}
        confirmLabel={confirm?.confirmLabel ?? 'OK'}
        danger={confirm?.danger}
        onConfirm={async () => confirm?.run()}
        onClose={() => setConfirm(null)}
      />

      <PreviewModal file={previewing} onClose={closePreview} onDownload={download} />

      <ShareDialog file={sharing} onClose={() => setSharing(null)} />
    </div>
  );
}
