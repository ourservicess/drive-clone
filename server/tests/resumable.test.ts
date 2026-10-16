import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { env } from '../src/env.js';
import { prisma } from '../src/lib/db.js';
import { memoryStorage, resetAll, signedInClient, type TestClient } from './helpers.js';

beforeEach(resetAll);
afterAll(() => prisma.$disconnect());

const CHUNK = env.uploadChunkBytes; // ~104 bytes in tests
const MB = 1024 * 1024;

/** Test content of a given length, e.g. "abcdefghij..." */
const makeContent = (length: number) =>
  new TextEncoder().encode(Array.from({ length }, (_, i) => String.fromCharCode(97 + (i % 26))).join(''));

async function start(client: TestClient, name: string, size: number, folderId?: string) {
  const res = await client.post('/api/uploads', { json: { name, size, folderId, lastModified: 1700000000000 } });
  return res;
}

const sendPiece = (client: TestClient, id: string, index: number, bytes: Uint8Array) =>
  client.put(`/api/uploads/${id}/chunks/${index}`, { raw: bytes });

/** Sends every piece of `content` in order. */
async function sendAll(client: TestClient, id: string, content: Uint8Array, from = 0) {
  for (let offset = from; offset < content.length; offset += CHUNK) {
    const res = await sendPiece(client, id, offset / CHUNK, content.subarray(offset, offset + CHUNK));
    expect(res.status).toBe(200);
  }
}

