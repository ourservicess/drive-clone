import type { Prisma } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../lib/db.js';
import { notFound } from '../lib/errors.js';
import { pickUniqueName, sanitizeName } from '../lib/filename.js';
import { previewKindFor, type PreviewKind } from '../lib/mime.js';
import { storage } from '../lib/storage.js';
import type { SortOptions } from '../schemas/index.js';
import type { FileDTO, FolderDTO } from '../types.js';
import { resolveDestination, getOwnedFolder } from './folderService.js';
import { fileInclude, toFileDTO, toFolderDTO, type FileWithOwner } from './serializers.js';

const DOWNLOAD_URL_TTL_SECONDS = 60;
const PREVIEW_URL_TTL_SECONDS = 5 * 60;
const TEXT_PREVIEW_MAX_BYTES = 1024 * 1024;

/** Loads a file owned by ownerId, or throws 404 (also for other users' files). */
export async function getOwnedFile(
  ownerId: string,
  id: string,
  { allowTrashed = false } = {},
): Promise<FileWithOwner> {
  const file = await prisma.file.findFirst({
    where: { id, ownerId, ...(allowTrashed ? {} : { trashedAt: null }) },
    include: fileInclude,
  });
  if (!file) throw notFound('File');
  return file;
}

export async function takenFileNames(
  ownerId: string,
  folderId: string | null,
  excludeId?: string,
): Promise<string[]> {
  const rows = await prisma.file.findMany({
    where: { ownerId, folderId, trashedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { name: true },
  });
  return rows.map((r) => r.name);
}

function fileOrderBy(sort: SortOptions): Prisma.FileOrderByWithRelationInput[] {
  if (sort.sort === 'date') return [{ createdAt: sort.order }, { name: 'asc' }];
  if (sort.sort === 'size') return [{ size: sort.order }, { name: 'asc' }];
  return [{ name: sort.order }];
}

export async function listFiles(
  ownerId: string,
  folderId: string | null,
  sort: SortOptions,
): Promise<FileDTO[]> {
  if (folderId) await getOwnedFolder(ownerId, folderId);
  const files = await prisma.file.findMany({
    where: { ownerId, folderId, trashedAt: null },
    orderBy: fileOrderBy(sort),
    include: fileInclude,
  });
  return files.map(toFileDTO);
}

export async function searchItems(
  ownerId: string,
  q: string,
): Promise<{ files: FileDTO[]; folders: FolderDTO[] }> {
  // On MongoDB, Prisma turns `contains` into a regular expression WITHOUT
  // escaping it, so characters like "(" or "." must be escaped first.
  const literal = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nameFilter = { contains: literal, mode: 'insensitive' as const };
  const [files, folders] = await Promise.all([
    prisma.file.findMany({
      where: { ownerId, trashedAt: null, name: nameFilter },
      orderBy: { name: 'asc' },
      take: 100,
      include: fileInclude,
    }),
    prisma.folder.findMany({
      where: { ownerId, trashedAt: null, name: nameFilter },
      orderBy: { name: 'asc' },
      take: 50,
    }),
  ]);
  return { files: files.map(toFileDTO), folders: folders.map(toFolderDTO) };
}

export async function recentFiles(ownerId: string): Promise<FileDTO[]> {
  const files = await prisma.file.findMany({
    where: { ownerId, trashedAt: null },
    orderBy: { lastAccessedAt: 'desc' },
    take: 50,
    include: fileInclude,
  });
  return files.map(toFileDTO);
}

export async function starredFiles(ownerId: string, sort: SortOptions): Promise<FileDTO[]> {
  const files = await prisma.file.findMany({
    where: { ownerId, trashedAt: null, starred: true },
    orderBy: fileOrderBy(sort),
    include: fileInclude,
  });
  return files.map(toFileDTO);
}

export async function storageUsage(
  ownerId: string,
): Promise<{ used: number; quota: number; fileCount: number; maxUploadBytes: number | null }> {
  const result = await prisma.file.aggregate({
    where: { ownerId }, // files in Trash still count, like Google Drive
    _sum: { size: true },
    _count: true,
  });
  return {
    used: Number(result._sum.size ?? 0n),
    quota: env.storageQuotaBytes,
    fileCount: result._count,
    // Lets the UI reject too-large files before uploading; null = no per-file limit.
    maxUploadBytes: Number.isFinite(env.maxUploadBytes) ? env.maxUploadBytes : null,
  };
}

export async function updateFile(
  ownerId: string,
  id: string,
  changes: { name?: string; folderId?: string | null },
): Promise<FileDTO> {
  const file = await getOwnedFile(ownerId, id);

  const folderId =
    changes.folderId !== undefined ? await resolveDestination(ownerId, changes.folderId) : file.folderId;
  const desired = changes.name !== undefined ? sanitizeName(changes.name) : file.name;
  const name = pickUniqueName(desired, await takenFileNames(ownerId, folderId, id));

  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { name, folderId },
    include: fileInclude,
  });
  return toFileDTO(updated);
}

