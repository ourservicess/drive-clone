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
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
  trashedAt: string | null;
  owner: { id: string; name: string; email: string };
}

export interface FolderDTO {
  id: string;
  name: string;
  parentId: string | null;
  createdAt: string;
  updatedAt: string;
  trashedAt: string | null;
}
