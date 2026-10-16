import { Info, Star, X } from 'lucide-react';
import type { DriveItem } from '../../api/types';
import { useAuth } from '../../context/AuthContext';
import { describeType, formatBytes, formatDateTime } from '../../lib/format';
import { IconButton } from '../ui/Button';
import { FileIcon, FolderIcon } from './FileIcon';

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm break-words text-slate-800">{value}</dd>
    </div>
  );
}

/** Right-hand panel with information about the selected item. */
export function DetailsPanel({ item, onClose }: { item: DriveItem | null; onClose: () => void }) {
  const { user } = useAuth();

  return (
    <aside
      aria-label="Details"
      className="fixed inset-y-0 right-0 z-40 flex w-full max-w-sm flex-col border-l border-slate-200 bg-white shadow-xl lg:static lg:z-auto lg:w-80 lg:rounded-2xl lg:border lg:shadow-none"
    >
      <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-3">
        {item ? (
          item.type === 'folder' ? <FolderIcon /> : <FileIcon mimeType={item.item.mimeType} />
        ) : (
          <Info className="size-5 text-slate-500" aria-hidden />
        )}
        <h2 className="flex-1 truncate font-medium">{item ? item.item.name : 'Details'}</h2>
        <IconButton label="Close details" onClick={onClose}>
          <X className="size-5" />
        </IconButton>
      </div>

      {!item ? (
        <p className="p-6 text-center text-sm text-slate-500">Select a file or folder to see its details.</p>
      ) : (
        <dl className="space-y-4 overflow-y-auto p-5">
          {item.type === 'file' ? (
            <>
              <Row label="Type" value={describeType(item.item.mimeType, item.item.name)} />
              <Row label="Size" value={`${formatBytes(item.item.size)} (${item.item.size.toLocaleString()} bytes)`} />
              <Row
                label="Owner"
                value={item.item.owner.id === user?.id ? `me (${item.item.owner.email})` : item.item.owner.name}
              />
              <Row label="Uploaded" value={formatDateTime(item.item.createdAt)} />
              <Row label="Modified" value={formatDateTime(item.item.updatedAt)} />
              <Row label="Last opened" value={formatDateTime(item.item.lastAccessedAt)} />
              {item.item.starred && (
                <p className="flex items-center gap-2 text-sm text-amber-600">
                  <Star className="size-4 fill-current" aria-hidden /> Starred
                </p>
              )}
            </>
          ) : (
            <>
              <Row label="Type" value="Folder" />
              <Row label="Owner" value="me" />
              <Row label="Created" value={formatDateTime(item.item.createdAt)} />
              <Row label="Modified" value={formatDateTime(item.item.updatedAt)} />
            </>
          )}
          {item.item.trashedAt && <Row label="Moved to Trash" value={formatDateTime(item.item.trashedAt)} />}
        </dl>
      )}
    </aside>
  );
}