describe('resumable uploads', () => {
  it('uploads a file in several pieces and records it in the history', async () => {
    const { client } = await signedInClient();
    const content = makeContent(CHUNK * 2 + 42); // 3 pieces
    const created = await start(client, 'notes.txt', content.length);
    expect(created.status).toBe(201);
    const upload = created.data.upload;
    expect(upload).toMatchObject({ name: 'notes.txt', status: 'uploading', receivedBytes: 0, chunkSize: CHUNK });

    await sendAll(client, upload.id, content);
    const done = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.data.file).toMatchObject({ name: 'notes.txt', size: content.length });
    expect(done.data.upload).toMatchObject({ status: 'completed', fileId: done.data.file.id });

    const row = await prisma.file.findUniqueOrThrow({ where: { id: done.data.file.id } });
    expect(Buffer.from(memoryStorage.objects.get(row.storageKey)!).equals(Buffer.from(content))).toBe(true);

    const history = (await client.get('/api/uploads')).data.uploads;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ id: upload.id, status: 'completed' });
  });

  it('continues after a dropped connection without starting over', async () => {
    const { client } = await signedInClient();
    const content = makeContent(CHUNK * 3);
    const { upload } = (await start(client, 'video.mp4', content.length)).data;

    expect((await sendPiece(client, upload.id, 0, content.subarray(0, CHUNK))).status).toBe(200);
    // Connection drops halfway through piece 1: only part of it arrives.
    const cut = await sendPiece(client, upload.id, 1, content.subarray(CHUNK, CHUNK + 30));
    expect(cut.status).toBe(400);
    expect(cut.data.error.code).toBe('CHUNK_INCOMPLETE');

    // Later (e.g. after reconnecting) the browser asks where to continue.
    const status = (await client.get(`/api/uploads/${upload.id}`)).data.upload;
    expect(status.receivedBytes).toBe(CHUNK);

    await sendAll(client, upload.id, content, status.receivedBytes);
    const done = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(done.status).toBe(200);
    const row = await prisma.file.findUniqueOrThrow({ where: { id: done.data.file.id } });
    expect(Buffer.from(memoryStorage.objects.get(row.storageKey)!).equals(Buffer.from(content))).toBe(true);
  });

  it('tells the browser where to continue when pieces arrive out of order or twice', async () => {
    const { client } = await signedInClient();
    const content = makeContent(CHUNK * 2);
    const { upload } = (await start(client, 'a.txt', content.length)).data;

    const early = await sendPiece(client, upload.id, 1, content.subarray(CHUNK));
    expect(early.status).toBe(409);
    expect(early.data.error).toMatchObject({ code: 'UPLOAD_OUT_OF_SYNC', details: { receivedBytes: 0 } });

    await sendPiece(client, upload.id, 0, content.subarray(0, CHUNK));
    const repeated = await sendPiece(client, upload.id, 0, content.subarray(0, CHUNK)); // reply was "lost"
    expect(repeated.status).toBe(409);
    expect(repeated.data.error.details.receivedBytes).toBe(CHUNK);
  });

  it('refuses to complete early and is safe to complete twice', async () => {
    const { client } = await signedInClient();
    const content = makeContent(CHUNK + 5);
    const { upload } = (await start(client, 'a.txt', content.length)).data;
    await sendPiece(client, upload.id, 0, content.subarray(0, CHUNK));

    const early = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(early.status).toBe(409);
    expect(early.data.error.code).toBe('UPLOAD_INCOMPLETE');

    await sendPiece(client, upload.id, 1, content.subarray(CHUNK));
    const first = await client.post(`/api/uploads/${upload.id}/complete`);
    const second = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(second.status).toBe(200);
    expect(second.data.file.id).toBe(first.data.file.id);
    expect(await prisma.file.count()).toBe(1);
  });

  it('handles empty files', async () => {
    const { client } = await signedInClient();
    const { upload } = (await start(client, 'empty.txt', 0)).data;
    const done = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(done.status).toBe(200);
    expect(done.data.file.size).toBe(0);
  });

  it('checks type, size and quota (including uploads still in progress) before starting', async () => {
    const { client } = await signedInClient();
    expect((await start(client, 'virus.exe', 10)).status).toBe(415);
    expect((await start(client, 'big.mp4', MB + 1)).status).toBe(413); // MAX_UPLOAD_MB=1 in tests

    // Quota is 3 MB: three 1 MB uploads in progress reserve all of it.
    for (let i = 0; i < 3; i++) expect((await start(client, `p${i}.mp4`, MB)).status).toBe(201);
    const over = await start(client, 'one-more.txt', 1);
    expect(over.status).toBe(507);
    expect(over.data.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('cancels an upload and deletes the pieces received so far', async () => {
    const { client } = await signedInClient();
    const content = makeContent(CHUNK * 2);
    const { upload } = (await start(client, 'a.txt', content.length)).data;
    await sendPiece(client, upload.id, 0, content.subarray(0, CHUNK));
    expect(memoryStorage.parts.size).toBe(1);

    const cancelled = await client.post(`/api/uploads/${upload.id}/cancel`);
    expect(cancelled.data.upload.status).toBe('cancelled');
    expect(memoryStorage.parts.size).toBe(0);

    const after = await sendPiece(client, upload.id, 1, content.subarray(CHUNK));
    expect(after.status).toBe(409);
    expect(after.data.error.code).toBe('UPLOAD_NOT_ACTIVE');
  });

  it('puts the file in My Drive if its folder was deleted during the upload', async () => {
    const { client } = await signedInClient();
    const folder = (await client.post('/api/folders', { json: { name: 'F' } })).data.folder;
    const content = makeContent(10);
    const { upload } = (await start(client, 'a.txt', content.length, folder.id)).data;
    await client.delete(`/api/folders/${folder.id}`); // to Trash
    await sendAll(client, upload.id, content);
    const done = await client.post(`/api/uploads/${upload.id}/complete`);
    expect(done.data.file.folderId).toBeNull();
  });

  it('clears finished entries from the history but keeps uploads in progress', async () => {
    const { client } = await signedInClient();
    const a = (await start(client, 'done.txt', 0)).data.upload;
    await client.post(`/api/uploads/${a.id}/complete`);
    const b = (await start(client, 'cancelled.txt', 5)).data.upload;
    await client.post(`/api/uploads/${b.id}/cancel`);
    const c = (await start(client, 'running.txt', 5)).data.upload;

    expect((await client.delete('/api/uploads')).data).toEqual({ removed: 2 });
    const left = (await client.get('/api/uploads')).data.uploads.map((u: { id: string }) => u.id);
    expect(left).toEqual([c.id]);

    expect((await client.delete(`/api/uploads/${c.id}`)).status).toBe(200);
    expect((await client.get('/api/uploads')).data.uploads).toEqual([]);
  });

  it("never lets one user see or touch another user's uploads", async () => {
    const alice = await signedInClient('Alice');
    const bob = await signedInClient('Bob');
    const content = makeContent(CHUNK + 1);
    const { upload } = (await start(alice.client, 'private.txt', content.length)).data;

    const c = bob.client;
    const results = [
      await c.get(`/api/uploads/${upload.id}`),
      await sendPiece(c, upload.id, 0, content.subarray(0, CHUNK)),
      await c.post(`/api/uploads/${upload.id}/complete`),
      await c.post(`/api/uploads/${upload.id}/cancel`),
      await c.delete(`/api/uploads/${upload.id}`),
    ];
    for (const r of results) expect(r.status).toBe(404);
    expect((await c.get('/api/uploads')).data.uploads).toEqual([]);
    expect((await c.delete('/api/uploads')).data.removed).toBe(0);
    expect((await alice.client.get(`/api/uploads/${upload.id}`)).data.upload.status).toBe('uploading');

    // Bob also cannot start an upload into Alice's folder.
    const folder = (await alice.client.post('/api/folders', { json: { name: 'A' } })).data.folder;
    expect((await start(c, 'x.txt', 1, folder.id)).status).toBe(404);
  });
});
