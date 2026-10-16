import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { env } from '../env.js';
import { AppError } from '../lib/errors.js';
import { keyToPath, verifyBlobLink } from '../lib/localStorage.js';

/**
 * Serves files from local storage for signed links (see lib/localStorage.ts).
 * Supports HTTP Range requests so videos can be seeked.
 */
export const blobRoutes = new Hono().get('/file', async (c) => {
  const link = verifyBlobLink(c.req.query());
  if (!link) throw new AppError(403, 'LINK_EXPIRED', 'This link is invalid or has expired');

  const path = keyToPath(env.localStorageDir, link.key);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new AppError(404, 'NOT_FOUND', 'File not found');

  const size = info.size;
  let start = 0;
  let end = size - 1;
  let status: 200 | 206 = 200;

  const range = c.req.header('range');
  if (range && size > 0) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match || (match[1] === '' && match[2] === '')) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }
    if (match[1] === '') {
      start = Math.max(0, size - Number(match[2])); // "bytes=-500" = last 500 bytes
    } else {
      start = Number(match[1]);
      end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
    }
    if (start > end || start >= size) {
      return c.body(null, 416, { 'Content-Range': `bytes */${size}` });
    }
    status = 206;
  }

  const headers: Record<string, string> = {
    'Content-Type': link.type,
    'Content-Disposition': link.disp,
    'Content-Length': String(size === 0 ? 0 : end - start + 1),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=300',
    'X-Content-Type-Options': 'nosniff',
  };
  if (status === 206) headers['Content-Range'] = `bytes ${start}-${end}/${size}`;
  // Files are served from our own origin, so as an extra safety net tell the
  // browser never to run scripts from them. (PDFs are excluded because the
  // browser's built-in PDF viewer does not work inside a sandbox.)
  if (link.type !== 'application/pdf') headers['Content-Security-Policy'] = "default-src 'none'; sandbox";

  if (size === 0) return c.body(null, 200, headers);
  const stream = Readable.toWeb(createReadStream(path, { start, end })) as ReadableStream;
  return new Response(stream, { status, headers });
});
