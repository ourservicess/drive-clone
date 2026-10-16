import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { createApp } from './app.js';
import { env } from './env.js';
import { prisma } from './lib/db.js';
import { purgeExpiredSessions } from './lib/session.js';

const app = createApp();

// In production, also serve the built React app (web/dist) from this server,
// so the browser and API share one origin.
const webDist = fileURLToPath(new URL('../../web/dist', import.meta.url));
if (env.isProduction && existsSync(webDist)) {
  const indexHtml = readFileSync(`${webDist}/index.html`, 'utf8');
  app.use('/*', serveStatic({ root: webDist }));
  // Single-page app: unknown non-API paths return index.html.
  app.get('*', (c) => (c.req.path.startsWith('/api/') ? c.notFound() : c.html(indexHtml)));
}

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  console.log(`API server running on http://localhost:${info.port}`);
});

// Remove expired sessions once an hour.
const cleanup = setInterval(() => {
  purgeExpiredSessions().catch((err) => console.error('Session cleanup failed:', err));
}, 60 * 60 * 1000);

async function shutdown() {
  clearInterval(cleanup);
  server.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
