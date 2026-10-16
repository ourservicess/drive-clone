import type { Folder, Prisma } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { AppError, notFound } from '../lib/errors.js';
import { pickUniqueName, sanitizeName } from '../lib/filename.js';
import type { SortOptions } from '../schemas/index.js';
import type { FolderDTO } from '../types.js';
import { toFolderDTO } from './serializers.js';

/**
 * Loads a folder that belongs to ownerId. If the folder does not exist OR is
 * owned by someone else we answer "not found" (404) - we never confirm that
 * another user's id exists. This is the core IDOR protection.
 */
export async function getOwnedFolder(
  ownerId: string,
  id: string,
  { allowTrashed = false } = {},
): Promise<Folder> {
  const folder = await prisma.folder.findFirst({
    where: { id, ownerId, ...(allowTrashed ? {} : { trashedAt: null }) },
  });
  if (!folder) throw notFound('Folder');
  return folder;
}

/** Checks that a destination folder (or null = My Drive root) is usable. */
export async function resolveDestination(
  ownerId: string,
  folderId: string | null | undefined,
): Promise<string | null> {
  if (!folderId) return null;
  await getOwnedFolder(ownerId, folderId); // must exist, be ours, and not be in Trash
  return folderId;
}

export async function takenFolderNames(
  ownerId: string,
  parentId: string | null,
  excludeId?: string,
): Promise<string[]> {
  const rows = await prisma.folder.findMany({
    where: { ownerId, parentId, trashedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

/** Returns the ids of ALL folders below rootId (children, grandchildren, ...). */
export async function collectDescendantFolderIds(ownerId: string, rootId: string): Promise<string[]> {
  const result: string[] = [];
  let frontier = [rootId];
  while (frontier.length > 0) {
    const children = await prisma.folder.findMany({
      where: { ownerId, parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id);
    result.push(...frontier);
  }
  return result;
}

function folderOrderBy(sort: SortOptions): Prisma.FolderOrderByWithRelationInput[] {
  // Folders have no size, so "size" sorting falls back to name.
  if (sort.sort === 'date') return [{ createdAt: sort.order }, { name: 'asc' }];
  return [{ name: sort.sort === 'name' ? sort.order : 'asc' }];
}

export async function listFolders(
  ownerId: string,
  parentId: string | null,
  sort: SortOptions,
): Promise<FolderDTO[]> {
  if (parentId) await getOwnedFolder(ownerId, parentId);
  const folders = await prisma.folder.findMany({
    where: { ownerId, parentId, trashedAt: null },
    orderBy: folderOrderBy(sort),
  });
  return folders.map(toFolderDTO);
}

export interface Breadcrumb {
  id: string;
  name: string;
}

/** A folder plus the path from the top of My Drive down to it. */
export async function getFolderDetails(
  ownerId: string,
  id: string,
): Promise<{ folder: FolderDTO; breadcrumbs: Breadcrumb[] }> {
  const folder = await getOwnedFolder(ownerId, id);
  const breadcrumbs: Breadcrumb[] = [{ id: folder.id, name: folder.name }];

  let parentId = folder.parentId;
  for (let depth = 0; parentId && depth < 100; depth++) {
    const parent = await prisma.folder.findFirst({ where: { id: parentId, ownerId } });
    if (!parent) break;
    breadcrumbs.unshift({ id: parent.id, name: parent.name });
    parentId = parent.parentId;
  }
  return { folder: toFolderDTO(folder), breadcrumbs };
}

export async function createFolder(
  ownerId: string,
  rawName: string,
  parentId: string | null | undefined,
): Promise<FolderDTO> {
  const parent = await resolveDestination(ownerId, parentId);
  const name = pickUniqueName(sanitizeName(rawName), await takenFolderNames(ownerId, parent), true);
  // trashedAt is set to null explicitly: in MongoDB a missing field does not match `trashedAt: null`.
  const folder = await prisma.folder.create({ data: { name, ownerId, parentId: parent, trashedAt: null } });
  return toFolderDTO(folder);
}

/** Throws if `targetId` is `folderId` itself or one of its subfolders. */
async function assertNotInsideItself(ownerId: string, folderId: string, targetId: string) {
  let current: string | null = targetId;
  for (let depth = 0; current && depth < 1000; depth++) {
    if (current === folderId) {
      throw new AppError(400, 'INVALID_MOVE', 'A folder cannot be moved into itself or one of its subfolders');
    }
    const row: { parentId: string | null } | null = await prisma.folder.findFirst({
      where: { id: current, ownerId },
      select: { parentId: true },
    });
    current = row?.parentId ?? null;
  }
}

export async function updateFolder(
  ownerId: string,
  id: string,
  changes: { name?: string; parentId?: string | null },
): Promise<FolderDTO> {
  const folder = await getOwnedFolder(ownerId, id);

  let parentId = folder.parentId;
  if (changes.parentId !== undefined) {
    parentId = await resolveDestination(ownerId, changes.parentId);
    if (parentId) await assertNotInsideItself(ownerId, id, parentId);
  }

  const desired = changes.name !== undefined ? sanitizeName(changes.name) : folder.name;
  const name = pickUniqueName(desired, await takenFolderNames(ownerId, parentId, id), true);

  const updated = await prisma.folder.update({ where: { id }, data: { name, parentId } });
  return toFolderDTO(updated);
}
