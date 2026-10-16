import type { AuthUser } from './lib/session.js';

/** Variables that middleware stores on the Hono context (c.get('user')). */
export type AppEnv = {
  Variables: {
    user: AuthUser;
    sessionId: string;
  };
};

/** What the API returns for a file. size is a plain number (bytes). */
export interface FileDTO {
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
  owner: { id: string; name: string; email: string };
}

export type UploadStatusDTO = 'uploading' | 'completed' | 'cancelled' | 'failed' | 'expired';

/** One entry in the upload history (also used to resume an upload). */
export interface UploadDTO {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  receivedBytes: number;
  chunkSize: number;
  status: UploadStatusDTO;
  folderId: string | null;
  fileId: string | null;
  fingerprint: string;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}

/** Public info about a shared file (no ids, keys or owner email). */
export interface PublicFileDTO {
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
  ownerName: string;
  allowDownload: boolean;
}

export interface ShareDTO {
  token: string;
  allowDownload: boolean;
  createdAt: string;
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}
