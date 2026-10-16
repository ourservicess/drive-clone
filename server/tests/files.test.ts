import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { memoryStorage, resetAll, signedInClient, type TestClient } from './helpers.js';

beforeEach(resetAll);
afterAll(() => prisma.$disconnect());

async function uploadOne(client: TestClient, name: string, content = 'content', folderId?: string) {
  const res = await client.upload([{ name, content }], folderId);
  expect(res.status).toBe(201);
  return res.data.files[0];
}

async function newFolder(client: TestClient, name: string, parentId?: string) {
  const res = await client.post('/api/folders', { json: { name, parentId } });
  expect(res.status).toBe(201);
  return res.data.folder;
}

describe('files', () => {
  it('uploads multiple files and lists them with sorting', async () => {
    const { client, user } = await signedInClient('Owner Name');
    const res = await client.upload([
      { name: 'b.txt', content: 'bb' },
      { name: 'a.txt', content: 'aaaa' },
      { name: 'c.txt', content: 'c' },
    ]);
    expect(res.status).toBe(201);
    expect(res.data.files).toHaveLength(3);
    expect(res.data.files[0].owner).toEqual({ id: user.id, name: 'Owner Name', email: user.email });

    const byName = await client.get('/api/files?sort=name&order=asc');
    expect(byName.data.files.map((f: { name: string }) => f.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    const bySize = await client.get('/api/files?sort=size&order=desc');
    expect(bySize.data.files.map((f: { name: string }) => f.name)).toEqual(['a.txt', 'b.txt', 'c.txt']);
    const badSort = await client.get('/api/files?sort=owner');
    expect(badSort.status).toBe(400);
  });

  it('renames duplicates instead of overwriting', async () => {
    const { client } = await signedInClient();
    await uploadOne(client, 'report.pdf');
    const second = await uploadOne(client, 'report.pdf');
    const third = await uploadOne(client, 'Report.pdf');
    expect(second.name).toBe('report (1).pdf');
    expect(third.name).toBe('Report (2).pdf');
    expect(memoryStorage.objects.size).toBe(3);
  });

  it('renames a file (with duplicate protection)', async () => {
    const { client } = await signedInClient();
    const a = await uploadOne(client, 'a.txt');
    await uploadOne(client, 'b.txt');
    const res = await client.patch(`/api/files/${a.id}`, { json: { name: 'b.txt' } });
    expect(res.status).toBe(200);
    expect(res.data.file.name).toBe('b (1).txt');
    const empty = await client.patch(`/api/files/${a.id}`, { json: { name: '   ' } });
    expect(empty.status).toBe(400);
  });

  it('previews text (including HTML, as plain text) and gives download URLs', async () => {
    const { client } = await signedInClient();
    const txt = await uploadOne(client, 'hello.txt', 'Hello world');
    const html = await uploadOne(client, 'page.html', '<script>alert(1)</script>');
    const pdf = await uploadOne(client, 'doc.pdf', '%PDF-1.4');
    const zip = await uploadOne(client, 'archive.zip', 'PK');

    expect((await client.get(`/api/files/${txt.id}/preview`)).data).toEqual({
      kind: 'text',
      content: 'Hello world',
      truncated: false,
    });
    const htmlPreview = (await client.get(`/api/files/${html.id}/preview`)).data;
    expect(htmlPreview.kind).toBe('text'); // shown as source, never rendered
    const pdfPreview = (await client.get(`/api/files/${pdf.id}/preview`)).data;
    expect(pdfPreview.kind).toBe('pdf');
    expect(decodeURIComponent(pdfPreview.url)).toContain('inline');
    expect((await client.get(`/api/files/${zip.id}/preview`)).data.kind).toBe('none');

    const download = (await client.get(`/api/files/${html.id}/download`)).data;
    expect(decodeURIComponent(download.url)).toContain('attachment');
    expect(download.expiresIn).toBe(60);
  });

  it('stars files and lists starred and recent files', async () => {
    const { client } = await signedInClient();
    const a = await uploadOne(client, 'a.txt');
    const b = await uploadOne(client, 'b.txt');
    expect((await client.post(`/api/files/${a.id}/star`, { json: { starred: true } })).data.file.starred).toBe(true);
    const starred = await client.get('/api/files/starred');
    expect(starred.data.files.map((f: { id: string }) => f.id)).toEqual([a.id]);

    await client.get(`/api/files/${b.id}/preview`); // opening a file makes it most recent
    await client.get(`/api/files/${a.id}/preview`);
    const recent = await client.get('/api/files/recent');
    expect(recent.data.files[0].id).toBe(a.id);
  });

  it('searches by filename, case-insensitively', async () => {
    const { client } = await signedInClient();
    await uploadOne(client, 'Holiday Photos.zip');
    await uploadOne(client, 'budget.xlsx');
    await newFolder(client, 'Holiday plans');
    const res = await client.get('/api/files/search?q=holiday');
    expect(res.data.files.map((f: { name: string }) => f.name)).toEqual(['Holiday Photos.zip']);
    expect(res.data.folders.map((f: { name: string }) => f.name)).toEqual(['Holiday plans']);
    expect((await client.get('/api/files/search?q=')).status).toBe(400);
  });

  it('treats special characters in search literally', async () => {
    const { client } = await signedInClient();
    await uploadOne(client, 'notes (draft) v1.2.txt');
    await uploadOne(client, 'notes draft v1x2.txt');
    for (const q of ['(draft', 'v1.2', '.*', '[a-']) {
      const res = await client.get(`/api/files/search?q=${encodeURIComponent(q)}`);
      expect(res.status).toBe(200);
      const names = res.data.files.map((f: { name: string }) => f.name);
      expect(names).toEqual(q === '(draft' || q === 'v1.2' ? ['notes (draft) v1.2.txt'] : []);
    }
  });

  it('reports storage usage', async () => {
    const { client } = await signedInClient();
    await uploadOne(client, 'a.txt', '12345');
    const usage = (await client.get('/api/storage/usage')).data;
    expect(usage).toEqual({ used: 5, quota: 3 * 1024 * 1024, fileCount: 1, maxUploadBytes: 1024 * 1024 });
  });
});

describe('folders', () => {
  it('creates nested folders with breadcrumbs and lists contents', async () => {
    const { client } = await signedInClient();
    const docs = await newFolder(client, 'Docs');
    const work = await newFolder(client, 'Work', docs.id);
    await uploadOne(client, 'plan.txt', 'x', work.id);

    const details = await client.get(`/api/folders/${work.id}`);
    expect(details.data.breadcrumbs).toEqual([
      { id: docs.id, name: 'Docs' },
      { id: work.id, name: 'Work' },
    ]);
    expect((await client.get(`/api/folders?parentId=${docs.id}`)).data.folders).toHaveLength(1);
    expect((await client.get(`/api/files?folderId=${work.id}`)).data.files).toHaveLength(1);
    expect((await client.get('/api/files')).data.files).toHaveLength(0); // not at the top level

    const dup = await newFolder(client, 'Docs');
    expect(dup.name).toBe('Docs (1)');
  });

  it('moves files and folders, but never a folder into itself', async () => {
    const { client } = await signedInClient();
    const a = await newFolder(client, 'A');
    const b = await newFolder(client, 'B', a.id);
    const file = await uploadOne(client, 'f.txt');

    const moved = await client.patch(`/api/files/${file.id}`, { json: { folderId: b.id } });
    expect(moved.data.file.folderId).toBe(b.id);
    const back = await client.patch(`/api/files/${file.id}`, { json: { folderId: null } });
    expect(back.data.file.folderId).toBeNull();

    const loop = await client.patch(`/api/folders/${a.id}`, { json: { parentId: b.id } });
    expect(loop.status).toBe(400);
    expect(loop.data.error.code).toBe('INVALID_MOVE');

    const renamed = await client.patch(`/api/folders/${b.id}`, { json: { name: 'Renamed', parentId: null } });
    expect(renamed.data.folder).toMatchObject({ name: 'Renamed', parentId: null });
  });
});

describe('trash', () => {
  it('moves a file to Trash, restores it, then deletes it permanently', async () => {
    const { client } = await signedInClient();
    const file = await uploadOne(client, 'a.txt');

    expect((await client.delete(`/api/files/${file.id}`)).status).toBe(200);
    expect((await client.get('/api/files')).data.files).toHaveLength(0);
    expect((await client.get('/api/trash')).data.files).toHaveLength(1);

    expect((await client.post(`/api/files/${file.id}/restore`)).status).toBe(200);
    expect((await client.get('/api/files')).data.files).toHaveLength(1);

    // Permanent delete requires the file to be in Trash first.
    const notTrashed = await client.delete(`/api/files/${file.id}/permanent`);
    expect(notTrashed.status).toBe(409);

    await client.delete(`/api/files/${file.id}`);
    expect((await client.delete(`/api/files/${file.id}/permanent`)).status).toBe(200);
    expect(memoryStorage.objects.size).toBe(0);
    expect(await prisma.file.count()).toBe(0);
  });

  it('trashes a folder with everything inside and restores it together', async () => {
    const { client } = await signedInClient();
    const top = await newFolder(client, 'Top');
    const sub = await newFolder(client, 'Sub', top.id);
    const inner = await uploadOne(client, 'inner.txt', 'x', sub.id);
    const deletedEarlier = await uploadOne(client, 'old.txt', 'x', top.id);
    await client.delete(`/api/files/${deletedEarlier.id}`); // trashed separately first

    await client.delete(`/api/folders/${top.id}`);
    const trash = (await client.get('/api/trash')).data;
    expect(trash.folders.map((f: { id: string }) => f.id)).toEqual([top.id]); // only the deleted folder is listed
    expect(trash.files.map((f: { id: string }) => f.id)).toEqual([deletedEarlier.id]);
    expect((await client.get(`/api/files/${inner.id}`)).status).toBe(404); // hidden while in Trash
    expect((await client.get('/api/files/search?q=inner')).data.files).toHaveLength(0);

    await client.post(`/api/folders/${top.id}/restore`);
    expect((await client.get(`/api/files/${inner.id}`)).status).toBe(200);
    expect((await client.get(`/api/folders/${sub.id}`)).status).toBe(200);
    // The file deleted on its own earlier stays in Trash.
    expect((await client.get('/api/trash')).data.files.map((f: { id: string }) => f.id)).toEqual([
      deletedEarlier.id,
    ]);
  });

  it('restores a file to My Drive if its folder is still in Trash', async () => {
    const { client } = await signedInClient();
    const folder = await newFolder(client, 'F');
    const file = await uploadOne(client, 'a.txt', 'x', folder.id);
    await client.delete(`/api/files/${file.id}`);
    await client.delete(`/api/folders/${folder.id}`);
    const restored = await client.post(`/api/files/${file.id}/restore`);
    expect(restored.data.file.folderId).toBeNull();
  });

  it('permanently deletes a folder tree and its stored objects', async () => {
    const { client } = await signedInClient();
    const top = await newFolder(client, 'Top');
    const sub = await newFolder(client, 'Sub', top.id);
    await uploadOne(client, '1.txt', 'x', top.id);
    await uploadOne(client, '2.txt', 'x', sub.id);
    const keep = await uploadOne(client, 'keep.txt');
    expect(memoryStorage.objects.size).toBe(3);

    await client.delete(`/api/folders/${top.id}`);
    expect((await client.delete(`/api/folders/${top.id}/permanent`)).status).toBe(200);
    expect(memoryStorage.objects.size).toBe(1);
    expect(await prisma.folder.count()).toBe(0);
    expect((await client.get(`/api/files/${keep.id}`)).status).toBe(200);
  });

  it('empties the Trash', async () => {
    const { client } = await signedInClient();
    const folder = await newFolder(client, 'F');
    await uploadOne(client, 'in-folder.txt', 'x', folder.id);
    const loose = await uploadOne(client, 'loose.txt');
    const keep = await uploadOne(client, 'keep.txt');
    await client.delete(`/api/folders/${folder.id}`);
    await client.delete(`/api/files/${loose.id}`);

    const res = await client.delete('/api/trash');
    expect(res.data).toEqual({ deletedFiles: 2, deletedFolders: 1 });
    expect(memoryStorage.objects.size).toBe(1);
    expect((await client.get('/api/files')).data.files.map((f: { id: string }) => f.id)).toEqual([keep.id]);
  });
});
