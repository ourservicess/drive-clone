import { ChevronDown, ChevronUp, CircleAlert, CircleCheck, RotateCcw, WifiOff, X } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDrive, type UploadTask } from '../../context/DriveContext';
import { formatBytes } from '../../lib/format';
import { IconButton } from '../ui/Button';
import { Spinner } from '../ui/Spinner';

const active = (u: UploadTask) => u.status === 'uploading' || u.status === 'queued' || u.status === 'waiting';

/** Bottom-right panel listing uploads with progress bars (like Drive). */
export function UploadPanel() {
  const { uploads, cancelUpload, retryUpload, clearUploads } = useDrive();
  const [collapsed, setCollapsed] = useState(false);
  if (uploads.length === 0) return null;

  const running = uploads.filter(active).length;
  const waiting = uploads.some((u) => u.status === 'waiting');
  const done = uploads.filter((u) => u.status === 'done').length;
  const title = waiting
    ? 'Waiting for connection…'
    : running > 0
      ? `Uploading ${running} item${running === 1 ? '' : 's'}`
      : `${done} upload${done === 1 ? '' : 's'} complete`;

  return (
    <section
      aria-label="Uploads"
      className="fixed right-4 bottom-4 z-40 w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-t-xl rounded-b-lg bg-white shadow-2xl ring-1 ring-slate-200"
    >
      <header className={`flex items-center gap-1 py-2 pr-2 pl-4 text-white ${waiting ? 'bg-amber-700' : 'bg-slate-800'}`}>
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
          label={running > 0 ? 'Cancel all uploads and close' : 'Close'}
          onClick={() => {
            if (running === 0 || window.confirm('Cancel all uploads in progress?')) clearUploads();
          }}
          className="text-white hover:bg-white/10"
        >
          <X className="size-5" />
        </IconButton>
      </header>

      {!collapsed && (
        <>
          <ul className="max-h-72 divide-y divide-slate-100 overflow-y-auto">
            {uploads.map((u) => (
              <li key={u.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate" title={u.name}>
                    {u.name}
                  </p>
                  {active(u) ? (
                    <>
                      <div
                        className="mt-1.5 h-1 overflow-hidden rounded bg-slate-200"
                        role="progressbar"
                        aria-label={`Uploading ${u.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(u.progress * 100)}
                      >
                        <div
                          className={`h-full transition-all ${u.status === 'waiting' ? 'bg-amber-500' : 'bg-brand-500'}`}
                          style={{ width: `${u.progress * 100}%` }}
                        />
                      </div>
                      <p className={`mt-1 text-xs ${u.status === 'waiting' ? 'text-amber-700' : 'text-slate-500'}`}>
                        {u.message ??
                          (u.status === 'queued'
                            ? 'Waiting…'
                            : `${formatBytes(u.progress * u.size)} of ${formatBytes(u.size)} · ${Math.round(u.progress * 100)}%`)}
                      </p>
                    </>
                  ) : (
                    <p className={`text-xs ${u.status === 'error' ? 'text-red-600' : 'text-slate-500'}`}>
                      {u.status === 'error' ? u.error : u.status === 'cancelled' ? 'Cancelled' : formatBytes(u.size)}
                    </p>
                  )}
                </div>
                {u.status === 'done' && <CircleCheck className="size-5 text-green-600" aria-label="Uploaded" />}
                {u.status === 'error' && (
                  <>
                    <CircleAlert className="size-5 text-red-600" aria-label="Failed" />
                    <IconButton label={`Retry upload of ${u.name}`} onClick={() => retryUpload(u.id)} className="size-7">
                      <RotateCcw className="size-4" />
                    </IconButton>
                  </>
                )}
                {active(u) && (
                  <>
                    {u.status === 'uploading' && <Spinner className="size-4 text-brand-500" />}
                    {u.status === 'waiting' && <WifiOff className="size-4 text-amber-600" aria-label="Waiting for connection" />}
                    <IconButton label={`Cancel upload of ${u.name}`} onClick={() => cancelUpload(u.id)} className="size-7">
                      <X className="size-4" />
                    </IconButton>
                  </>
                )}
              </li>
            ))}
          </ul>
          <Link
            to="/uploads"
            className="block border-t border-slate-100 px-4 py-2 text-xs font-medium text-brand-600 hover:bg-slate-50"
          >
            View all uploads
          </Link>
        </>
      )}
    </section>
  );
}
