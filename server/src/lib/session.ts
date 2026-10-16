import { createHash, randomBytes } from 'node:crypto';
import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { env } from '../env.js';
import { prisma } from './db.js';

// In production the "__Host-" prefix makes the browser enforce Secure + Path=/ + no Domain.
export const SESSION_COOKIE = env.isProduction ? '__Host-sid' : 'sid';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session row and sets the HttpOnly session cookie. */
export async function createSession(c: Context, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url'); // 256 bits of randomness
  const expiresAt = new Date(Date.now() + env.sessionTtlMs);
  await prisma.session.create({ data: { id: hashToken(token), userId, expiresAt } });
  setSessionCookie(c, token, expiresAt);
}

function setSessionCookie(c: Context, token: string, expiresAt: Date) {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true, // JavaScript cannot read it (protects against XSS token theft)
    secure: env.isProduction, // HTTPS only in production
    sameSite: 'Lax', // not sent on cross-site POSTs (CSRF protection)
    path: '/',
    expires: expiresAt,
  });
}

export function clearSessionCookie(c: Context) {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: env.isProduction });
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

/**
 * Looks up the session from the cookie. Returns null for a missing, unknown or
 * expired session. Sessions that are more than halfway to expiry are extended
 * ("sliding" sessions), so active users stay logged in.
 */
export async function getSessionUser(
  c: Context,
): Promise<{ user: AuthUser; sessionId: string } | null> {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token || token.length > 200) return null;

  const sessionId = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!session) return null;

  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => undefined);
    return null;
  }

  if (session.expiresAt.getTime() - now < env.sessionTtlMs / 2) {
    const expiresAt = new Date(now + env.sessionTtlMs);
    await prisma.session.update({ where: { id: sessionId }, data: { expiresAt } });
    setSessionCookie(c, token, expiresAt);
  }

  return { user: session.user, sessionId };
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

/** Housekeeping: remove expired sessions (called periodically by index.ts). */
export async function purgeExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return result.count;
}
