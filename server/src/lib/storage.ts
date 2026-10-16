import {
  DeleteObjectsCommand,
  GetObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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
  putObject(key: string, body: Blob, contentType: string): Promise<void>;
  deleteObjects(keys: string[]): Promise<void>;
  getSignedDownloadUrl(key: string, options: SignedUrlOptions): Promise<string>;
  /** Reads at most maxBytes from the start of an object (used for text previews). */
  readObjectStart(key: string, maxBytes: number): Promise<Uint8Array>;
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
  };
}

/** Simple in-memory storage used by the automated tests (never in real use). */
export function createMemoryDriver(): StorageDriver & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    objects,
    async putObject(key, body) {
      objects.set(key, new Uint8Array(await body.arrayBuffer()));
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
