import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import type { Upload } from '@prisma/client';
import { env } from '../env.js';
import { prisma } from '../lib/db.js';
import { AppError, notFound } from '../lib/errors.js';
import { pickUniqueName, sanitizeName } from '../lib/filename.js';
import { mimeTypeFor } from '../lib/mime.js';
import { PartSizeError, storage } from '../lib/storage.js';
import type { FileDTO, UploadDTO } from '../types.js';
import { getOwnedFile, storageUsage } from './fileService.js';
import { resolveDestination } from './folderService.js';
import { fileInclude, toFileDTO } from './serializers.js';

/*
 * Resumable uploads
 * -----------------
 * 1. POST   /api/uploads                  -> creates an Upload record (checks type, size, quota, folder)
 * 2. PUT    /api/uploads/:id/chunks/:n    -> sends piece n (pieces must arrive in order)
 *    If the connection drops, the browser asks GET /api/uploads/:id for
 *    receivedBytes and continues from the next missing piece.
 * 3. POST   /api/uploads/:id/complete     -> joins the pieces and creates the File
 *
 * Upload records stay afterwards and form the user's upload history.
 */

export function toUploadDTO(u: Upload): UploadDTO {
  return {
    id: u.id,
    name: u.name,
    mimeType: u.mimeType,
    size: Number(u.size),
    receivedBytes: Number(u.receivedBytes),
    chunkSize: u.chunkSize,
    status: u.status,
    folderId: u.folderId,
    fileId: u.fileId,
    fingerprint: u.fingerprint,
    error: u.error,
    createdAt: u.createdAt.toISOString(),
    updatedAt: u.updatedAt.toISOString(),
    completedAt: u.completedAt?.toISOString() ?? null,
  };
}

async function getOwnedUpload(ownerId: string, id: string): Promise<Upload> {
  const upload = await prisma.upload.findFirst({ where: { id, ownerId } });
  if (!upload) throw notFound('Upload');
  return upload;
}

function assertActive(upload: Upload) {
  if (upload.status !== 'uploading') {
    throw new AppError(409, 'UPLOAD_NOT_ACTIVE', `This upload is ${upload.status} and cannot continue`);
  }
}

/** Bytes promised to uploads that are still in progress (they count towards the quota). */
async function reservedBytes(ownerId: string): Promise<number> {
  const result = await prisma.upload.aggregate({
    where: { ownerId, status: 'uploading' },
    _sum: { size: true },
  });
  return Number(result._sum.size ?? 0n);
}

export async function createUpload(
  ownerId: string,
  input: { name: string; size: number; folderId?: string | null; lastModified?: number },
): Promise<UploadDTO> {
  const name = sanitizeName(input.name);
  const mimeType = mimeTypeFor(name); // decided by the server, not the browser
  if (!mimeType) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', `"${name}" is not an allowed file type`);
  if (input.size > env.maxUploadBytes) {
    throw new AppError(413, 'FILE_TOO_LARGE', `"${name}" is larger than ${env.MAX_UPLOAD_MB} MB`);
  }

  const folderId = await resolveDestination(ownerId, input.folderId);

  const [{ used }, reserved] = await Promise.all([storageUsage(ownerId), reservedBytes(ownerId)]);
  if (used + reserved + input.size > env.storageQuotaBytes) {
    throw new AppError(507, 'QUOTA_EXCEEDED', 'Not enough storage space. Empty your Trash or delete some files.');
  }

  // The storage key is generated here - never derived from user input.
  const storageKey = `users/${ownerId}/${randomUUID()}`;
  let multipartId: string | null;
  try {
    multipartId = await storage().startMultipart(storageKey, mimeType);
  } catch (err) {
    console.error('Could not start upload in storage:', err);
    throw new AppError(502, 'STORAGE_ERROR', 'Could not start the upload. Please try again.');
  }

  const upload = await prisma.upload.create({
    data: {
      ownerId,
      name,
      mimeType,
      size: BigInt(input.size),
      folderId,
      storageKey,
      multipartId,
      chunkSize: env.uploadChunkBytes,
      receivedBytes: 0n,
      status: 'uploading',
      fingerprint: `${input.size}:${input.lastModified ?? ''}:${input.name}`.slice(0, 1100),
      fileId: null,
      error: null,
      completedAt: null,
    },
  });
  return toUploadDTO(upload);
}

export async function listUploads(ownerId: string): Promise<UploadDTO[]> {
  const uploads = await prisma.upload.findMany({
    where: { ownerId },
    orderBy: { createdAt: 'desc' },
    take: 200,
  });
  return uploads.map(toUploadDTO);
}

export async function getUpload(ownerId: string, id: string): Promise<UploadDTO> {
  return toUploadDTO(await getOwnedUpload(ownerId, id));
}

