import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { Transform, type Readable } from 'node:stream';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../env.js';
import { createLocalDriver } from './localStorage.js';

export interface SignedUrlOptions {
  filename: string;
  contentType: string;
  /** true = show in the browser, false = force a download */
  inline: boolean;
  expiresInSeconds: number;
}

/**
 * Everything the app needs from object storage. Two real implementations exist:
 * Cloudflare R2 (below) and a folder on this computer (localStorage.ts).
 * Tests swap in an in-memory implementation with setStorageDriver().
 */
export interface StorageDriver {
  /**
   * Saves a file. The body is a stream, so even multi-GB files are written
   * piece by piece instead of being held in memory. If the stream errors
   * (e.g. a size limit is hit), nothing is left behind.
   */
  putObject(key: string, body: Readable, contentType: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
  getSignedDownloadUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Reads at most maxBytes from the start of an object (used for text previews). */
  readObjectStart(key: string, maxBytes: number): Promise<Uint8Array>;

  // ---- Resumable uploads: a file arrives as numbered parts 0, 1, 2, ... ----

  /** Prepares a multi-part upload. Returns the provider's upload id (R2) or null. */
  startMultipart(key: string, contentType: string): Promise<string | null>;
  /**
   * Stores part number `index` (which starts at byte `offset` of the file).
   * The body must contain exactly `size` bytes; if the connection drops
   * mid-part, the partial data is discarded so the part can be sent again.
   */
  putPart(key: string, multipartId: string | null, index: number, offset: number, size: number, body: Readable): Promise<void>;
  /** Joins all parts into the final object. */
  completeMultipart(key: string, multipartId: string | null, partCount: number, contentType: string): Promise<void>;
  /** Throws away an unfinished multi-part upload. */
  abortMultipart(key: string, multipartId: string | null): Promise<void>;
}

/** Thrown when a part did not contain exactly the expected number of bytes. */
export class PartSizeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PartSizeError';
  }
}

/** A pass-through stream that fails unless exactly `size` bytes flow through it. */
export function exactLength(size: number): Transform {
  let seen = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      seen += chunk.length;
      if (seen > size) return done(new PartSizeError(`Part is larger than the expected ${size} bytes`));
      done(null, chunk);
    },
    flush(done) {
      done(seen === size ? null : new PartSizeError(`Part was cut off (${seen} of ${size} bytes)`));
    },
  });
}

/** body.pipe(target), but also passes errors from body on to target. */
export function pipeChecked(body: Readable, target: Transform): Transform {
  body.on('error', (err) => target.destroy(err));
  return body.pipe(target);
}

