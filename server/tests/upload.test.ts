import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { setStorageDriver, type StorageDriver } from '../src/lib/storage.js';
import { memoryStorage, resetAll, signedInClient } from './helpers.js';

beforeEach(async () => {
  await resetAll();
  setStorageDriver(memoryStorage);
});
afterAll(() => prisma.$disconnect());

// The test config sets MAX_UPLOAD_MB=1 and STORAGE_QUOTA_MB=3.
const MB = 1024 * 1024;

describe('upload validation', () => {
  it('accepts allowed types and derives the MIME type on the server', async () => {
    const { client } = await signedInClient();
    const form = new FormData();
    // The browser claims this is HTML, but the server decides from the extension.
    form.append('files', new File(['hello'], 'notes.txt', { type: 'text/html' }));
    const res = await client.post('/api/files/upload', { form });
    expect(res.status).toBe(201);
    expect(res.data.files[0]).toMatchObject({ name: 'notes.txt', mimeType: 'text/plain', size: 5 });
  });

  it('rejects disallowed file types', async () => {
    const { client } = await signedInClient();
    for (const name of ['virus.exe', 'script.ps1', 'run.bat', 'noextension']) {
      const res = await client.upload([{ name, content: 'x' }]);
      expect(res.status).toBe(415);
      expect(res.data.error.code).toBe('UNSUPPORTED_FILE_TYPE');
    }
    expect(memoryStorage.objects.size).toBe(0);
  });

  it('rejects files over the size limit', async () => {
    const { client } = await signedInClient();
    const res = await client.upload([{ name: 'big.txt', content: new Uint8Array(MB + 10) }]);
    expect(res.status).toBe(413);
    expect(res.data.error.code).toBe('FILE_TOO_LARGE');
    expect(memoryStorage.objects.size).toBe(0);
  });

  it('enforces the storage quota', async () => {
    const { client } = await signedInClient();
    const chunk = new Uint8Array(MB - 1000);
    for (let i = 0; i < 3; i++) {
      expect((await client.upload([{ name: `part${i}.txt`, content: chunk }])).status).toBe(201);
    }
    const res = await client.upload([{ name: 'one-too-many.txt', content: new Uint8Array(5000) }]);
    expect(res.status).toBe(507);
    expect(res.data.error.code).toBe('QUOTA_EXCEEDED');
  });

  it('rejects requests with no files or a non-multipart body', async () => {
    const { client } = await signedInClient();
    expect((await client.post('/api/files/upload', { form: new FormData() })).status).toBe(400);
    expect((await client.post('/api/files/upload', { json: { files: [] } })).status).toBe(400);
  });

  it('rejects an invalid folderId', async () => {
    const { client } = await signedInClient();
    const res = await client.upload([{ name: 'a.txt', content: 'a' }], '../../etc');
    expect(res.status).toBe(400);
  });

  it('neutralises path traversal in filenames and never uses the name as a storage key', async () => {
    const { client, user } = await signedInClient();
    const res = await client.upload([{ name: '..\\..\\windows\\evil.txt', content: 'x' }]);
    expect(res.status).toBe(201);
    const name: string = res.data.files[0].name;
    expect(name).not.toMatch(/[\\/]/);

    const row = await prisma.file.findFirstOrThrow({ where: { ownerId: user.id } });
    expect(row.storageKey).toMatch(new RegExp(`^users/${user.id}/[0-9a-f-]{36}$`));
    expect(JSON.stringify(res.data)).not.toContain('storageKey');
  });

  it('keeps non-English filenames intact', async () => {
    const { client } = await signedInClient();
    const res = await client.upload([{ name: 'résumé – 履歴書.txt', content: 'x' }]);
    expect(res.status).toBe(201);
    expect(res.data.files[0].name).toBe('résumé – 履歴書.txt');
  });

  it('accepts folderId before or after the files in the form', async () => {
    const { client } = await signedInClient();
    const folder = (await client.post('/api/folders', { json: { name: 'F' } })).data.folder;
    const form = new FormData();
    form.append('folderId', folder.id); // before the file this time
    form.append('files', new File(['x'], 'first.txt'));
    const res = await client.post('/api/files/upload', { form });
    expect(res.status).toBe(201);
    expect(res.data.files[0].folderId).toBe(folder.id);
  });

  it('is all-or-nothing: a bad file later in the request removes the earlier ones', async () => {
    const { client, user } = await signedInClient();
    const res = await client.upload([
      { name: 'good.txt', content: 'fine' },
      { name: 'bad.exe', content: 'MZ' },
    ]);
    expect(res.status).toBe(415);
    expect(memoryStorage.objects.size).toBe(0);
    expect(await prisma.file.count({ where: { ownerId: user.id } })).toBe(0);
  });

  it('limits the number of files per request', async () => {
    const { client } = await signedInClient();
    const many = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.txt`, content: 'x' }));
    const res = await client.upload(many);
    expect(res.status).toBe(400);
    expect(memoryStorage.objects.size).toBe(0);
  });

  it('cleans up stored objects when an upload fails part-way', async () => {
    const { client, user } = await signedInClient();
    let puts = 0;
    const flaky: StorageDriver = {
      ...memoryStorage,
      async putObject(key, body, type) {
        if (++puts === 2) throw new Error('simulated network failure');
        await memoryStorage.putObject(key, body, type);
      },
    };
    setStorageDriver(flaky);

    const res = await client.upload([
      { name: 'one.txt', content: '1' },
      { name: 'two.txt', content: '2' },
    ]);
    expect(res.status).toBe(502);
    expect(res.data.error.code).toBe('STORAGE_ERROR');
    expect(memoryStorage.objects.size).toBe(0); // the first object was removed again
    expect(await prisma.file.count({ where: { ownerId: user.id } })).toBe(0);
  });
});
