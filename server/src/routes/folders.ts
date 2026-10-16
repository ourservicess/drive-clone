import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { onInvalid } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import {
  createFolderSchema,
  idParam,
  listFoldersQuery,
  updateFolderSchema,
} from '../schemas/index.js';
import {
  createFolder,
  getFolderDetails,
  listFolders,
  updateFolder,
} from '../services/folderService.js';
import { deleteFolderPermanently, restoreFolder, trashFolder } from '../services/trashService.js';
import type { AppEnv } from '../types.js';

const param = zValidator('param', idParam, onInvalid);

export const folderRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)

  .get('/', zValidator('query', listFoldersQuery, onInvalid), async (c) => {
    const { parentId, ...sort } = c.req.valid('query');
    return c.json({ folders: await listFolders(c.get('user').id, parentId ?? null, sort) });
  })

  .post('/', zValidator('json', createFolderSchema, onInvalid), async (c) => {
    const { name, parentId } = c.req.valid('json');
    return c.json({ folder: await createFolder(c.get('user').id, name, parentId) }, 201);
  })

  .get('/:id', param, async (c) => {
    return c.json(await getFolderDetails(c.get('user').id, c.req.valid('param').id));
  })

  .patch('/:id', param, zValidator('json', updateFolderSchema, onInvalid), async (c) => {
    const folder = await updateFolder(c.get('user').id, c.req.valid('param').id, c.req.valid('json'));
    return c.json({ folder });
  })

  .delete('/:id', param, async (c) => {
    return c.json({ folder: await trashFolder(c.get('user').id, c.req.valid('param').id) });
  })

  .post('/:id/restore', param, async (c) => {
    return c.json({ folder: await restoreFolder(c.get('user').id, c.req.valid('param').id) });
  })

  .delete('/:id/permanent', param, async (c) => {
    await deleteFolderPermanently(c.get('user').id, c.req.valid('param').id);
    return c.json({ ok: true });
  });
