import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { errorMessage } from '../api/client';
import { storageApi, uploadsApi } from '../api/endpoints';
import type { StorageUsage, UploadRecord } from '../api/types';
import { formatBytes } from '../lib/format';
import { fingerprintOf, runResumableUpload } from '../lib/resumableUpload';
import { useToast } from './ToastContext';

export type ViewMode = 'grid' | 'list';

export interface UploadTask {
  /** Local id (this browser tab) */
  id: number;
  /** Server upload id, once the server has created the upload */
  uploadId?: string;
  name: string;
  size: number;
  progress: number; // 0..1
  /** waiting = paused by a connection problem; continues automatically */
  status: 'queued' | 'uploading' | 'waiting' | 'done' | 'error' | 'cancelled';
  error?: string;
  /** Extra info, e.g. "No internet connection" */
  message?: string;
}

interface DriveApi {
  /** Increases after every change; pages reload their data when it changes. */
  version: number;
  refresh: () => void;
  viewMode: ViewMode;
  setViewMode: (mode: ViewMode) => void;
  /** The folder being viewed (null = My Drive root); used by "New" actions. */
  currentFolderId: string | null;
  setCurrentFolderId: (id: string | null) => void;
  usage: StorageUsage | null;
  uploads: UploadTask[];
  startUploads: (files: File[], folderId: string | null) => void;
  /** Continue an upload from the history after the page was closed/reloaded. */
  resumeUpload: (record: UploadRecord, file: File) => void;
  retryUpload: (id: number) => void;
  cancelUpload: (id: number) => void;
  clearUploads: () => void;
}

const DriveContext = createContext<DriveApi | null>(null);
const VIEW_KEY = 'drive:viewMode';
const PARALLEL_UPLOADS = 3;
let nextUploadId = 1;

function readViewMode(): ViewMode {
  try {
    return localStorage.getItem(VIEW_KEY) === 'list' ? 'list' : 'grid';
  } catch {
    return 'grid';
  }
}

const isActive = (t: UploadTask) => t.status === 'queued' || t.status === 'uploading' || t.status === 'waiting';

