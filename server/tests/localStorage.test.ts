import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { prisma } from '../src/lib/db.js';
import { createLocalDriver, keyToPath } from '../src/lib/localStorage.js';
import { setStorageDriver } from '../src/lib/storage.js';
import { app, memoryStorage, resetAll, signedInClient, type TestClient } from './helpers.js';

const root = env.localStorageDir;
const driver = createLocalDriver(root);

beforeAll(() => setStorageDriver(driver));
beforeEach(resetAll);
afterAll(async () => {
  setStorageDriver(memoryStorage);
  await rm(root, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function uploadOne(client: TestClient, name: string, content: string) {
  const res = await client.upload([{ name, content }]);
  expect(res.status).toBe(201);
  return res.data.files[0] as { id: string };
}

/** Fetches a signed blob link (plain request - no login cookie). */
const fetchLink = (url: string, headers: Record<string, string> = {}) => app.request(url, { headers });

describe('local disk storage', () => {
  it('saves uploads on disk and serves them through signed download links', async () => {
    const { client, user } = await signedInClient();
    const file = await uploadOne(client, 'hello.txt', 'Hello from disk');

    const row = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    const path = keyToPath(root, row.storageKey);
    expect(await readFile(path, 'utf8')).toBe('Hello from disk');
    expect(path.startsWith(root)).toBe(true);
    expect(row.storageKey.startsWith(`users/${user.id}/`)).toBe(true);

    const { url } = (await client.get(`/api/files/${file.id}/download`)).data;
    expect(url.startsWith('/api/blobs/file?')).toBe(true);
    const res = await fetchLink(url);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('Hello from disk');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename="hello.txt"/);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-security-policy')).toContain('sandbox');
  });

  it('reads text previews from disk and gives inline links for PDFs', async () => {
    const { client } = await signedInClient();
    const txt = await uploadOne(client, 'notes.md', '# Title');
    expect((await client.get(`/api/files/${txt.id}/preview`)).data).toEqual({
      kind: 'text',
      content: '# Title',
      truncated: false,
    });

    const pdf = await uploadOne(client, 'doc.pdf', '%PDF-1.4 fake');
    const preview = (await client.get(`/api/files/${pdf.id}/preview`)).data;
    const res = await fetchLink(preview.url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('rejects tampered and expired links', async () => {
    const { client } = await signedInClient();
    const file = await uploadOne(client, 'a.txt', 'secret');
    const { url } = (await client.get(`/api/files/${file.id}/download`)).data;

    // Change what the link says (inline instead of attachment) -> signature no longer matches.
    const tampered = url.replace('disp=attachment', 'disp=inline');
    expect((await fetchLink(tampered)).status).toBe(403);
    expect((await fetchLink(url.replace(/sig=[^&]+/, 'sig=forged'))).status).toBe(403);
    expect((await fetchLink('/api/blobs/file')).status).toBe(403);

    const row = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    const expired = await driver.getSignedDownloadUrl(row.storageKey, {
      filename: 'a.txt',
      contentType: 'text/plain',
      inline: false,
      expiresInSeconds: -5,
    });
    expect((await fetchLink(expired)).status).toBe(403);
  });

  it('supports range requests (video seeking)', async () => {
    const { client } = await signedInClient();
    const file = await uploadOne(client, 'clip.txt', '0123456789');
    const { url } = (await client.get(`/api/files/${file.id}/download`)).data;

    const part = await fetchLink(url, { Range: 'bytes=2-5' });
    expect(part.status).toBe(206);
    expect(await part.text()).toBe('2345');
    expect(part.headers.get('content-range')).toBe('bytes 2-5/10');

    const tail = await fetchLink(url, { Range: 'bytes=-3' });
    expect(await tail.text()).toBe('789');
    expect((await fetchLink(url, { Range: 'bytes=50-60' })).status).toBe(416);
  });

  it('never accepts a storage key that could escape the storage folder', () => {
    for (const key of ['../secret.txt', 'users/../../etc/passwd', 'users/abc/def', 'C:\\Windows\\win.ini', '']) {
      expect(() => keyToPath(root, key)).toThrow('Invalid storage key');
    }
  });

  it('resumes an interrupted upload on disk and discards half-written pieces', async () => {
    const { client } = await signedInClient();
    const chunk = env.uploadChunkBytes;
    const content = Buffer.from('x'.repeat(chunk) + 'y'.repeat(chunk) + 'z'.repeat(17));
    const { upload } = (await client.post('/api/uploads', { json: { name: 'clip.txt', size: content.length } })).data;
    const piece = (i: number, bytes: Buffer) => client.put(`/api/uploads/${upload.id}/chunks/${i}`, { raw: bytes });

    expect((await piece(0, content.subarray(0, chunk))).status).toBe(200);
    // Connection drops mid-piece: only 10 bytes of piece 1 arrive.
    expect((await piece(1, content.subarray(chunk, chunk + 10))).status).toBe(400);
    expect((await piece(1, content.subarray(chunk, chunk * 2))).status).toBe(200);
    expect((await piece(2, content.subarray(chunk * 2))).status).toBe(200);

    const done = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(done.status).toBe(200);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: done.data.file.id } });
    expect((await readFile(keyToPath(root, row.storageKey))).equals(content)).toBe(true);
    expect(existsSync(`${keyToPath(root, row.storageKey)}.partial`)).toBe(false);
  });

  it('removes the partial file when an upload is cancelled', async () => {
    const { client } = await signedInClient();
    const { upload } = (await client.post('/api/uploads', { json: { name: 'a.txt', size: 500 } })).data;
    await client.put(`/api/uploads/${upload.id}/chunks/0`, { raw: Buffer.alloc(env.uploadChunkBytes, 1) });
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: upload.id } });
    const partial = `${keyToPath(root, row.storageKey)}.partial`;
    expect(existsSync(partial)).toBe(true);
    await client.post(`/api/uploads/${upload.id}/cancel`);
    expect(existsSync(partial)).toBe(false);
  });

  it('deletes the file from disk when it is deleted forever', async () => {
    const { client } = await signedInClient();
    const file = await uploadOne(client, 'gone.txt', 'bye');
    const row = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    const path = keyToPath(root, row.storageKey);
    expect(existsSync(path)).toBe(true);

    await client.delete(`/api/files/${file.id}`);
    await client.delete(`/api/files/${file.id}/permanent`);
    expect(existsSync(path)).toBe(false);
  });
});
