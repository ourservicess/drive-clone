import { Prisma } from '@prisma/client';
import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { prisma } from '../lib/db.js';
import { AppError, conflict } from '../lib/errors.js';
import { fakeVerify, hashPassword, verifyPassword } from '../lib/password.js';
import { rateLimit } from '../lib/rateLimit.js';
import {
  clearSessionCookie,
  createSession,
  deleteSession,
  hashToken,
  SESSION_COOKIE,
} from '../lib/session.js';
import { onInvalid } from '../lib/validate.js';
import { requireAuth } from '../middleware/auth.js';
import { loginSchema, signupSchema } from '../schemas/index.js';
import type { AppEnv } from '../types.js';

// 20 signup/login attempts per IP every 15 minutes.
export const authRateLimit = rateLimit({ name: 'auth', windowMs: 15 * 60 * 1000, max: 20 });

const publicUser = { id: true, email: true, name: true } as const;

export const authRoutes = new Hono<AppEnv>()
  .post('/signup', authRateLimit, zValidator('json', signupSchema, onInvalid), async (c) => {
    const { name, email, password } = c.req.valid('json');

    const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
    if (existing) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');

    try {
      const user = await prisma.user.create({
        data: { name, email, passwordHash: await hashPassword(password) },
        select: publicUser, // never return passwordHash
      });
      await createSession(c, user.id);
      return c.json({ user }, 201);
    } catch (err) {
      // Two signups with the same email at the same moment: unique constraint violation.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
      }
      throw err;
    }
  })

  .post('/login', authRateLimit, zValidator('json', loginSchema, onInvalid), async (c) => {
    const { email, password } = c.req.valid('json');
    const user = await prisma.user.findUnique({ where: { email } });

    // Same error for "no such email" and "wrong password" so attackers
    // cannot find out which emails have accounts.
    const invalid = new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
    if (!user) {
      await fakeVerify(password);
      throw invalid;
    }
    if (!(await verifyPassword(user.passwordHash, password))) throw invalid;

    await createSession(c, user.id);
    return c.json({ user: { id: user.id, email: user.email, name: user.name } });
  })

  .post('/logout', async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) await deleteSession(hashToken(token));
    clearSessionCookie(c);
    return c.json({ ok: true });
  })

  .get('/me', requireAuth, (c) => c.json({ user: c.get('user') }));