export function DriveProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const [viewMode, setViewModeState] = useState<ViewMode>(readViewMode);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);

  // Things the upload workers need that should not cause re-renders.
  const jobs = useRef(new Map<number, { file: File; folderId: string | null; uploadId?: string }>());
  const queue = useRef<number[]>([]);
  const running = useRef(0);
  const controllers = useRef(new Map<number, AbortController>());
  const stats = useRef({ ok: 0, failed: 0 });

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_KEY, mode);
    } catch {
      /* storage unavailable (private mode) - the choice just isn't remembered */
    }
  }, []);

  // Storage usage is reloaded after every change.
  useEffect(() => {
    storageApi
      .usage()
      .then(setUsage)
      .catch(() => undefined);
  }, [version]);

  // On first load, mention uploads that were interrupted earlier (closed tab, crash...).
  const announced = useRef(false);
  useEffect(() => {
    if (announced.current) return;
    announced.current = true;
    uploadsApi
      .list()
      .then(({ uploads: records }) => {
        const unfinished = records.filter((r) => r.status === 'uploading').length;
        if (unfinished > 0) {
          toast(
            `You have ${unfinished} unfinished upload${unfinished === 1 ? '' : 's'}. Open "Uploads" to resume.`,
            'info',
          );
        }
      })
      .catch(() => undefined);
  }, [toast]);

  // Warn before closing the tab while uploads are running (they can be resumed later).
  useEffect(() => {
    if (!uploads.some(isActive)) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [uploads]);

  const patchTask = useCallback((id: number, patch: Partial<UploadTask>) => {
    setUploads((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const runJob = useCallback(
    async (id: number) => {
      const job = jobs.current.get(id);
      if (!job) return;
      const controller = new AbortController();
      controllers.current.set(id, controller);
      patchTask(id, { status: 'uploading', error: undefined, message: undefined });
      try {
        await runResumableUpload({
          file: job.file,
          folderId: job.folderId,
          uploadId: job.uploadId,
          signal: controller.signal,
          onSession: (record) => {
            if (job.uploadId !== record.id) {
              job.uploadId = record.id;
              patchTask(id, { uploadId: record.id });
              refresh(); // the Uploads page shows the new record
            }
          },
          onProgress: (bytes) => patchTask(id, { progress: job.file.size ? Math.min(1, bytes / job.file.size) : 1 }),
          onPhase: (phase, message) => patchTask(id, { status: phase, message }),
        });
        patchTask(id, { status: 'done', progress: 1, message: undefined });
        stats.current.ok++;
        refresh();
      } catch (err) {
        if ((err as Error).name === 'AbortError') {
          patchTask(id, { status: 'cancelled', message: undefined });
        } else {
          stats.current.failed++;
          patchTask(id, { status: 'error', error: errorMessage(err), message: undefined });
        }
      } finally {
        controllers.current.delete(id);
      }
    },
    [patchTask, refresh],
  );

  /** Starts queued jobs while fewer than PARALLEL_UPLOADS are running. */
  const pump = useCallback(() => {
    while (running.current < PARALLEL_UPLOADS && queue.current.length > 0) {
      const id = queue.current.shift()!;
      running.current++;
      void runJob(id).finally(() => {
        running.current--;
        if (running.current === 0 && queue.current.length === 0) {
          const { ok, failed } = stats.current;
          if (ok > 0 && failed === 0) toast(`${ok} file${ok === 1 ? '' : 's'} uploaded`, 'success');
          else if (failed > 0) toast(`${failed} upload${failed === 1 ? '' : 's'} failed. Use Retry in the upload panel.`, 'error');
          stats.current = { ok: 0, failed: 0 };
        }
        pump();
      });
    }
  }, [runJob, toast]);

  const enqueue = useCallback(
    (task: UploadTask, job: { file: File; folderId: string | null; uploadId?: string }) => {
      jobs.current.set(task.id, job);
      setUploads((list) => [...list, task]);
      if (task.status === 'queued') {
        queue.current.push(task.id);
        pump();
      }
    },
    [pump],
  );

  const startUploads = useCallback(
    (files: File[], folderId: string | null) => {
      const maxBytes = usage?.maxUploadBytes ?? null; // null = no per-file limit
      const freeSpace = usage ? usage.quota - usage.used : null;
      for (const file of files) {
        // Quick checks before sending anything (the server checks again).
        const error =
          maxBytes !== null && file.size > maxBytes
            ? `Larger than the ${formatBytes(maxBytes)} limit`
            : freeSpace !== null && file.size > freeSpace
              ? `Not enough storage space (${formatBytes(Math.max(0, freeSpace))} free)`
              : undefined;
        enqueue(
          { id: nextUploadId++, name: file.name, size: file.size, progress: 0, status: error ? 'error' : 'queued', error },
          { file, folderId },
        );
      }
    },
    [usage, enqueue],
  );

  const resumeUpload = useCallback(
    (record: UploadRecord, file: File) => {
      if (fingerprintOf(file) !== record.fingerprint) {
        toast(`That is not the same file as "${record.name}". Please choose the original file.`, 'error');
        return;
      }
      if (uploads.some((t) => t.uploadId === record.id && isActive(t))) return; // already running
      enqueue(
        {
          id: nextUploadId++,
          uploadId: record.id,
          name: record.name,
          size: record.size,
          progress: record.size ? record.receivedBytes / record.size : 0,
          status: 'queued',
        },
        { file, folderId: record.folderId, uploadId: record.id },
      );
    },
    [uploads, enqueue, toast],
  );

  const retryUpload = useCallback(
    (id: number) => {
      if (!jobs.current.has(id)) return;
      patchTask(id, { status: 'queued', error: undefined });
      queue.current.push(id);
      pump();
    },
    [patchTask, pump],
  );

  const cancelUpload = useCallback(
    (id: number) => {
      queue.current = queue.current.filter((q) => q !== id);
      controllers.current.get(id)?.abort(); // stops it in this tab
      const uploadId = jobs.current.get(id)?.uploadId;
      if (uploadId) {
        // Tell the server to delete the pieces received so far.
        void uploadsApi.cancel(uploadId).then(refresh, () => undefined);
      }
      patchTask(id, { status: 'cancelled', message: undefined });
    },
    [patchTask, refresh],
  );

  /** Cancels anything still running and empties the upload panel. */
  const clearUploads = useCallback(() => {
    for (const t of uploads) if (isActive(t)) cancelUpload(t.id);
    jobs.current.clear();
    setUploads([]);
  }, [uploads, cancelUpload]);

  const value = useMemo(
    () => ({
      version,
      refresh,
      viewMode,
      setViewMode,
      currentFolderId,
      setCurrentFolderId,
      usage,
      uploads,
      startUploads,
      resumeUpload,
      retryUpload,
      cancelUpload,
      clearUploads,
    }),
    [
      version,
      refresh,
      viewMode,
      setViewMode,
      currentFolderId,
      usage,
      uploads,
      startUploads,
      resumeUpload,
      retryUpload,
      cancelUpload,
      clearUploads,
    ],
  );
  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>;
}

export function useDrive(): DriveApi {
  const ctx = useContext(DriveContext);
  if (!ctx) throw new Error('useDrive must be used inside <DriveProvider>');
  return ctx;
}
