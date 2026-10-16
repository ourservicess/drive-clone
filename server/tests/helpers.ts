import { createApp } from '../src/app.js';
import { prisma } from '../src/lib/db.js';
import { createMemoryDriver, setStorageDriver } from '../src/lib/storage.js';
import { authRateLimit } from '../src/routes/auth.js';
import { publicRateLimit } from '../src/routes/public.js';

export const ORIGIN = 'http://localhost:3000';
export const app = createApp();
export const memoryStorage = createMemoryDriver();
setStorageDriver(memoryStorage);

/** Wipes all collections and stored objects so every test starts clean. */
export async function resetAll() {
  await prisma.session.deleteMany();
  await prisma.upload.deleteMany();
  await prisma.shareLink.deleteMany();
  await prisma.file.deleteMany();
  await prisma.folder.updateMany({ data: { parentId: null } }); // see deleteFoldersAndFiles()
  await prisma.folder.deleteMany();
  await prisma.user.deleteMany();
  memoryStorage.objects.clear();
  memoryStorage.parts.clear();
  authRateLimit.reset();
  publicRateLimit.reset();
}

interface RequestOptions {
  json?: unknown;
  form?: FormData;
  /** raw request body, e.g. the bytes of one upload piece */
  raw?: Uint8Array | string;
  headers?: Record<string, string>;
}

/**
 * A tiny "browser": remembers the session cookie between requests and sends
 * the Origin header like a real browser would.
 */
export class TestClient {
  cookie: string | undefined;

  async request(method: string, path: string, options: RequestOptions = {}) {
    const headers: Record<string, string> = { Origin: ORIGIN, ...options.headers };
    if (this.cookie) headers.Cookie = this.cookie;

    let body: BodyInit | undefined;
    if (options.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(options.json);
    } else if (options.form) {
      body = options.form;
    } else if (options.raw !== undefined) {
      headers['Content-Type'] ??= 'application/octet-stream';
      body = options.raw;
    }

    const res = await app.request(path, { method, headers, body });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) {
      const [pair] = setCookie.split(';');
      const value = pair?.split('=').slice(1).join('=');
      this.cookie = value ? pair : undefined;
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    return { status: res.status, data, headers: res.headers };
  }

  get = (path: string, o?: RequestOptions) => this.request('GET', path, o);
  post = (path: string, o?: RequestOptions) => this.request('POST', path, o);
  patch = (path: string, o?: RequestOptions) => this.request('PATCH', path, o);
  put = (path: string, o?: RequestOptions) => this.request('PUT', path, o);
  delete = (path: string, o?: RequestOptions) => this.request('DELETE', path, o);

  async upload(files: Array<{ name: string; content: string | Uint8Array }>, folderId?: string) {
    const form = new FormData();
    for (const f of files) form.append('files', new File([f.content], f.name));
    if (folderId) form.append('folderId', folderId);
    return this.post('/api/files/upload', { form });
  }
}

let counter = 0;

/** Creates a new user and returns a logged-in client for them. */
export async function signedInClient(name = 'Test User') {
  const client = new TestClient();
  const email = `user${++counter}-${Date.now()}@example.com`;
  const res = await client.post('/api/auth/signup', {
    json: { name, email, password: 'correct horse battery' },
  });
  if (res.status !== 201) throw new Error(`signup failed: ${JSON.stringify(res.data)}`);
  return { client, user: res.data.user as { id: string; email: string; name: string }, email };
}
