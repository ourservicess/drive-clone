import { api, ApiError, SESSION_EXPIRED_EVENT, toApiError } from './client';
import type {
  Breadcrumb,
  FileItem,
  FolderItem,
  Preview,
  SortState,
  StorageUsage,
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

/**
 * Uploads one file. Uses XMLHttpRequest instead of fetch because fetch
 * cannot report upload progress.
 */
export function uploadFile(
  file: File,
  folderId: string | null,
  onProgress: (fraction: number) => void,
  signal: AbortSignal,
): Promise<FileItem> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/files/upload');
    xhr.withCredentials = true;
    xhr.responseType = 'json';

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve((xhr.response as { files: FileItem[] }).files[0]!);
      } else {
        const error = toApiError(xhr.status, xhr.response);
        if (error.code === 'UNAUTHENTICATED') window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
        reject(error);
      }
    };
    xhr.onerror = () => reject(new ApiError(0, 'NETWORK_ERROR', 'Upload failed: network error'));
    xhr.onabort = () => reject(new DOMException('Upload cancelled', 'AbortError'));
    signal.addEventListener('abort', () => xhr.abort());

    const form = new FormData();
    form.append('files', file);
    if (folderId) form.append('folderId', folderId);
    xhr.send(form);
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
