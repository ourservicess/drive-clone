import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { conflict, notFound } from '../lib/errors.js';
import { pickUniqueName } from '../lib/filename.js';
import { storage } from '../lib/storage.js';
import type { FileDTO, FolderDTO } from '../types.js';
import { getOwnedFile, takenFileNames } from './fileService.js';
import { collectDescendantFolderIds, getOwnedFolder, takenFolderNames } from './folderService.js';
import { fileInclude, toFileDTO, toFolderDTO } from './serializers.js';

/*
 * How Trash works
 * ---------------
 * - Deleting an item sets trashedAt = now and trashedExplicitly = true.
 * - Deleting a folder also marks everything inside it with the SAME trashedAt
 *   timestamp (trashedExplicitly = false). Those inner items are hidden from
 *   the Trash list; they travel together with their folder.
 * - Restoring a folder restores the items that share its timestamp. Items that
 *   were deleted on their own earlier keep their own timestamp and stay in Trash.
 * - If an item's original parent folder is still in Trash, it is restored to
 *   the top level of My Drive instead.
 * - Permanent deletion removes the R2 objects first, then the database documents.
 */

// ---------- files ----------

export async function trashFile(ownerId: string, id: string): Promise<FileDTO> {
  const file = await getOwnedFile(ownerId, id);
  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { trashedAt: new Date(), trashedExplicitly: true },
    include: fileInclude,
  });
  return toFileDTO(updated);
}

export async function restoreFile(ownerId: string, id: string): Promise<FileDTO> {
  const file = await prisma.file.findFirst({
    where: { id, ownerId, trashedAt: { not: null } },
    include: { folder: { select: { trashedAt: true } } },
  });
  if (!file) throw notFound('File in Trash');

  const folderId = file.folder && file.folder.trashedAt === null ? file.folderId : null;
  const name = pickUniqueName(file.name, await takenFileNames(ownerId, folderId, file.id));

  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { trashedAt: null, trashedExplicitly: false, folderId, name },
    include: fileInclude,
  });
  return toFileDTO(updated);
}

export async function deleteFilePermanently(ownerId: string, id: string): Promise<void> {
  const file = await getOwnedFile(ownerId, id, { allowTrashed: true });
  if (!file.trashedAt) {
    throw conflict('NOT_IN_TRASH', 'Move the file to Trash before deleting it forever');
  }
  // Storage first: if this fails, the DB row stays and the user can simply retry.
  await storage().deleteObjects([file.storageKey]);
  await prisma.file.delete({ where: { id: file.id } });
}

// ---------- folders ----------

export async function trashFolder(ownerId: string, id: string): Promise<FolderDTO> {
  const folder = await getOwnedFolder(ownerId, id);
  const descendants = await collectDescendantFolderIds(ownerId, id);
  const now = new Date();

  const [updated] = await prisma.$transaction([
    prisma.folder.update({
      where: { id },
      data: { trashedAt: now, trashedExplicitly: true },
    }),
    prisma.folder.updateMany({
      where: { ownerId, id: { in: descendants }, trashedAt: null },
      data: { trashedAt: now, trashedExplicitly: false },
    }),
    prisma.file.updateMany({
      where: { ownerId, folderId: { in: [folder.id, ...descendants] }, trashedAt: null },
      data: { trashedAt: now, trashedExplicitly: false },
    }),
  ]);
  return toFolderDTO(updated);
}

export async function restoreFolder(ownerId: string, id: string): Promise<FolderDTO> {
  const folder = await prisma.folder.findFirst({
    where: { id, ownerId, trashedAt: { not: null } },
    include: { parent: { select: { trashedAt: true } } },
  });
  if (!folder || !folder.trashedAt) throw notFound('Folder in Trash');

  const parentId = folder.parent && folder.parent.trashedAt === null ? folder.parentId : null;
  const name = pickUniqueName(folder.name, await takenFolderNames(ownerId, parentId, folder.id), true);
  const descendants = await collectDescendantFolderIds(ownerId, id);
  const deletedTogether = folder.trashedAt; // items trashed in the same action

  const [updated] = await prisma.$transaction([
    prisma.folder.update({
      where: { id },
      data: { trashedAt: null, trashedExplicitly: false, parentId, name },
    }),
    prisma.folder.updateMany({
      where: { ownerId, id: { in: descendants }, trashedAt: deletedTogether, trashedExplicitly: false },
      data: { trashedAt: null },
    }),
    prisma.file.updateMany({
      where: {
        ownerId,
        folderId: { in: [id, ...descendants] },
        trashedAt: deletedTogether,
        trashedExplicitly: false,
      },
      data: { trashedAt: null },
    }),
  ]);
  return toFolderDTO(updated);
}

export async function deleteFolderPermanently(ownerId: string, id: string): Promise<void> {
  const folder = await getOwnedFolder(ownerId, id, { allowTrashed: true });
  if (!folder.trashedAt) {
    throw conflict('NOT_IN_TRASH', 'Move the folder to Trash before deleting it forever');
  }
  const folderIds = [id, ...(await collectDescendantFolderIds(ownerId, id))];
  const files = await prisma.file.findMany({
    where: { ownerId, folderId: { in: folderIds } },
    select: { storageKey: true },
  });

  await storage().deleteObjects(files.map((f) => f.storageKey));
  // MongoDB has no cascading foreign keys, so remove the whole tree explicitly.
  await prisma.$transaction(deleteFoldersAndFiles(ownerId, { id: { in: folderIds } }, { folderId: { in: folderIds } }));
}

/**
 * Prisma (on MongoDB) refuses to delete a folder while another folder still
 * points to it as parent, even if both are deleted together. So: delete the
 * files, detach the folders from their parents, then delete the folders.
 */
function deleteFoldersAndFiles(
  ownerId: string,
  folderWhere: Prisma.FolderWhereInput,
  fileWhere: Prisma.FileWhereInput,
): [BatchOp, BatchOp, BatchOp] {
  return [
    prisma.file.deleteMany({ where: { ownerId, ...fileWhere } }),
    prisma.folder.updateMany({ where: { ownerId, ...folderWhere }, data: { parentId: null } }),
    prisma.folder.deleteMany({ where: { ownerId, ...folderWhere } }),
  ];
}
type BatchOp = Prisma.PrismaPromise<Prisma.BatchPayload>;

// ---------- the Trash view ----------

export async function listTrash(ownerId: string): Promise<{ files: FileDTO[]; folders: FolderDTO[] }> {
  const [files, folders] = await Promise.all([
    prisma.file.findMany({
      where: { ownerId, trashedAt: { not: null }, trashedExplicitly: true },
      orderBy: { trashedAt: 'desc' },
      include: fileInclude,
    }),
    prisma.folder.findMany({
      where: { ownerId, trashedAt: { not: null }, trashedExplicitly: true },
      orderBy: { trashedAt: 'desc' },
    }),
  ]);
  return { files: files.map(toFileDTO), folders: folders.map(toFolderDTO) };
}

export async function emptyTrash(ownerId: string): Promise<{ deletedFiles: number; deletedFolders: number }> {
  const files = await prisma.file.findMany({
    where: { ownerId, trashedAt: { not: null } },
    select: { storageKey: true },
  });
  await storage().deleteObjects(files.map((f) => f.storageKey));

  const trashed = { trashedAt: { not: null } };
  const [deletedFiles, , deletedFolders] = await prisma.$transaction(
    deleteFoldersAndFiles(ownerId, trashed, trashed),
  );
  return { deletedFiles: deletedFiles.count, deletedFolders: deletedFolders.count };
}
