import { Hono } from 'hono';
import { requireAuth } from '../middleware/auth.js';
import { storageUsage } from '../services/fileService.js';
import { emptyTrash, listTrash } from '../services/trashService.js';
import type { AppEnv } from '../types.js';

export const trashRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => c.json(await listTrash(c.get('user').id)))
  .delete('/', async (c) => c.json(await emptyTrash(c.get('user').id)));

export const storageRoutes = new Hono<AppEnv>()
  .use('*', requireAuth)
  .get('/usage', async (c) => c.json(await storageUsage(c.get('user').id)));
