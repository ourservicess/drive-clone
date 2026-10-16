import { CloudUpload, FolderOpen, Play, RotateCcw, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { filesApi, uploadsApi } from '../api/endpoints';
import type { UploadRecord } from '../api/types';
import { FileIcon } from '../components/files/FileIcon';
import { Button, IconButton } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { ListSkeleton } from '../components/ui/Skeleton';
import { useDrive, type UploadTask } from '../context/DriveContext';
import { useToast } from '../context/ToastContext';
import { useLoader } from '../hooks/useLoader';
import { formatBytes, formatDateTime } from '../lib/format';

type Badge = { label: string; className: string };

function badgeFor(record: UploadRecord, live: UploadTask | undefined): Badge {
  if (live && live.status === 'waiting') return { label: 'Waiting for connection', className: 'bg-amber-100 text-amber-800' };
  if (live && (live.status === 'uploading' || live.status === 'queued'))
    return { label: 'Uploading', className: 'bg-brand-100 text-brand-700' };
  if (live && live.status === 'error') return { label: 'Paused (error)', className: 'bg-red-100 text-red-700' };
  switch (record.status) {
    case 'uploading':
      return { label: 'Interrupted', className: 'bg-amber-100 text-amber-800' };
    case 'completed':
      return { label: 'Completed', className: 'bg-green-100 text-green-800' };
    case 'cancelled':
      return { label: 'Cancelled', className: 'bg-slate-100 text-slate-600' };
    case 'expired':
      return { label: 'Expired', className: 'bg-slate-100 text-slate-600' };
    default:
      return { label: 'Failed', className: 'bg-red-100 text-red-700' };
  }
}

/** History of every upload, with Resume for uploads that were interrupted. */
export function UploadsPage() {
  const { uploads: tasks, resumeUpload, retryUpload, cancelUpload, refresh } = useDrive();
  const { toast } = useToast();
  const navigate = useNavigate();
  const { data, loading, error, reload } = useLoader(() => uploadsApi.list(), []);
  const pickerRef = useRef<HTMLInputElement>(null);
  const [resuming, setResuming] = useState<UploadRecord | null>(null);

  const records = data?.uploads ?? [];
  const liveFor = (record: UploadRecord) =>
    [...tasks].reverse().find((t) => t.uploadId === record.id && t.status !== 'cancelled');

  const run = async (task: () => Promise<unknown>, success?: string) => {
    try {
      await task();
      if (success) toast(success, 'success');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      refresh();
    }
  };

  const showInFolder = (record: UploadRecord) =>
    run(async () => {
      if (!record.fileId) return;
      try {
        const { file } = await filesApi.get(record.fileId);
        navigate(file.folderId ? `/drive/folders/${file.folderId}` : '/drive');
      } catch {
        throw new Error('This file is no longer in your Drive (it may be in Trash or deleted).');
      }
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 pb-4">
        <h1 className="flex-1 px-2 py-1 text-xl text-slate-700">Uploads</h1>
        {records.some((r) => r.status !== 'uploading') && (
          <Button variant="ghost" onClick={() => run(() => uploadsApi.clearFinished(), 'Finished uploads cleared')}>
            Clear finished
          </Button>
        )}
      </div>

      <p className="mb-4 rounded-lg bg-slate-100 px-4 py-2.5 text-sm text-slate-600">
        Uploads continue by themselves when your internet comes back. If you closed the page, press <b>Resume</b> and
        choose the same file again: it continues from where it stopped.
      </p>

      {/* Hidden picker used by "Resume" */}
      <input
        ref={pickerRef}
        type="file"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file && resuming) resumeUpload(resuming, file);
          setResuming(null);
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto pb-24">
        {loading && !data ? (
          <ListSkeleton />
        ) : error ? (
          <div role="alert" className="py-16 text-center">
            <p className="mb-3 text-slate-700">{error}</p>
            <Button variant="secondary" onClick={reload}>
              Try again
            </Button>
          </div>
        ) : records.length === 0 ? (
          <EmptyState icon={CloudUpload} title="No uploads yet" message="Files you upload will be listed here." />
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 bg-white">
            {records.map((record) => {
              const live = liveFor(record);
              const badge = badgeFor(record, live);
              const progress = live && live.status !== 'done' ? live.progress : record.size ? record.receivedBytes / record.size : 1;
              const showProgress = record.status === 'uploading';
              return (
                <li key={record.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm sm:flex-nowrap">
                  <FileIcon mimeType={record.mimeType} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate font-medium" title={record.name}>
                        {record.name}
                      </span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${badge.className}`}>{badge.label}</span>
                    </div>
                    {showProgress && (
                      <div
                        className="mt-2 h-1.5 overflow-hidden rounded bg-slate-200"
                        role="progressbar"
                        aria-label={`Progress of ${record.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progress * 100)}
                      >
                        <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress * 100}%` }} />
                      </div>
                    )}
                    <p className="mt-1 text-xs text-slate-500">
                      {showProgress
                        ? `${formatBytes(progress * record.size)} of ${formatBytes(record.size)} · ${Math.round(progress * 100)}%`
                        : formatBytes(record.size)}
                      {' · '}started {formatDateTime(record.createdAt)}
                      {live?.message && <span className="text-amber-700"> · {live.message}</span>}
                      {live?.status === 'error' && live.error && <span className="text-red-600"> · {live.error}</span>}
                      {record.error && !live && <span> · {record.error}</span>}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                    {record.status === 'uploading' && !live && (
                      <Button
                        variant="secondary"
                        className="!px-3 !py-1.5"
                        onClick={() => {
                          setResuming(record);
                          pickerRef.current?.click();
                        }}
                      >
                        <Play className="size-4" aria-hidden /> Resume
                      </Button>
                    )}
                    {live?.status === 'error' && (
                      <Button variant="secondary" className="!px-3 !py-1.5" onClick={() => retryUpload(live.id)}>
                        <RotateCcw className="size-4" aria-hidden /> Retry
                      </Button>
                    )}
                    {record.status === 'completed' && record.fileId && (
                      <IconButton label="Show in folder" onClick={() => showInFolder(record)}>
                        <FolderOpen className="size-4" />
                      </IconButton>
                    )}
                    {record.status === 'uploading' ? (
                      <IconButton
                        label={`Cancel upload of ${record.name}`}
                        onClick={() => {
                          if (!window.confirm(`Cancel uploading "${record.name}"? The part uploaded so far will be deleted.`)) return;
                          if (live) cancelUpload(live.id);
                          else void run(() => uploadsApi.cancel(record.id), 'Upload cancelled');
                        }}
                      >
                        <X className="size-4" />
                      </IconButton>
                    ) : (
                      <IconButton
                        label={`Remove ${record.name} from this list`}
                        onClick={() => run(() => uploadsApi.remove(record.id))}
                      >
                        <X className="size-4" />
                      </IconButton>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