/** Receives piece number `index`. Returns how many bytes the server now has. */
export async function receiveChunk(
  ownerId: string,
  id: string,
  index: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<{ receivedBytes: number }> {
  const upload = await getOwnedUpload(ownerId, id);
  assertActive(upload);

  const size = Number(upload.size);
  const received = Number(upload.receivedBytes);
  const expectedIndex = Math.floor(received / upload.chunkSize);
  if (index !== expectedIndex || received >= size) {
    // E.g. the browser re-sent a piece whose reply got lost. It reads
    // details.receivedBytes and continues from the right place.
    throw new AppError(409, 'UPLOAD_OUT_OF_SYNC', `Expected piece ${expectedIndex}`, { receivedBytes: received });
  }

  const offset = index * upload.chunkSize;
  const length = Math.min(upload.chunkSize, size - offset);
  const stream = body ? Readable.fromWeb(body as NodeReadableStream<Uint8Array>) : Readable.from([]);

  try {
    await storage().putPart(upload.storageKey, upload.multipartId, index, offset, length, stream);
  } catch (err) {
    // A short piece or a dropped connection is normal on bad networks: the
    // browser simply sends this piece again, so it is not logged as an error.
    const dropped = (err as { code?: string }).code === 'ECONNRESET' || (err as Error).message === 'aborted';
    if (err instanceof PartSizeError || dropped) {
      throw new AppError(400, 'CHUNK_INCOMPLETE', 'This piece did not arrive completely. Please send it again.');
    }
    console.error('Storing upload piece failed:', err);
    throw new AppError(502, 'STORAGE_ERROR', 'Could not save this piece. Please try again.');
  }

  // Only advance if nobody else advanced it in the meantime.
  const updated = await prisma.upload.updateMany({
    where: { id, ownerId, status: 'uploading', receivedBytes: BigInt(offset) },
    data: { receivedBytes: BigInt(offset + length) },
  });
  if (updated.count === 0) {
    const current = await getOwnedUpload(ownerId, id);
    throw new AppError(409, 'UPLOAD_OUT_OF_SYNC', 'The upload changed while this piece was sent', {
      receivedBytes: Number(current.receivedBytes),
    });
  }
  return { receivedBytes: offset + length };
}

/**
 * Joins all pieces and creates the File. Safe to call again (e.g. if the reply
 * was lost): a completed upload just returns its file.
 */
export async function completeUpload(
  ownerId: string,
  id: string,
): Promise<{ upload: UploadDTO; file: FileDTO | null }> {
  const upload = await getOwnedUpload(ownerId, id);

  if (upload.status === 'completed') {
    const file = upload.fileId ? await getOwnedFile(ownerId, upload.fileId).catch(() => null) : null;
    return { upload: toUploadDTO(upload), file: file ? toFileDTO(file) : null };
  }
  assertActive(upload);

  const size = Number(upload.size);
  if (Number(upload.receivedBytes) !== size) {
    throw new AppError(409, 'UPLOAD_INCOMPLETE', 'Some pieces of the file are still missing', {
      receivedBytes: Number(upload.receivedBytes),
    });
  }

  const partCount = Math.ceil(size / upload.chunkSize);
  try {
    await storage().completeMultipart(upload.storageKey, upload.multipartId, partCount, upload.mimeType);
  } catch (err) {
    console.error('Completing upload in storage failed:', err);
    throw new AppError(502, 'STORAGE_ERROR', 'Could not finish the upload. Please try again.');
  }

  // If the destination folder was deleted meanwhile, put the file in My Drive.
  const folderId = upload.folderId ? await resolveDestination(ownerId, upload.folderId).catch(() => null) : null;

  const [file, finished] = await prisma.$transaction(async (tx) => {
    const taken = (
      await tx.file.findMany({ where: { ownerId, folderId, trashedAt: null }, select: { name: true } })
    ).map((r) => r.name);
    const created = await tx.file.create({
      data: {
        name: pickUniqueName(upload.name, taken), // "photo.jpg" -> "photo (1).jpg"
        mimeType: upload.mimeType,
        size: upload.size,
        storageKey: upload.storageKey,
        ownerId,
        folderId,
        trashedAt: null, // explicit null (MongoDB: missing field ≠ null)
      },
      include: fileInclude,
    });
    const done = await tx.upload.update({
      where: { id: upload.id },
      data: { status: 'completed', fileId: created.id, completedAt: new Date() },
    });
    return [created, done] as const;
  });

  return { upload: toUploadDTO(finished), file: toFileDTO(file) };
}

/** Stops an upload in progress and deletes the pieces received so far. */
export async function cancelUpload(ownerId: string, id: string): Promise<UploadDTO> {
  const upload = await getOwnedUpload(ownerId, id);
  if (upload.status !== 'uploading') return toUploadDTO(upload);
  await storage().abortMultipart(upload.storageKey, upload.multipartId);
  const cancelled = await prisma.upload.update({ where: { id }, data: { status: 'cancelled' } });
  return toUploadDTO(cancelled);
}

/** Removes one entry from the history (cancelling it first if still running). */
export async function removeUpload(ownerId: string, id: string): Promise<void> {
  const upload = await getOwnedUpload(ownerId, id);
  if (upload.status === 'uploading') await cancelUpload(ownerId, id);
  await prisma.upload.delete({ where: { id } });
}

/** Clears finished entries (completed, cancelled, failed, expired) from the history. */
export async function clearFinishedUploads(ownerId: string): Promise<{ removed: number }> {
  const result = await prisma.upload.deleteMany({ where: { ownerId, status: { not: 'uploading' } } });
  return { removed: result.count };
}

/** Housekeeping: abandon uploads with no progress for UPLOAD_EXPIRY_DAYS. */
export async function expireStaleUploads(): Promise<number> {
  const stale = await prisma.upload.findMany({
    where: { status: 'uploading', updatedAt: { lt: new Date(Date.now() - env.uploadExpiryMs) } },
    take: 500,
  });
  for (const upload of stale) {
    await storage()
      .abortMultipart(upload.storageKey, upload.multipartId)
      .catch((err) => console.error('Could not delete stale upload data:', err));
    await prisma.upload.update({
      where: { id: upload.id },
      data: { status: 'expired', error: 'No progress for too long; the partial upload was deleted.' },
    });
  }
  return stale.length;
}
