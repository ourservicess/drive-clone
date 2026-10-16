import type { MiddlewareHandler } from 'hono';
import { unauthorized } from '../lib/errors.js';
import { clearSessionCookie, getSessionUser } from '../lib/session.js';
import type { AppEnv } from '../types.js';

/**
 * Protects a route: only logged-in users get through. Afterwards the route can
 * read the current user with c.get('user'). The user id NEVER comes from the
 * request body or URL - always from the session.
 */
export const requireAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const result = await getSessionUser(c);
  if (!result) {
    clearSessionCookie(c);
    throw unauthorized('Your session has expired. Please log in again.');
  }
  c.set('user', result.user);
  c.set('sessionId', result.sessionId);
  await next();
};
