import { api, ApiError, SESSION_EXPIRED_EVENT, toApiError } from './client';
import type {
  Breadcrumb,
  FileItem,
  FolderItem,
  Preview,
  PublicFile,
  Share,
  SortState,
  StorageUsage,
  UploadRecord,
  User,
} from './types';

const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) search.set(k, v);
  const s = search.toString();
  return s ? `?${s}` : '';
};

// ---------- auth ----------
export const authApi = {
  me: () => api<{ user: User }>('/auth/me'),
  login: (email: string, password: string) =>
    api<{ user: User }>('/auth/login', { method: 'POST', json: { email, password } }),
  signup: (name: string, email: string, password: string) =>
    api<{ user: User }>('/auth/signup', { method: 'POST', json: { name, email, password } }),
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
};

// ---------- files ----------
export const filesApi = {
  list: (folderId: string | null, sort: SortState) =>
    api<{ files: FileItem[] }>(`/files${qs({ folderId, ...sort })}`),
  recent: () => api<{ files: FileItem[] }>('/files/recent'),
  starred: (sort: SortState) => api<{ files: FileItem[] }>(`/files/starred${qs({ ...sort })}`),
  search: (q: string, signal?: AbortSignal) =>
    api<{ files: FileItem[]; folders: FolderItem[] }>(`/files/search${qs({ q })}`, { signal }),
  get: (id: string) => api<{ file: FileItem }>(`/files/${id}`),
  download: (id: string) => api<{ url: string; expiresIn: number }>(`/files/${id}/download`),
  preview: (id: string) => api<Preview>(`/files/${id}/preview`),
  thumbnail: (id: string) => api<{ url: string | null }>(`/files/${id}/thumbnail`),
  update: (id: string, changes: { name?: string; folderId?: string | null }) =>
    api<{ file: FileItem }>(`/files/${id}`, { method: 'PATCH', json: changes }),
  star: (id: string, starred: boolean) =>
    api<{ file: FileItem }>(`/files/${id}/star`, { method: 'POST', json: { starred } }),
  trash: (id: string) => api<{ file: FileItem }>(`/files/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api<{ file: FileItem }>(`/files/${id}/restore`, { method: 'POST' }),
  deleteForever: (id: string) => api<{ ok: true }>(`/files/${id}/permanent`, { method: 'DELETE' }),
};

// ---------- sharing ----------
export const sharesApi = {
  get: (fileId: string) => api<{ share: Share | null }>(`/files/${fileId}/share`),
  /** Creates the public link, or changes its download setting. */
  save: (fileId: string, allowDownload: boolean) =>
    api<{ share: Share }>(`/files/${fileId}/share`, { method: 'POST', json: { allowDownload } }),
  remove: (fileId: string) => api<{ ok: true }>(`/files/${fileId}/share`, { method: 'DELETE' }),
};

/** No login needed: used by the public /s/:token page. */
export const publicApi = {
  file: (token: string) => api<{ file: PublicFile }>(`/public/${token}`),
  preview: (token: string) => api<Preview>(`/public/${token}/preview`),
  download: (token: string) => api<{ url: string; expiresIn: number }>(`/public/${token}/download`),
};

// ---------- resumable uploads ----------
export const uploadsApi = {
  list: () => api<{ uploads: UploadRecord[] }>('/uploads'),
  get: (id: string) => api<{ upload: UploadRecord }>(`/uploads/${id}`),
  create: (input: { name: string; size: number; folderId: string | null; lastModified: number }) =>
    api<{ upload: UploadRecord }>('/uploads', { method: 'POST', json: input }),
  complete: (id: string) =>
    api<{ upload: UploadRecord; file: FileItem | null }>(`/uploads/${id}/complete`, { method: 'POST' }),
  cancel: (id: string) => api<{ upload: UploadRecord }>(`/uploads/${id}/cancel`, { method: 'POST' }),
  remove: (id: string) => api<{ ok: true }>(`/uploads/${id}`, { method: 'DELETE' }),
  clearFinished: () => api<{ removed: number }>('/uploads', { method: 'DELETE' }),
};

/**
 * Sends one piece of a file. Uses XMLHttpRequest because fetch cannot report
 * upload progress. Network failures become ApiError(status 0, 'NETWORK_ERROR').
 */
export function sendChunk(
  uploadId: string,
  index: number,
  piece: Blob,
  onProgress: (loadedBytes: number) => void,
  signal: AbortSignal,
): Promise<{ receivedBytes: number }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/uploads/${uploadId}/chunks/${index}`);
    xhr.withCredentials = true;
    xhr.responseType = 'json';
    xhr.timeout = 5 * 60 * 1000; // a stalled connection counts as a network error
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(xhr.response as { receivedBytes: number });
      } else {
        const error = toApiError(xhr.status, xhr.response);
        if (error.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        reject(error);
      }
    };
    const networkError = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Connection lost'));
    xhr.onerror = networkError;
    xhr.ontimeout = networkError;
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    if (signal.aborted) return reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(piece);
  });
}

// ---------- folders ----------
export const foldersApi = {
  list: (parentId: string | null, sort: SortState) =>
    api<{ folders: FolderItem[] }>(`/folders${qs({ parentId, ...sort })}`),
  get: (id: string) => api<{ folder: FolderItem; breadcrumbs: Breadcrumb[] }>(`/folders/${id}`),
  create: (name: string, parentId: string | null) =>
    api<{ folder: FolderItem }>('/folders', { method: 'POST', json: { name, parentId } }),
  update: (id: string, changes: { name?: string; parentId?: string | null }) =>
    api<{ folder: FolderItem }>(`/folders/${id}`, { method: 'PATCH', json: changes }),
  trash: (id: string) => api<{ folder: FolderItem }>(`/folders/${id}`, { method: 'DELETE' }),
  restore: (id: string) => api<{ folder: FolderItem }>(`/folders/${id}/restore`, { method: 'POST' }),
  deleteForever: (id: string) => api<{ ok: true }>(`/folders/${id}/permanent`, { method: 'DELETE' }),
};

// ---------- trash & storage ----------
export const trashApi = {
  list: () => api<{ files: FileItem[]; folders: FolderItem[] }>('/trash'),
  empty: () => api<{ deletedFiles: number; deletedFolders: number }>('/trash', { method: 'DELETE' }),
};

export const storageApi = {
  usage: () => api<StorageUsage>('/storage/usage'),
};
