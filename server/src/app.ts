import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { csrf } from 'hono/csrf';
import { secureHeaders } from 'hono/secure-headers';
import { env } from './env.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { authRoutes } from './routes/auth.js';
import { blobRoutes } from './routes/blobs.js';
import { fileRoutes } from './routes/files.js';
import { folderRoutes } from './routes/folders.js';
import { publicRoutes } from './routes/public.js';
import { uploadRoutes } from './routes/uploads.js';
import { storageRoutes, trashRoutes } from './routes/trash.js';
import type { AppEnv } from './types.js';

/** Builds the Hono app. index.ts serves it; the tests call app.request() directly. */
export function createApp() {
  const app = new Hono<AppEnv>();

  // Security headers: nosniff, frame protection, referrer policy, etc.
  app.use('*', secureHeaders());

  // Only our own frontend may call the API with cookies.
  app.use(
    '/api/*',
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowHeaders: ['Content-Type'],
      maxAge: 600,
    }),
  );

  // CSRF: state-changing requests that a plain HTML form could send
  // (form/multipart/text or no body) must come from our own origin.
  // JSON requests are protected because browsers require a CORS preflight.
  app.use('/api/*', csrf({ origin: env.WEB_ORIGIN }));

  app.get('/api/health', (c) => c.json({ ok: true }));
  app.route('/api/auth', authRoutes);
  app.route('/api/files', fileRoutes);
  app.route('/api/folders', folderRoutes);
  app.route('/api/trash', trashRoutes);
  app.route('/api/storage', storageRoutes);
  app.route('/api/uploads', uploadRoutes);
  // Public "anyone with the link" endpoints (no login).
  app.route('/api/public', publicRoutes);
  // Signed links for files kept in local storage (no login cookie needed:
  // the signature in the link is the permission, like an R2 presigned URL).
  app.route('/api/blobs', blobRoutes);

  app.onError(errorHandler);
  app.notFound(notFoundHandler);
  return app;
}
