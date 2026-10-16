// These types mirror the JSON returned by the server (server/src/types.ts).

export interface User {
  id: string;
  email: string;
  name: string;
}

export interface FileItem {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  folderId: string | null;
  starred: boolean;
  /** true = a public "anyone with the link" share link exists */
  shared: boolean;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  trashedAt: string | null;
  owner: User;
}

export interface FolderItem {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}

export interface Breadcrumb {
  id: string;
  name: string;
}

export type SortField = 'name' | 'date' | 'size';
export type SortOrder = 'asc' | 'desc';
export interface SortState {
  sort: SortField;
  order: SortOrder;
}

export type Preview =
  | { kind: 'image' | 'pdf' | 'video' | 'audio'; url: string; expiresIn: number }
  | { kind: 'text'; content: string; truncated: boolean }
  | { kind: 'none' };

export interface StorageUsage {
  used: number;
  quota: number;
  fileCount: number;
  /** null = no per-file size limit */
  maxUploadBytes: number | null;
}

export type UploadStatus = 'uploading' | 'completed' | 'cancelled' | 'failed' | 'expired';

/** One entry in the upload history, as stored on the server. */
export interface UploadRecord {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  receivedBytes: number;
  chunkSize: number;
  status: UploadStatus;
  folderId: string | null;
  fileId: string | null;
  /** "size:lastModified:name" - used to check the same file is picked when resuming */
  fingerprint: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

export interface Share {
  token: string;
  allowDownload: boolean;
  createdAt: string;
}

/** What a visitor of a public link sees about the file. */
export interface PublicFile {
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  ownerName: string;
  allowDownload: boolean;
}

/** Either a file or a folder, used by the shared file browser. */
export type DriveItem = { type: 'file'; item: FileItem } | { type: 'folder'; item: FolderItem };