export async function setStarred(ownerId: string, id: string, starred: boolean): Promise<FileDTO> {
  const file = await getOwnedFile(ownerId, id);
  const updated = await prisma.file.update({
    where: { id: file.id },
    data: { starred },
    include: fileInclude,
  });
  return toFileDTO(updated);
}

async function touch(fileId: string) {
  await prisma.file.update({ where: { id: fileId }, data: { lastAccessedAt: new Date() } });
}

/** A short-lived URL that downloads the file directly from private R2. */
export async function getDownloadUrl(
  ownerId: string,
  id: string,
): Promise<{ url: string; expiresIn: number }> {
  const file = await getOwnedFile(ownerId, id);
  const link = await buildDownloadUrl(file);
  await touch(file.id);
  return link;
}

/**
 * Short-lived inline URL for showing an image thumbnail in the grid.
 * Unlike preview, this does not count as "opening" the file for Recent.
 */
export async function getThumbnailUrl(ownerId: string, id: string): Promise<{ url: string | null }> {
  const file = await getOwnedFile(ownerId, id);
  if (previewKindFor(file.mimeType) !== 'image') return { url: null };
  const url = await storage().getSignedDownloadUrl(file.storageKey, {
    filename: file.name,
    contentType: file.mimeType,
    inline: true,
    expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
  });
  return { url };
}

export type PreviewResult =
  | { kind: Exclude<PreviewKind, 'text' | 'none'>; url: string; expiresIn: number }
  | { kind: 'text'; content: string; truncated: boolean }
  | { kind: 'none' };

export async function getPreview(ownerId: string, id: string): Promise<PreviewResult> {
  const file = await getOwnedFile(ownerId, id);
  await touch(file.id);
  return buildPreview(file);
}

type StoredFile = { storageKey: string; name: string; mimeType: string };

/** Short-lived download link (always "attachment", so nothing runs in the browser). */
export async function buildDownloadUrl(file: StoredFile): Promise<{ url: string; expiresIn: number }> {
  const url = await storage().getSignedDownloadUrl(file.storageKey, {
    filename: file.name,
    contentType: file.mimeType,
    inline: false,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
  return { url, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
}

/** Builds what the viewer needs to show a file (used by the owner AND by public share links). */
export async function buildPreview(file: StoredFile): Promise<PreviewResult> {
  const kind = previewKindFor(file.mimeType);
  if (kind === 'none') return { kind };

  if (kind === 'text') {
    // Text (including HTML/SVG source) is returned as plain text and the
    // frontend shows it inside <pre>, so it is displayed, never executed.
    const bytes = await storage().readObjectStart(file.storageKey, TEXT_PREVIEW_MAX_BYTES + 1);
    const truncated = bytes.length > TEXT_PREVIEW_MAX_BYTES;
    const content = new TextDecoder('utf-8').decode(bytes.subarray(0, TEXT_PREVIEW_MAX_BYTES));
    return { kind, content, truncated };
  }

  const url = await storage().getSignedDownloadUrl(file.storageKey, {
    filename: file.name,
    contentType: file.mimeType,
    inline: true, // only for types previewKindFor() considers safe
    expiresInSeconds: PREVIEW_URL_TTL_SECONDS,
  });
  return { kind, url, expiresIn: PREVIEW_URL_TTL_SECONDS };
}
