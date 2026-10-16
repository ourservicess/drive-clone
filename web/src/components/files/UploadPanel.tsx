import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, X } from 'lucide-react';
import { useState } from 'react';
import { useDrive } from '../../context/DriveContext';
import { formatBytes } from '../../lib/format';
import { IconButton } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

/** Bottom-right panel listing uploads with progress bars (like Drive). */
export function UploadPanel() {
  const { uploads, cancelUpload, clearUploads } = useDrive();
  const [collapsed, setCollapsed] = useState(false);
  if (uploads.length === 0) return null;

  const active = uploads.filter((u) => u.status === 'uploading' || u.status === 'queued').length;
  const done = uploads.filter((u) => u.status === 'done').length;
  const title = active > 0 ? `Uploading ${active} item${active === 1 ? '' : 's'}` : `${done} upload${done === 1 ? '' : 's'} complete`;

  return (
    <section
      aria-label="Uploads"
      className="fixed right-4 bottom-4 z-40 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-t-xl rounded-b-lg bg-white shadow-2xl ring-1 ring-slate-200"
    >
      <header className="flex items-center gap-1 bg-slate-800 py-2 pr-2 pl-4 text-white">
        <h2 className="flex-1 text-sm font-medium" aria-live="polite">
          {title}
        </h2>
        <IconButton
          label={collapsed ? 'Expand uploads' : 'Collapse uploads'}
          onClick={() => setCollapsed((c) => !c)}
          className="text-white hover:bg-white/10"
        >
          {collapsed ? <ChevronUp className="size-5" /> : <ChevronDown className="size-5" />}
        </IconButton>
        <IconButton
          label={active > 0 ? 'Cancel all uploads and close' : 'Close'}
          onClick={() => {
            if (active === 0 || window.confirm('Cancel all uploads in progress?')) clearUploads();
          }}
          className="text-white hover:bg-white/10"
        >
          <X className="size-5" />
        </IconButton>
      </header>

      {!collapsed && (
        <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
          {uploads.map((u) => (
            <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <p className="truncate" title={u.name}>
                  {u.name}
                </p>
                {u.status === 'uploading' || u.status === 'queued' ? (
                  <div
                    className="mt-1.5 h-1 overflow-hidden rounded bg-slate-200"
                    role="progressbar"
                    aria-label={`Uploading ${u.name}`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(u.progress * 100)}
                  >
                    <div className="h-full bg-brand-500 transition-all" style={{ width: `${u.progress * 100}%` }} />
                  </div>
                ) : (
                  <p className={`text-xs ${u.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                    {u.status === 'error' ? u.error : u.status === 'cancelled' ? 'Cancelled' : formatBytes(u.size)}
                  </p>
                )}
              </div>
              {u.status === 'done' && <CircleCheck className="size-5 text-green-600" aria-label="Uploaded" />}
              {u.status === 'error' && <CircleAlert className="size-5 text-red-600" aria-label="Failed" />}
              {(u.status === 'uploading' || u.status === 'queued') && (
                <>
                  {u.status === 'uploading' && <Spinner className="size-4 text-brand-500" />}
                  <IconButton label={`Cancel upload of ${u.name}`} onClick={() => cancelUpload(u.id)} className="size-7">
                    <X className="size-4" />
                  </IconButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
