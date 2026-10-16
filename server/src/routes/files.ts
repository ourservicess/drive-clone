import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { env } from '../env.js';
import { AppError, badRequest } from '../lib/errors.js';
import { onInvalid } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  idParam,
  idSchema,
  listFilesQuery,
  searchQuery,
  sortSchema,
  starSchema,
  updateFileSchema,
} from '../schemas/index.js';
import {
  getDownloadUrl,
  getOwnedFile,
  getPreview,
  getThumbnailUrl,
  listFiles,
  recentFiles,
  searchItems,
  setStarred,
  starredFiles,
  updateFile,
  uploadFiles,
} from '../services/fileService.js';
import { toFileDTO } from '../services/serializers.js';
import { deleteFilePermanently, restoreFile, trashFile } from '../services/trashService.js';
import type { AppEnv } from '../types.js';

const param = zValidator('param', idParam, onInvalid);

// Whole request limit: one maximum-size file plus 1 MB for form overhead.
const uploadLimit = bodyLimit({
  maxSize: env.maxUploadBytes + 1024 * 1024,
  onError: () => {
    throw new AppError(413, 'FILE_TOO_LARGE', `Uploads are limited to ${env.MAX_UPLOAD_MB} MB`);
  },
});

// NOTE: fixed paths (/search, /recent, ...) are registered BEFORE /:id so
// that "search" is never mistaken for a file id.
export const fileRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', zValidator('query', listFilesQuery, onInvalid), async (c) => {
    const { folderId, ...sort } = c.req.valid('query');
    return c.json({ files: await listFiles(c.get('user').id, folderId ?? null, sort) });
  })

  .get('/search', zValidator('query', searchQuery, onInvalid), async (c) => {
    return c.json(await searchItems(c.get('user').id, c.req.valid('query').q));
  })

  .get('/recent', async (c) => c.json({ files: await recentFiles(c.get('user').id) }))

  .get('/starred', zValidator('query', sortSchema, onInvalid), async (c) => {
    return c.json({ files: await starredFiles(c.get('user').id, c.req.valid('query')) });
  })

  .post('/upload', uploadLimit, async (c) => {
    if (!c.req.header('content-type')?.toLowerCase().startsWith('multipart/form-data')) {
      throw badRequest('Uploads must be sent as multipart/form-data');
    }
    const body = await c.req.parseBody({ all: true });

    const raw = body['files'];
    const list = (Array.isArray(raw) ? raw : raw === undefined ? [] : [raw]).filter(
      (v): v is File => typeof v !== 'string',
    );

    let folderId: string | null = null;
    const rawFolderId = body['folderId'];
    if (typeof rawFolderId === 'string' && rawFolderId !== '') {
      const parsed = idSchema.safeParse(rawFolderId);
      if (!parsed.success) throw badRequest('Invalid folderId');
      folderId = parsed.data;
    }

    const files = await uploadFiles(c.get('user').id, folderId, list);
    return c.json({ files }, 201);
  })

  .get('/:id', param, async (c) => {
    const file = await getOwnedFile(c.get('user').id, c.req.valid('param').id);
    return c.json({ file: toFileDTO(file) });
  })

  .get('/:id/download', param, async (c) => {
    return c.json(await getDownloadUrl(c.get('user').id, c.req.valid('param').id));
  })

  .get('/:id/preview', param, async (c) => {
    return c.json(await getPreview(c.get('user').id, c.req.valid('param').id));
  })

  .get('/:id/thumbnail', param, async (c) => {
    return c.json(await getThumbnailUrl(c.get('user').id, c.req.valid('param').id));
  })

  .patch('/:id', param, zValidator('json', updateFileSchema, onInvalid), async (c) => {
    const file = await updateFile(c.get('user').id, c.req.valid('param').id, c.req.valid('json'));
    return c.json({ file });
  })

  .post('/:id/star', param, zValidator('json', starSchema, onInvalid), async (c) => {
    const file = await setStarred(c.get('user').id, c.req.valid('param').id, c.req.valid('json').starred);
    return c.json({ file });
  })

  .delete('/:id', param, async (c) => {
    return c.json({ file: await trashFile(c.get('user').id, c.req.valid('param').id) });
  })

  .post('/:id/restore', param, async (c) => {
    return c.json({ file: await restoreFile(c.get('user').id, c.req.valid('param').id) });
  })

  .delete('/:id/permanent', param, async (c) => {
    await deleteFilePermanently(c.get('user').id, c.req.valid('param').id);
    return c.json({ ok: true });
  });
