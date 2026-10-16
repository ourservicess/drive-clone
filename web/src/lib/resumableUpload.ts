import { ApiError } from '../api/client';
import { sendChunk, uploadsApi } from '../api/endpoints';
import type { FileItem, UploadRecord } from '../api/types';

/*
 * Resumable upload of one file
 * ----------------------------
 * 1. Ask the server to start an upload (or look up an existing one to resume).
 * 2. Send the file in pieces (8 MB by default), in order.
 * 3. If a piece fails because of the network, wait and try again:
 *    - offline  -> wait until the browser is back online
 *    - online   -> wait 1s, 2s, 4s ... up to 30s between tries
 *    The server always says how many bytes it already has, so we continue
 *    exactly where it stopped instead of starting over.
 * 4. Ask the server to join the pieces into the final file.
 */

/** The same file must give the same fingerprint (matches the server's format). */
export const fingerprintOf = (file: File) => `${file.size}:${file.lastModified}:${file.name}`;

const MAX_FAILURES_WHILE_ONLINE = 10;

interface Options {
  file: File;
  folderId: string | null;
  /** Set to continue an existing upload instead of starting a new one. */
  uploadId?: string;
  signal: AbortSignal;
  onSession: (upload: UploadRecord) => void;
  onProgress: (uploadedBytes: number) => void;
  /** 'waiting' = paused because of a connection problem (message explains). */
  onPhase: (phase: 'uploading' | 'waiting', message?: string) => void;
}

/** Errors worth retrying: network trouble, timeouts, server hiccups, cut-off pieces. */
function isRetryable(err: unknown): boolean {
  if (!(err instanceof ApiError)) return false;
  return (
    err.status === 0 ||
    err.status === 408 ||
    err.status === 429 ||
    err.status >= 500 ||
    err.code === 'CHUNK_INCOMPLETE'
  );
}

function abortError() {
  return new DOMException('Upload cancelled', 'AbortError');
}

/** Waits before the next try; resolves early when the connection comes back. */
function waitBeforeRetry(attempt: number, signal: AbortSignal, onPhase: Options['onPhase']): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(abortError());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      window.removeEventListener('online', done);
      signal.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      window.removeEventListener('online', done);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    window.addEventListener('online', done, { once: true });

    if (!navigator.onLine) {
      onPhase('waiting', 'No internet connection. Will continue automatically.');
    } else {
      const delay = Math.min(30_000, 1000 * 2 ** (attempt - 1));
      onPhase('waiting', `Connection problem. Retrying in ${Math.round(delay / 1000)}s…`);
      timer = setTimeout(done, delay);
    }
  });
}

/** Runs `request`, retrying network problems (forever while offline). */
async function withRetry<T>(request: () => Promise<T>, signal: AbortSignal, onPhase: Options['onPhase']): Promise<T> {
  for (let failures = 0; ; ) {
    try {
      return await request();
    } catch (err) {
      if (signal.aborted) throw abortError();
      if (!isRetryable(err)) throw err;
      failures++;
      if (navigator.onLine && failures > MAX_FAILURES_WHILE_ONLINE) throw err;
      await waitBeforeRetry(failures, signal, onPhase);
      onPhase('uploading');
    }
  }
}

export async function runResumableUpload(opts: Options): Promise<FileItem | null> {
  const { file, signal, onPhase } = opts;

  // 1. Start, or look up where an earlier attempt stopped.
  let session = (
    await withRetry(
      () =>
        opts.uploadId
          ? uploadsApi.get(opts.uploadId)
          : uploadsApi.create({ name: file.name, size: file.size, folderId: opts.folderId, lastModified: file.lastModified }),
      signal,
      onPhase,
    )
  ).upload;
  opts.onSession(session);

  if (session.status === 'completed') return null; // already finished earlier
  if (session.status !== 'uploading') throw new Error(`This upload was ${session.status}. Start a new upload instead.`);

  // 2. Send the remaining pieces.
  let received = session.receivedBytes;
  opts.onProgress(received);
  let failures = 0;
  while (received < file.size) {
    if (signal.aborted) throw abortError();
    const index = Math.floor(received / session.chunkSize);
    const start = index * session.chunkSize;
    try {
      const result = await sendChunk(
        session.id,
        index,
        file.slice(start, start + session.chunkSize),
        (loaded) => opts.onProgress(start + loaded),
        signal,
      );
      received = result.receivedBytes;
      opts.onProgress(received);
      if (failures > 0) onPhase('uploading');
      failures = 0;
    } catch (err) {
      if (signal.aborted || (err as Error).name === 'AbortError') throw abortError();
      // The server already has more (or less) than we thought: jump there.
      const serverHas = (err as ApiError).details as { receivedBytes?: number } | undefined;
      if (err instanceof ApiError && err.code === 'UPLOAD_OUT_OF_SYNC' && typeof serverHas?.receivedBytes === 'number') {
        received = serverHas.receivedBytes;
        continue;
      }
      if (!isRetryable(err)) throw err;
      failures++;
      if (navigator.onLine && failures > MAX_FAILURES_WHILE_ONLINE) throw err;
      await waitBeforeRetry(failures, signal, onPhase);
      onPhase('uploading');
      // Ask the server how far it got before continuing.
      session = (await withRetry(() => uploadsApi.get(session.id), signal, onPhase)).upload;
      received = session.receivedBytes;
      opts.onProgress(received);
    }
  }

  // 3. Join the pieces into the final file (safe to repeat).
  const done = await withRetry(() => uploadsApi.complete(session.id), signal, onPhase);
  opts.onSession(done.upload);
  return done.file;
}
