import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { onInvalid } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { chunkParam, createUploadSchema, idParam } from '../schemas/index.js';
import {
  cancelUpload,
  clearFinishedUploads,
  completeUpload,
  createUpload,
  getUpload,
  listUploads,
  receiveChunk,
  removeUpload,
} from '../services/resumableUploadService.js';
import type { AppEnv } from '../types.js';

const param = zValidator('param', idParam, onInvalid);

/** Resumable uploads + upload history. See resumableUploadService.ts. */
export const uploadRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', async (c) => c.json({ uploads: await listUploads(c.get('user').id) }))

  .post('/', zValidator('json', createUploadSchema, onInvalid), async (c) => {
    return c.json({ upload: await createUpload(c.get('user').id, c.req.valid('json')) }, 201);
  })

  .delete('/', async (c) => c.json(await clearFinishedUploads(c.get('user').id)))

  .get('/:id', param, async (c) => {
    return c.json({ upload: await getUpload(c.get('user').id, c.req.valid('param').id) });
  })

  // The body is the raw bytes of one piece (Content-Type: application/octet-stream).
  .put('/:id/chunks/:index', zValidator('param', chunkParam, onInvalid), async (c) => {
    const { id, index } = c.req.valid('param');
    return c.json(await receiveChunk(c.get('user').id, id, index, c.req.raw.body));
  })

  .post('/:id/complete', param, async (c) => {
    return c.json(await completeUpload(c.get('user').id, c.req.valid('param').id));
  })

  .post('/:id/cancel', param, async (c) => {
    return c.json({ upload: await cancelUpload(c.get('user').id, c.req.valid('param').id) });
  })

  .delete('/:id', param, async (c) => {
    await removeUpload(c.get('user').id, c.req.valid('param').id);
    return c.json({ ok: true });
  });
