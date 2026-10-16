import { randomUUID } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import busboy from 'busboy';
import { env } from '../env.js';
import { prisma } from '../lib/db.js';
import { AppError, badRequest } from '../lib/errors.js';
import { pickUniqueName, sanitizeName } from '../lib/filename.js';
import { mimeTypeFor } from '../lib/mime.js';
import { storage } from '../lib/storage.js';
import { idSchema } from '../schemas/index.js';
import type { FileDTO } from '../types.js';
import { storageUsage } from './fileService.js';
import { resolveDestination } from './folderService.js';
import { fileInclude, toFileDTO, type FileWithOwner } from './serializers.js';

export const MAX_FILES_PER_REQUEST = 20;

interface IncomingFile {
  name: string;
  mimeType: string;
  storageKey: string;
  size: number;
  saved: boolean;
}

const quotaError = () =>
  new AppError(507, 'QUOTA_EXCEEDED', 'Not enough storage space. Empty your Trash or delete some files.');

/**
 * Handles a multipart upload (form fields: "files" = one or more files,
 * optional "folderId") WITHOUT loading files into memory:
 *
 *   browser ──► busboy (splits the request into files) ──► size/quota check ──► storage
 *
 * Each file is streamed to storage as it arrives, so files of any size work.
 * All-or-nothing: if anything fails (bad type, quota, storage error, invalid
 * folder...), every file already saved from this request is deleted again.
 */
export async function uploadFromMultipart(
  ownerId: string,
  contentType: string | undefined,
  body: ReadableStream<Uint8Array> | null,
): Promise<FileDTO[]> {
  if (!contentType?.toLowerCase().startsWith('multipart/form-data') || !body) {
    throw badRequest('Uploads must be sent as multipart/form-data');
  }

  let parser: busboy.Busboy;
  try {
    parser = busboy({
      headers: { 'content-type': contentType },
      defParamCharset: 'utf8', // keep non-English filenames (e.g. "résumé.pdf") intact
      limits: { files: MAX_FILES_PER_REQUEST, fields: 10, fieldSize: 1024 },
    });
  } catch {
    throw badRequest('Malformed upload request');
  }

  const { used } = await storageUsage(ownerId);
  let remainingQuota = env.storageQuotaBytes - used;

  const files: IncomingFile[] = [];
  const writes: Promise<void>[] = [];
  let folderField: string | undefined;
  let failure: unknown = null;
  const fail = (err: unknown) => {
    failure ??= err; // keep the FIRST error; it is the one worth reporting
  };

  parser.on('field', (name, value) => {
    if (name === 'folderId') folderField = value;
  });

  parser.on('filesLimit', () => fail(badRequest(`You can upload at most ${MAX_FILES_PER_REQUEST} files at once`)));

  parser.on('file', (field, stream, info) => {
    // After a failure (or for unexpected fields) just skip the data.
    if (failure || field !== 'files') {
      stream.resume();
      return;
    }

    let file: IncomingFile;
    try {
      const name = sanitizeName(info.filename ?? '');
      const mimeType = mimeTypeFor(name); // decided by the server, not the browser
      if (!mimeType) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', `"${name}" is not an allowed file type`);
      // The storage key is generated here - never derived from user input.
      file = { name, mimeType, storageKey: `users/${ownerId}/${randomUUID()}`, size: 0, saved: false };
    } catch (err) {
      fail(err);
      stream.resume();
      return;
    }
    files.push(file);

    // Counts bytes as they pass through and stops the upload as soon as a
    // limit is crossed (no need to wait for a huge file to finish).
    let limitError: AppError | null = null;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        file.size += chunk.length;
        remainingQuota -= chunk.length;
        if (file.size > env.maxUploadBytes) {
          limitError = new AppError(413, 'FILE_TOO_LARGE', `"${file.name}" is larger than ${env.MAX_UPLOAD_MB} MB`);
        } else if (remainingQuota < 0) {
          limitError = quotaError();
        }
        done(limitError, limitError ? undefined : chunk);
      },
    });

    // If saving stops early, keep reading (and discarding) the rest of this
    // file so the parser can reach the end of the request.
    const drain = () => {
      stream.unpipe(limiter);
      stream.resume();
    };
    limiter.on('error', drain);
    stream.pipe(limiter);

    writes.push(
      storage()
        .putObject(file.storageKey, limiter, file.mimeType)
        .then(
          () => {
            file.saved = true;
          },
          (err) => {
            drain();
            if (limitError) return fail(limitError);
            if (err instanceof AppError) return fail(err);
            // Log the real reason (e.g. wrong R2 keys, disk full) on the server only.
            console.error('Storage upload failed:', err);
            fail(new AppError(502, 'STORAGE_ERROR', 'Could not save the file to storage. Please try again.'));
          },
        ),
    );
  });

  try {
    // Feed the request body into the parser; resolves when the whole request is read.
    await pipeline(Readable.fromWeb(body as NodeReadableStream<Uint8Array>), parser).catch(() =>
      fail(badRequest('The upload was interrupted or malformed')),
    );
    await Promise.all(writes);

    if (failure) throw failure;
    if (files.length === 0) throw badRequest('No files were uploaded');

    let folderId: string | null = null;
    if (folderField) {
      const parsed = idSchema.safeParse(folderField);
      if (!parsed.success) throw badRequest('Invalid folderId');
      folderId = parsed.data;
    }
    const targetFolder = await resolveDestination(ownerId, folderId); // must be ours and not in Trash

    const created = await prisma.$transaction(async (tx) => {
      const taken = (
        await tx.file.findMany({
          where: { ownerId, folderId: targetFolder, trashedAt: null },
          select: { name: true },
        })
      ).map((r) => r.name);

      const rows: FileWithOwner[] = [];
      for (const f of files) {
        const name = pickUniqueName(f.name, taken); // "photo.jpg" -> "photo (1).jpg"
        taken.push(name);
        rows.push(
          await tx.file.create({
            data: {
              name,
              mimeType: f.mimeType,
              size: BigInt(f.size),
              storageKey: f.storageKey,
              ownerId,
              folderId: targetFolder,
              trashedAt: null, // explicit null (MongoDB: missing field ≠ null)
            },
            include: fileInclude,
          }),
        );
      }
      return rows;
    });
    return created.map(toFileDTO);
  } catch (err) {
    // Remove everything this request stored (deleting a missing object is harmless).
    const keys = files.map((f) => f.storageKey);
    if (keys.length > 0) {
      await storage()
        .deleteObjects(keys)
        .catch((cleanupErr) => console.error('Failed to clean up uploaded objects:', cleanupErr));
    }
    throw err;
  }
}
