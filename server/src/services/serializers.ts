import type { File, Folder } from '@prisma/client';
import type { FileDTO, FolderDTO } from '../types.js';

export type FileWithOwner = File & { owner: { id: string; name: string; email: string } };

/** Prisma include that every file query uses, so DTOs always have the owner. */
export const fileInclude = { owner: { select: { id: true, name: true, email: true } } } as const;

// Note: storageKey is intentionally NOT included - the client never needs it.
export function toFileDTO(file: FileWithOwner): FileDTO {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: Number(file.size),
    folderId: file.folderId,
    starred: file.starred,
    createdAt: file.createdAt.toISOString(),
    updatedAt: file.updatedAt.toISOString(),
    lastAccessedAt: file.lastAccessedAt.toISOString(),
    trashedAt: file.trashedAt?.toISOString() ?? null,
    owner: file.owner,
  };
}

export function toFolderDTO(folder: Folder): FolderDTO {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parentId,
    createdAt: folder.createdAt.toISOString(),
    updatedAt: folder.updatedAt.toISOString(),
    trashedAt: folder.trashedAt?.toISOString() ?? null,
  };
}
