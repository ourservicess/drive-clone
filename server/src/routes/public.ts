import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { rateLimit } from '../lib/rateLimit.js';
import { onInvalid } from '../lib/validate.js';
import { tokenParam } from '../schemas/index.js';
import { getPublicDownload, getPublicFile, getPublicPreview } from '../services/shareService.js';

// Public endpoints have no login, so limit how fast one IP can call them.
export const publicRateLimit = rateLimit({ name: 'public', windowMs: 60 * 1000, max: 120 });
const param = zValidator('param', tokenParam, onInvalid);

/** "Anyone with the link" endpoints - NO login required. See shareService.ts. */
export const publicRoutes = new Hono()
  .use('*', publicRateLimit)
  .get('/:token', param, async (c) => c.json({ file: await getPublicFile(c.req.valid('param').token) }))
  .get('/:token/preview', param, async (c) => c.json(await getPublicPreview(c.req.valid('param').token)))
  .get('/:token/download', param, async (c) => c.json(await getPublicDownload(c.req.valid('param').token)));
