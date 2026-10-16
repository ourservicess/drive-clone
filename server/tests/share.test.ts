import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/db.js';
import { resetAll, signedInClient, TestClient } from './helpers.js';

beforeEach(resetAll);
afterAll(() => prisma.$disconnect());

async function ownerWithFile(name = 'notes.txt', content = 'Shared hello') {
  const owner = await signedInClient('Olivia Owner');
  const file = (await owner.client.upload([{ name, content }])).data.files[0];
  return { owner, file };
}

const anonymous = () => new TestClient(); // no login cookie

describe('public share links', () => {
  it('lets anyone with the link preview the file without logging in', async () => {
    const { owner, file } = await ownerWithFile();
    const created = await owner.client.post(`/api/files/${file.id}/share`, { json: {} });
    expect(created.status).toBe(200);
    const { token, allowDownload } = created.data.share;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(allowDownload).toBe(false); // preview-only by default

    const info = await anonymous().get(`/api/public/${token}`);
    expect(info.status).toBe(200);
    expect(info.data.file).toEqual({
      name: 'notes.txt',
      mimeType: 'text/plain',
      size: 12,
      createdAt: expect.any(String),
      ownerName: 'Olivia Owner',
      allowDownload: false,
    });
    // Nothing private leaks: no ids, storage keys or email.
    expect(JSON.stringify(info.data)).not.toMatch(/storageKey|@example\.com|ownerId/);

    const preview = await anonymous().get(`/api/public/${token}/preview`);
    expect(preview.data).toEqual({ kind: 'text', content: 'Shared hello', truncated: false });

    const listed = (await owner.client.get('/api/files')).data.files[0];
    expect(listed.shared).toBe(true);
  });

  it('blocks downloading unless the owner allows it', async () => {
    const { owner, file } = await ownerWithFile();
    const { token } = (await owner.client.post(`/api/files/${file.id}/share`, { json: {} })).data.share;

    const blocked = await anonymous().get(`/api/public/${token}/download`);
    expect(blocked.status).toBe(403);
    expect(blocked.data.error.code).toBe('DOWNLOAD_DISABLED');

    const updated = await owner.client.post(`/api/files/${file.id}/share`, { json: { allowDownload: true } });
    expect(updated.data.share.token).toBe(token); // same link, new setting
    const allowed = await anonymous().get(`/api/public/${token}/download`);
    expect(allowed.status).toBe(200);
    expect(decodeURIComponent(allowed.data.url)).toContain('attachment');
  });

  it('stops working when sharing is turned off, while in Trash, and after deleting forever', async () => {
    const { owner, file } = await ownerWithFile();
    let token = (await owner.client.post(`/api/files/${file.id}/share`, { json: {} })).data.share.token;

    await owner.client.delete(`/api/files/${file.id}/share`);
    expect((await anonymous().get(`/api/public/${token}`)).status).toBe(404);
    expect((await owner.client.get(`/api/files/${file.id}/share`)).data.share).toBeNull();
    expect((await owner.client.get('/api/files')).data.files[0].shared).toBe(false);

    token = (await owner.client.post(`/api/files/${file.id}/share`, { json: {} })).data.share.token;
    await owner.client.delete(`/api/files/${file.id}`); // to Trash
    expect((await anonymous().get(`/api/public/${token}`)).status).toBe(404);
    await owner.client.post(`/api/files/${file.id}/restore`);
    expect((await anonymous().get(`/api/public/${token}`)).status).toBe(200);

    await owner.client.delete(`/api/files/${file.id}`);
    await owner.client.delete(`/api/files/${file.id}/permanent`);
    expect((await anonymous().get(`/api/public/${token}`)).status).toBe(404);
    expect(await prisma.shareLink.count()).toBe(0);
  });

  it("does not let another user share or inspect someone else's file", async () => {
    const { file } = await ownerWithFile();
    const bob = await signedInClient('Bob');
    expect((await bob.client.post(`/api/files/${file.id}/share`, { json: {} })).status).toBe(404);
    expect((await bob.client.get(`/api/files/${file.id}/share`)).status).toBe(404);
    expect((await bob.client.delete(`/api/files/${file.id}/share`)).status).toBe(404);
    expect(await prisma.shareLink.count()).toBe(0);
  });

  it('rejects malformed and unknown links', async () => {
    expect((await anonymous().get('/api/public/not-a-token')).status).toBe(400);
    expect((await anonymous().get(`/api/public/${'A'.repeat(43)}`)).status).toBe(404);
  });
});
