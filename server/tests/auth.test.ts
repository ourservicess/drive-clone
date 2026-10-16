import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { hashToken } from '../src/lib/session.js';
import { resetAll, signedInClient, TestClient } from './helpers.js';

beforeEach(resetAll);
afterAll(() => prisma.$disconnect());

const password = 'correct horse battery';

describe('signup', () => {
  it('creates a user, logs them in, and never returns the password hash', async () => {
    const client = new TestClient();
    const res = await client.post('/api/auth/signup', {
      json: { name: 'Ada', email: 'Ada@Example.com', password },
    });
    expect(res.status).toBe(201);
    expect(res.data.user).toEqual({ id: expect.any(String), name: 'Ada', email: 'ada@example.com' });
    expect(JSON.stringify(res.data)).not.toContain('passwordHash');

    const cookieHeader = res.headers.get('set-cookie') ?? '';
    expect(cookieHeader).toMatch(/HttpOnly/i);
    expect(cookieHeader).toMatch(/SameSite=Lax/i);

    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'ada@example.com' } });
    expect(stored.passwordHash).not.toContain(password);
    expect(stored.passwordHash.startsWith('$argon2')).toBe(true);
  });

  it('rejects a duplicate email', async () => {
    const { email } = await signedInClient();
    const res = await new TestClient().post('/api/auth/signup', {
      json: { name: 'Other', email, password },
    });
    expect(res.status).toBe(409);
    expect(res.data.error.code).toBe('EMAIL_TAKEN');
  });

  it('validates the request body', async () => {
    const res = await new TestClient().post('/api/auth/signup', {
      json: { name: '', email: 'not-an-email', password: 'short' },
    });
    expect(res.status).toBe(400);
    expect(res.data.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('login / logout / me', () => {
  it('logs in with correct credentials', async () => {
    const { email } = await signedInClient();
    const client = new TestClient();
    const res = await client.post('/api/auth/login', { json: { email, password } });
    expect(res.status).toBe(200);
    expect(res.data.user.email).toBe(email);

    const me = await client.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.data.user.email).toBe(email);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const { email } = await signedInClient();
    const wrong = await new TestClient().post('/api/auth/login', { json: { email, password: 'wrong-password' } });
    const unknown = await new TestClient().post('/api/auth/login', {
      json: { email: 'nobody@example.com', password },
    });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.data).toEqual(unknown.data);
    expect(wrong.data.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects requests without a session', async () => {
    const res = await new TestClient().get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.data.error.code).toBe('UNAUTHENTICATED');
    expect((await new TestClient().get('/api/files')).status).toBe(401);
  });

  it('stores only a hash of the session token', async () => {
    const { client } = await signedInClient();
    const token = client.cookie!.split('=')[1]!;
    expect(await prisma.session.findUnique({ where: { id: token } })).toBeNull();
    expect(await prisma.session.findUnique({ where: { id: hashToken(token) } })).not.toBeNull();
  });

  it('logout destroys the session', async () => {
    const { client } = await signedInClient();
    const savedCookie = client.cookie;
    expect((await client.post('/api/auth/logout')).status).toBe(200);

    const replay = new TestClient();
    replay.cookie = savedCookie; // try to reuse the old cookie
    expect((await replay.get('/api/auth/me')).status).toBe(401);
  });

  it('rejects an expired session', async () => {
    const { client, user } = await signedInClient();
    await prisma.session.updateMany({ where: { userId: user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await client.get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
  });

  it('rejects a forged cookie', async () => {
    const client = new TestClient();
    client.cookie = 'sid=made-up-token';
    expect((await client.get('/api/auth/me')).status).toBe(401);
  });
});

describe('protection', () => {
  it('rate-limits login attempts', async () => {
    const client = new TestClient();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await client.post('/api/auth/login', { json: { email: 'x@example.com', password: 'nope-nope' } }))
        .status;
    }
    expect(last).toBe(429);
  });

  it('blocks cross-site form posts (CSRF)', async () => {
    const { client } = await signedInClient();
    const form = new FormData();
    form.append('files', new File(['hi'], 'a.txt'));
    const res = await client.post('/api/files/upload', {
      form,
      headers: { Origin: 'https://evil.example' },
    });
    expect(res.status).toBe(403);
  });
});
