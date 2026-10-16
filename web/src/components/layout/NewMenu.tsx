import { FolderPlus, Plus, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { foldersApi } from '../../api/endpoints';
import { useDrive } from '../../context/DriveContext';
import { useToast } from '../../context/ToastContext';
import { NameDialog } from '../dialogs/NameDialog';
import { ContextMenu } from '../files/ContextMenu';

/**
 * The "+ New" button: create a folder or upload files into the folder
 * currently being viewed (or My Drive when on another page).
 */
export function NewMenu({ variant = 'sidebar' }: { variant?: 'sidebar' | 'fab' }) {
  const { currentFolderId, startUploads, refresh } = useDrive();
  const { toast } = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [creating, setCreating] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu(variant === 'fab' ? { x: rect.right - 210, y: rect.top - 110 } : { x: rect.left, y: rect.bottom + 6 });
        }}
        className={
          variant === 'fab'
            ? 'fixed right-5 bottom-5 z-30 flex size-14 items-center justify-center rounded-2xl bg-white text-brand-600 shadow-lg ring-1 ring-slate-200 lg:hidden'
            : 'flex items-center gap-3 rounded-2xl bg-white px-5 py-4 text-sm font-medium text-slate-800 shadow-md ring-1 ring-slate-200 transition-shadow hover:bg-brand-50 hover:shadow-lg'
        }
        aria-label={variant === 'fab' ? 'New' : undefined}
      >
        <Plus className="size-6" aria-hidden />
        {variant === 'sidebar' && 'New'}
      </button>

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          label="Create new"
          onClose={() => setMenu(null)}
          actions={[
            { label: 'New folder', icon: FolderPlus, onSelect: () => setCreating(true) },
            { label: 'File upload', icon: Upload, dividerBefore: true, onSelect: () => inputRef.current?.click() },
          ]}
        />
      )}

      {/* Hidden file picker; "multiple" allows selecting several files at once. */}
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = ''; // allow choosing the same file again later
          startUploads(files, currentFolderId);
        }}
      />

      <NameDialog
        open={creating}
        title="New folder"
        initialName="Untitled folder"
        confirmLabel="Create"
        onClose={() => setCreating(false)}
        onSubmit={async (name) => {
          const { folder } = await foldersApi.create(name, currentFolderId);
          toast(`Folder "${folder.name}" created`, 'success');
          refresh();
          if (!currentFolderId) navigate('/drive');
        }}
      />
    </>
  );
}
