import { randomBytes } from 'node:crypto';
import type { ShareLink } from '@prisma/client';
import { prisma } from '../lib/db.js';
import { AppError, notFound } from '../lib/errors.js';
import type { PublicFileDTO, ShareDTO } from '../types.js';
import { buildDownloadUrl, buildPreview, getOwnedFile, type PreviewResult } from './fileService.js';

/*
 * Public share links ("Anyone with the link can view")
 * ----------------------------------------------------
 * - The owner creates a link for ONE file: /s/<token>. The token is 32 random
 *   bytes, so links cannot be guessed.
 * - Anyone with the link can preview the file in the browser without logging in.
 * - Downloading is only allowed if the owner turned on "Allow download".
 * - The link stops working while the file is in Trash, and is deleted when the
 *   file is deleted forever or the owner turns sharing off.
 */

function toShareDTO(link: ShareLink): ShareDTO {
  return { token: link.token, allowDownload: link.allowDownload, createdAt: link.createdAt.toISOString() };
}

export async function getShare(ownerId: string, fileId: string): Promise<ShareDTO | null> {
  const file = await getOwnedFile(ownerId, fileId, { allowTrashed: true });
  const link = await prisma.shareLink.findFirst({ where: { fileId: file.id, ownerId } });
  return link ? toShareDTO(link) : null;
}

/** Creates the link (or updates its settings if it already exists). */
export async function upsertShare(ownerId: string, fileId: string, allowDownload: boolean): Promise<ShareDTO> {
  const file = await getOwnedFile(ownerId, fileId); // cannot share a file that is in Trash
  const existing = await prisma.shareLink.findFirst({ where: { fileId: file.id, ownerId } });

  const link = existing
    ? await prisma.shareLink.update({ where: { id: existing.id }, data: { allowDownload } })
    : await prisma.shareLink.create({
        data: { token: randomBytes(32).toString('base64url'), fileId: file.id, ownerId, allowDownload },
      });
  await prisma.file.update({ where: { id: file.id }, data: { shared: true } });
  return toShareDTO(link);
}

export async function deleteShare(ownerId: string, fileId: string): Promise<void> {
  const file = await getOwnedFile(ownerId, fileId, { allowTrashed: true });
  await prisma.shareLink.deleteMany({ where: { fileId: file.id, ownerId } });
  await prisma.file.update({ where: { id: file.id }, data: { shared: false } });
}

/** Used when files are deleted forever. */
export async function deleteSharesForFiles(ownerId: string, fileIds: string[]): Promise<void> {
  if (fileIds.length === 0) return;
  await prisma.shareLink.deleteMany({ where: { ownerId, fileId: { in: fileIds } } });
}

// ---------- public side (no login) ----------

async function resolveToken(token: string) {
  const link = await prisma.shareLink.findUnique({ where: { token } });
  const file = link
    ? await prisma.file.findFirst({
        where: { id: link.fileId, ownerId: link.ownerId, trashedAt: null },
        include: { owner: { select: { name: true } } },
      })
    : null;
  // Same answer for "never existed", "turned off" and "in Trash".
  if (!link || !file) throw notFound('Shared file');
  return { link, file };
}

export async function getPublicFile(token: string): Promise<PublicFileDTO> {
  const { link, file } = await resolveToken(token);
  return {
    name: file.name,
    mimeType: file.mimeType,
    size: Number(file.size),
    createdAt: file.createdAt.toISOString(),
    ownerName: file.owner.name,
    allowDownload: link.allowDownload,
  };
}

export async function getPublicPreview(token: string): Promise<PreviewResult> {
  const { file } = await resolveToken(token);
  return buildPreview(file);
}

export async function getPublicDownload(token: string): Promise<{ url: string; expiresIn: number }> {
  const { link, file } = await resolveToken(token);
  if (!link.allowDownload) {
    throw new AppError(403, 'DOWNLOAD_DISABLED', 'The owner has not allowed downloading this file');
  }
  return buildDownloadUrl(file);
}
