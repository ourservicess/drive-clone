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
import { storageApi, uploadFile } from '../api/endpoints';
import type { StorageUsage } from '../api/types';
import { formatBytes } from '../lib/format';
import { useToast } from './ToastContext';

export type ViewMode = 'grid' | 'list';

export interface UploadTask {
  id: number;
  name: string;
  size: number;
  progress: number; // 0..1
  status: 'queued' | 'uploading' | 'done' | 'error' | 'cancelled';
  error?: string;
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

export function DriveProvider({ children }: { children: ReactNode }) {
  const { toast } = useToast();
  const [version, setVersion] = useState(0);
  const [viewMode, setViewModeState] = useState<ViewMode>(readViewMode);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [uploads, setUploads] = useState<UploadTask[]>([]);
  const controllers = useRef(new Map<number, AbortController>());
  const cancelledIds = useRef(new Set<number>());

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

  const patchTask = useCallback((id: number, patch: Partial<UploadTask>) => {
    setUploads((list) => list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const startUploads = useCallback(
    (files: File[], folderId: string | null) => {
      if (files.length === 0) return;
      const maxBytes = usage?.maxUploadBytes ?? null; // null = no per-file limit
      const freeSpace = usage ? usage.quota - usage.used : null;

      const tasks = files.map((file) => {
        const id = nextUploadId++;
        // Quick checks before sending anything (the server checks again).
        const error =
          maxBytes !== null && file.size > maxBytes
            ? `Larger than the ${formatBytes(maxBytes)} limit`
            : freeSpace !== null && file.size > freeSpace
              ? `Not enough storage space (${formatBytes(Math.max(0, freeSpace))} free)`
              : undefined;
        const task: UploadTask = {
          id,
          name: file.name,
          size: file.size,
          progress: 0,
          status: error ? 'error' : 'queued',
          error,
        };
        return { task, file };
      });
      setUploads((list) => [...list, ...tasks.map((t) => t.task)]);

      const queue = tasks.filter((t) => t.task.status === 'queued');
      let succeeded = 0;
      let failed = tasks.length - queue.length;

      const worker = async () => {
        for (let next = queue.shift(); next; next = queue.shift()) {
          const { task, file } = next;
          if (cancelledIds.current.has(task.id)) continue; // cancelled while waiting in the queue
          const controller = new AbortController();
          controllers.current.set(task.id, controller);
          patchTask(task.id, { status: 'uploading' });
          try {
            await uploadFile(file, folderId, (p) => patchTask(task.id, { progress: p }), controller.signal);
            patchTask(task.id, { status: 'done', progress: 1 });
            succeeded++;
            refresh();
          } catch (err) {
            if ((err as Error).name === 'AbortError') {
              patchTask(task.id, { status: 'cancelled' });
            } else {
              failed++;
              patchTask(task.id, { status: 'error', error: errorMessage(err) });
            }
          } finally {
            controllers.current.delete(task.id);
          }
        }
      };

      void Promise.all(Array.from({ length: Math.min(PARALLEL_UPLOADS, queue.length) }, worker)).then(() => {
        if (succeeded > 0 && failed === 0) {
          toast(`${succeeded} file${succeeded === 1 ? '' : 's'} uploaded`, 'success');
        } else if (failed > 0) {
          toast(`${failed} upload${failed === 1 ? '' : 's'} failed. See the upload panel for details.`, 'error');
        }
      });
    },
    [usage, patchTask, refresh, toast],
  );

  const cancelUpload = useCallback((id: number) => {
    cancelledIds.current.add(id);
    controllers.current.get(id)?.abort(); // stops an upload that is in progress
    setUploads((list) =>
      list.map((t) =>
        t.id === id && (t.status === 'queued' || t.status === 'uploading') ? { ...t, status: 'cancelled' } : t,
      ),
    );
  }, []);

  /** Cancels anything still running and empties the upload panel. */
  const clearUploads = useCallback(() => {
    setUploads((list) => {
      for (const t of list) cancelledIds.current.add(t.id);
      return [];
    });
    for (const c of controllers.current.values()) c.abort();
  }, []);

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
      cancelUpload,
      clearUploads,
    }),
    [version, refresh, viewMode, setViewMode, currentFolderId, usage, uploads, startUploads, cancelUpload, clearUploads],
  );
  return <DriveContext.Provider value={value}>{children}</DriveContext.Provider>;
}

export function useDrive(): DriveApi {
  const ctx = useContext(DriveContext);
  if (!ctx) throw new Error('useDrive must be used inside <DriveProvider>');
  return ctx;
}