/** Builds a Content-Disposition header value that is safe for any filename. */
export function contentDisposition(filename: string, inline: boolean): string {
  // ASCII-only fallback for old clients; quotes/backslashes/control chars removed.
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(/['()*]/g, (ch) =>
    `%${ch.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `${inline ? 'inline' : 'attachment'}; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function createR2Driver(): StorageDriver {
  // env.ts already guarantees these are set when STORAGE_DRIVER=r2.
  const client = new S3Client({
    region: 'auto',
    endpoint: `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
    },
  });
  const Bucket = env.R2_BUCKET!;

  return {
    async putObject(key, body, contentType) {
      // Upload handles large files by splitting them into parts automatically.
      const upload = new Upload({
        client,
        params: { Bucket, Key: key, Body: body, ContentType: contentType },
        queueSize: 4,
        partSize: 10 * 1024 * 1024,
        leavePartsOnError: false, // abort the multipart upload if a part fails
      });
      await upload.done();
    },

    async deleteObjects(keys) {
      // DeleteObjects accepts at most 1000 keys per request.
      for (let i = 0; i < keys.length; i += 1000) {
        const chunk = keys.slice(i, i + 1000);
        const result = await client.send(
          new DeleteObjectsCommand({
            Bucket,
            Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
          }),
        );
        if (result.Errors && result.Errors.length > 0) {
          throw new Error(`Failed to delete ${result.Errors.length} object(s) from storage`);
        }
      }
    },

    async getSignedDownloadUrl(key, options) {
      const command = new GetObjectCommand({
        Bucket,
        Key: key,
        ResponseContentType: options.contentType,
        ResponseContentDisposition: contentDisposition(options.filename, options.inline),
      });
      return getSignedUrl(client, command, { expiresIn: options.expiresInSeconds });
    },

    async readObjectStart(key, maxBytes) {
      const result = await client.send(
        new GetObjectCommand({ Bucket, Key: key, Range: `bytes=0-${maxBytes - 1}` }),
      );
      if (!result.Body) return new Uint8Array();
      return result.Body.transformToByteArray();
    },

    // R2 natively supports multipart uploads; each of our chunks is one part.
    // (R2 requires every part except the last to be at least 5 MB.)
    async startMultipart(key, contentType) {
      const result = await client.send(new CreateMultipartUploadCommand({ Bucket, Key: key, ContentType: contentType }));
      if (!result.UploadId) throw new Error('R2 did not return an upload id');
      return result.UploadId;
    },

    async putPart(key, multipartId, index, _offset, size, body) {
      await client.send(
        new UploadPartCommand({
          Bucket,
          Key: key,
          UploadId: multipartId!,
          PartNumber: index + 1, // S3 part numbers start at 1
          ContentLength: size,
          Body: pipeChecked(body, exactLength(size)),
        }),
      );
    },

    async completeMultipart(key, multipartId, partCount, contentType) {
      if (partCount === 0) {
        // Empty file: S3 multipart needs at least one part, so store it directly.
        await this.abortMultipart(key, multipartId);
        await client.send(new PutObjectCommand({ Bucket, Key: key, Body: '', ContentType: contentType }));
        return;
      }
      const parts: Array<{ ETag?: string; PartNumber?: number }> = [];
      let marker: string | undefined;
      do {
        const page = await client.send(
          new ListPartsCommand({ Bucket, Key: key, UploadId: multipartId!, PartNumberMarker: marker }),
        );
        parts.push(...(page.Parts ?? []));
        marker = page.IsTruncated ? page.NextPartNumberMarker : undefined;
      } while (marker);
      if (parts.length !== partCount) throw new Error(`Expected ${partCount} parts in R2, found ${parts.length}`);
      parts.sort((a, b) => (a.PartNumber ?? 0) - (b.PartNumber ?? 0));
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket,
          Key: key,
          UploadId: multipartId!,
          MultipartUpload: { Parts: parts.map((p) => ({ ETag: p.ETag, PartNumber: p.PartNumber })) },
        }),
      );
    },

    async abortMultipart(key, multipartId) {
      if (!multipartId) return;
      try {
        await client.send(new AbortMultipartUploadCommand({ Bucket, Key: key, UploadId: multipartId }));
      } catch (err) {
        if ((err as { name?: string }).name !== 'NoSuchUpload') throw err;
      }
    },
  };
}

/** Simple in-memory storage used by the automated tests (never in real use). */
export function createMemoryDriver(): StorageDriver & {
  objects: Map<string, Uint8Array>;
  parts: Map<string, Map<number, Uint8Array>>;
} {
  const objects = new Map<string, Uint8Array>();
  const parts = new Map<string, Map<number, Uint8Array>>();
  return {
    objects,
    parts,
    async startMultipart(key) {
      parts.set(key, new Map());
      return null;
    },
    async putPart(key, _multipartId, index, _offset, size, body) {
      const upload = parts.get(key);
      if (!upload) throw new Error('Unknown upload');
      const chunks: Buffer[] = [];
      for await (const chunk of pipeChecked(body, exactLength(size))) chunks.push(chunk as Buffer);
      upload.set(index, new Uint8Array(Buffer.concat(chunks)));
    },
    async completeMultipart(key, _multipartId, partCount) {
      const upload = parts.get(key);
      if (!upload) throw new Error('Unknown upload');
      const ordered = Array.from({ length: partCount }, (_, i) => {
        const part = upload.get(i);
        if (!part) throw new Error(`Missing part ${i}`);
        return part;
      });
      objects.set(key, new Uint8Array(Buffer.concat(ordered)));
      parts.delete(key);
    },
    async abortMultipart(key) {
      parts.delete(key);
    },
    async putObject(key, body) {
      const chunks: Buffer[] = [];
      for await (const chunk of body) chunks.push(chunk as Buffer);
      objects.set(key, new Uint8Array(Buffer.concat(chunks)));
    },
    async deleteObjects(keys) {
      for (const key of keys) objects.delete(key);
    },
    async getSignedDownloadUrl(key, options) {
      const params = new URLSearchParams({
        disposition: contentDisposition(options.filename, options.inline),
        type: options.contentType,
      });
      return `memory://${key}?${params}`;
    },
    async readObjectStart(key, maxBytes) {
      return (objects.get(key) ?? new Uint8Array()).slice(0, maxBytes);
    },
  };
}

let driver: StorageDriver | undefined;

/** Returns the active storage driver (chosen by STORAGE_DRIVER, created on first use). */
export function storage(): StorageDriver {
  driver ??= env.STORAGE_DRIVER === 'r2' ? createR2Driver() : createLocalDriver(env.localStorageDir);
  return driver;
}

export function setStorageDriver(newDriver: StorageDriver): void {
  driver = newDriver;
}
