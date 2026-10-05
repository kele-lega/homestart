import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/announcements', () => ({
  listAnnouncements: vi.fn(),
  publishAnnouncement: vi.fn(),
  removeAnnouncement: vi.fn(),
}));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ADMIN: App.Locals['auth'] = { sessionId: 10, userId: 1, username: 'root', displayName: '站长', role: 'admin' };
const USER: App.Locals['auth'] = { sessionId: 20, userId: 2, username: 'alice', displayName: null, role: 'user' };
const ID = '00000000-0000-4000-8000-000000000001';
const LIST = [{ id: ID, title: '停机维护', body: '', createdAt: 1, author: '站长' }];
const logger = { error: vi.fn() };

async function setup() {
  vi.resetModules();
  const listModule = await import('../../src/pages/api/announcements');
  const idModule = await import('../../src/pages/api/announcements/[id]');
  const store = await import('../../src/adapters/announcements');
  const context = (request: Request, auth: App.Locals['auth'], params = {}) =>
    ({ request, locals: { auth }, params, logger }) as unknown as APIContext;
  const list = (headers: Record<string, string> = SAME_ORIGIN) =>
    listModule.GET(context(new Request('http://localhost/api/announcements', { headers }), undefined));
  const publish = (auth: App.Locals['auth'], body: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    listModule.POST(
      context(new Request('http://localhost/api/announcements', { method: 'POST', headers, body: JSON.stringify(body) }), auth),
    );
  const remove = (auth: App.Locals['auth'], id: string) =>
    idModule.DELETE(
      context(new Request(`http://localhost/api/announcements/${id}`, { method: 'DELETE', headers: SAME_ORIGIN }), auth, { id }),
    );
  return {
    list,
    publish,
    remove,
    listAnnouncements: vi.mocked(store.listAnnouncements),
    publishAnnouncement: vi.mocked(store.publishAnnouncement),
    removeAnnouncement: vi.mocked(store.removeAnnouncement),
  };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  logger.error.mockReset();
  api = await setup();
});

describe('GET /api/announcements', () => {
  it('lists announcements for anyone, signed in or not', async () => {
    api.listAnnouncements.mockResolvedValue(LIST);
    const response = await api.list();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: LIST, error: null });
  });

  it('rejects cross-site requests', async () => {
    expect((await api.list({ 'sec-fetch-site': 'cross-site' })).status).toBe(403);
  });
});

describe('POST /api/announcements', () => {
  it('publishes as the admin, signed with their nickname, and returns the whole list', async () => {
    api.publishAnnouncement.mockResolvedValue(LIST);
    const response = await api.publish(ADMIN, { title: '  停机维护 ', body: '' });
    expect(response.status).toBe(200);
    expect(api.publishAnnouncement).toHaveBeenCalledWith({ title: '停机维护', body: '' }, '站长');
    expect((await response.json()).data).toEqual(LIST);
  });

  it('only lets admins publish', async () => {
    expect((await api.publish(USER, { title: 'x', body: '' })).status).toBe(403);
    expect((await api.publish(undefined, { title: 'x', body: '' })).status).toBe(403);
    expect(api.publishAnnouncement).not.toHaveBeenCalled();
  });

  it('explains what is wrong with the input', async () => {
    const response = await api.publish(ADMIN, { title: '', body: '' });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('请填写标题');
    expect((await api.publish(ADMIN, { title: 'x', body: '' }, SAME_ORIGIN)).status).toBe(415);
  });

  it('logs a store failure and answers with a generic message', async () => {
    api.publishAnnouncement.mockRejectedValue(new Error('disk full'));
    const response = await api.publish(ADMIN, { title: 'x', body: '' });
    expect(response.status).toBe(500);
    expect((await response.json()).error).not.toContain('disk');
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('disk full'));
  });
});

describe('DELETE /api/announcements/:id', () => {
  it('removes for an admin and returns what is left', async () => {
    api.removeAnnouncement.mockResolvedValue([]);
    const response = await api.remove(ADMIN, ID);
    expect(response.status).toBe(200);
    expect(api.removeAnnouncement).toHaveBeenCalledWith(ID);
  });

  it('rejects non-admins and ids that are not ours', async () => {
    expect((await api.remove(USER, ID)).status).toBe(403);
    expect((await api.remove(ADMIN, '..%2Fetc')).status).toBe(404);
    expect(api.removeAnnouncement).not.toHaveBeenCalled();
  });
});
