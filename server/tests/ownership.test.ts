import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { resetAll, signedInClient } from './helpers.js';

beforeEach(resetAll);
afterAll(() => prisma.$disconnect());

/**
 * Alice owns a folder and a file. Bob must not be able to see or change them,
 * even if he knows (or guesses) their ids. He always gets 404, so he cannot
 * even tell whether the id exists.
 */
async function setup() {
  const alice = await signedInClient('Alice');
  const bob = await signedInClient('Bob');
  const folder = (await alice.client.post('/api/folders', { json: { name: 'Private' } })).data.folder;
  const file = (await alice.client.upload([{ name: 'secret.txt', content: 'top secret' }], folder.id)).data
    .files[0];
  return { alice, bob, folder, file };
}

describe('ownership isolation', () => {
  it("hides other users' files and folders from listings and search", async () => {
    const { bob } = await setup();
    expect((await bob.client.get('/api/files')).data.files).toEqual([]);
    expect((await bob.client.get('/api/folders')).data.folders).toEqual([]);
    expect((await bob.client.get('/api/files/search?q=secret')).data.files).toEqual([]);
    expect((await bob.client.get('/api/files/recent')).data.files).toEqual([]);
    expect((await bob.client.get('/api/trash')).data.files).toEqual([]);
    expect((await bob.client.get('/api/storage/usage')).data.used).toBe(0);
  });

  it("returns 404 for every operation on another user's file", async () => {
    const { bob, file } = await setup();
    const c = bob.client;
    const results = [
      await c.get(`/api/files/${file.id}`),
      await c.get(`/api/files/${file.id}/download`),
      await c.get(`/api/files/${file.id}/preview`),
      await c.get(`/api/files/${file.id}/thumbnail`),
      await c.patch(`/api/files/${file.id}`, { json: { name: 'hacked.txt' } }),
      await c.post(`/api/files/${file.id}/star`, { json: { starred: true } }),
      await c.delete(`/api/files/${file.id}`),
      await c.post(`/api/files/${file.id}/restore`),
      await c.delete(`/api/files/${file.id}/permanent`),
    ];
    for (const r of results) expect(r.status).toBe(404);

    const stillThere = await prisma.file.findUniqueOrThrow({ where: { id: file.id } });
    expect(stillThere.name).toBe('secret.txt');
    expect(stillThere.trashedAt).toBeNull();
    expect(stillThere.starred).toBe(false);
  });

  it("returns 404 for every operation on another user's folder", async () => {
    const { bob, folder } = await setup();
    const c = bob.client;
    const results = [
      await c.get(`/api/folders/${folder.id}`),
      await c.get(`/api/folders?parentId=${folder.id}`),
      await c.get(`/api/files?folderId=${folder.id}`),
      await c.patch(`/api/folders/${folder.id}`, { json: { name: 'hacked' } }),
      await c.delete(`/api/folders/${folder.id}`),
      await c.post(`/api/folders/${folder.id}/restore`),
      await c.delete(`/api/folders/${folder.id}/permanent`),
    ];
    for (const r of results) expect(r.status).toBe(404);
  });

  it("cannot upload, create folders, or move items into another user's folder", async () => {
    const { bob, folder } = await setup();
    expect((await bob.client.upload([{ name: 'x.txt', content: 'x' }], folder.id)).status).toBe(404);
    expect((await bob.client.post('/api/folders', { json: { name: 'x', parentId: folder.id } })).status).toBe(404);

    const bobFile = (await bob.client.upload([{ name: 'mine.txt', content: 'mine' }])).data.files[0];
    const move = await bob.client.patch(`/api/files/${bobFile.id}`, { json: { folderId: folder.id } });
    expect(move.status).toBe(404);

    const bobFolder = (await bob.client.post('/api/folders', { json: { name: 'Mine' } })).data.folder;
    const moveFolder = await bob.client.patch(`/api/folders/${bobFolder.id}`, { json: { parentId: folder.id } });
    expect(moveFolder.status).toBe(404);
  });

  it('ignores an ownerId sent in the request body', async () => {
    const { alice, bob } = await setup();
    const res = await bob.client.post('/api/folders', {
      json: { name: 'Sneaky', ownerId: alice.user.id },
    });
    expect(res.status).toBe(201);
    const row = await prisma.folder.findUniqueOrThrow({ where: { id: res.data.folder.id } });
    expect(row.ownerId).toBe(bob.user.id);
  });
});
