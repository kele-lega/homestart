import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/suggestions', () => ({
  listSuggestions: vi.fn(),
  submitSuggestion: vi.fn(),
  markSuggestion: vi.fn(),
  removeSuggestion: vi.fn(),
}));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ADMIN: App.Locals['auth'] = { sessionId: 10, userId: 1, username: 'root', displayName: '站长', role: 'admin' };
const USER: App.Locals['auth'] = { sessionId: 20, userId: 2, username: 'alice', displayName: null, role: 'user' };
const ID = '00000000-0000-4000-8000-000000000001';
const LIST = [{ id: ID, body: '加个暗色模式', username: 'alice', author: 'alice', createdAt: 1, done: false }];
const logger = { error: vi.fn() };

const CODE = '1234';

async function setup() {
  vi.resetModules();
  // 每道题的答案固定成 CODE；验证码本身的随机、过期、作废见 tests/core/captcha.test.ts
  vi.stubEnv('SUGGESTION_CAPTCHA_FIXED', CODE);
  const listModule = await import('../../src/pages/api/suggestions');
  const idModule = await import('../../src/pages/api/suggestions/[id]');
  const captchaModule = await import('../../src/pages/api/suggestions/captcha');
  vi.unstubAllEnvs();
  const store = await import('../../src/adapters/suggestions');
  const context = (request: Request, auth: App.Locals['auth'], params = {}) =>
    ({ request, locals: { auth }, params, logger }) as unknown as APIContext;
  const url = 'http://localhost/api/suggestions';
  const captcha = (auth: App.Locals['auth'], headers: Record<string, string> = SAME_ORIGIN) =>
    captchaModule.GET(context(new Request(`${url}/captcha`, { headers }), auth));
  const captchaId = async (auth: App.Locals['auth']) => ((await (await captcha(auth)).json()) as { data: { id: string } }).data.id;
  const post = (auth: App.Locals['auth'], body: unknown, headers = JSON_HEADERS) =>
    listModule.POST(context(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }), auth));
  return {
    list: (auth: App.Locals['auth']) => listModule.GET(context(new Request(url, { headers: SAME_ORIGIN }), auth)),
    captcha,
    captchaId,
    post,
    /** 先领一道题、填上正确答案再提交 */
    submit: async (auth: App.Locals['auth'], body: Record<string, unknown>, headers = JSON_HEADERS) =>
      post(auth, { captchaId: auth ? await captchaId(auth) : 'none', captcha: CODE, ...body }, headers),
    mark: (auth: App.Locals['auth'], id: string, body: unknown) =>
      idModule.PATCH(
        context(new Request(`${url}/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify(body) }), auth, { id }),
      ),
    remove: (auth: App.Locals['auth'], id: string) =>
      idModule.DELETE(context(new Request(`${url}/${id}`, { method: 'DELETE', headers: JSON_HEADERS }), auth, { id })),
    store: {
      list: vi.mocked(store.listSuggestions),
      submit: vi.mocked(store.submitSuggestion),
      mark: vi.mocked(store.markSuggestion),
      remove: vi.mocked(store.removeSuggestion),
    },
  };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  logger.error.mockReset();
  api = await setup();
  api.store.list.mockResolvedValue(LIST);
  api.store.submit.mockResolvedValue();
  api.store.mark.mockResolvedValue([{ ...LIST[0]!, done: true }]);
  api.store.remove.mockResolvedValue([]);
});

describe('POST /api/suggestions', () => {
  it('lets a signed-in user submit, stamped with their name, without seeing the list', async () => {
    const response = await api.submit(USER, { body: '  加个暗色模式\r\n谢谢  ' });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { submitted: true }, error: null });
    expect(api.store.submit).toHaveBeenCalledWith({ body: '加个暗色模式\n谢谢' }, { username: 'alice', author: 'alice' });
  });

  it('uses the display name when there is one', async () => {
    await api.submit(ADMIN, { body: '一' });
    expect(api.store.submit).toHaveBeenCalledWith({ body: '一' }, { username: 'root', author: '站长' });
  });

  it('needs a site login', async () => {
    expect((await api.submit(undefined, { body: '一' })).status).toBe(401);
    expect(api.store.submit).not.toHaveBeenCalled();
  });

  it('rejects empty, too long and cross-site submissions', async () => {
    expect((await api.submit(USER, { body: '   ' })).status).toBe(400);
    expect((await api.submit(USER, { body: '字'.repeat(501) })).status).toBe(400);
    expect((await api.submit(USER, { body: '一' }, { 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' })).status).toBe(403);
    expect(api.store.submit).not.toHaveBeenCalled();
  });

  it('needs the captcha answered right, once, by whoever fetched it', async () => {
    const id = await api.captchaId(USER);
    const wrong = await api.post(USER, { body: '一', captchaId: id, captcha: '0000' });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toMatchObject({ error: expect.stringContaining('验证码不对') });
    // 答错一次这道题就作废，再填对也不行
    expect((await api.post(USER, { body: '一', captchaId: id, captcha: CODE })).status).toBe(400);

    // 拿别人领的题也不行（答错也算一次提交，换个人提交，别把 USER 的额度用完）
    const others = await api.captchaId(USER);
    expect((await api.post(ADMIN, { body: '一', captchaId: others, captcha: CODE })).status).toBe(400);
    expect((await api.post(USER, { body: '一' })).status).toBe(400);
    expect(api.store.submit).not.toHaveBeenCalled();

    const fresh = await api.captchaId(USER);
    expect((await api.post(USER, { body: '一', captchaId: fresh, captcha: CODE })).status).toBe(200);
    expect((await api.post(USER, { body: '二', captchaId: fresh, captcha: CODE })).status).toBe(400);
    expect(api.store.submit).toHaveBeenCalledTimes(1);
  });

  it('hands out captchas only to signed-in users, same-site, rate limited', async () => {
    const response = await api.captcha(USER);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ data: { id: expect.any(String), image: expect.stringMatching(/^data:image\/svg\+xml;base64,/) } });
    expect((await api.captcha(undefined)).status).toBe(401);
    expect((await api.captcha(USER, { 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    for (let index = 1; index < 15; index += 1) expect((await api.captcha(USER)).status).toBe(200);
    expect((await api.captcha(USER)).status).toBe(429);
  });

  it('limits how often one user can submit', async () => {
    for (let index = 0; index < 5; index += 1) expect((await api.submit(USER, { body: '一' })).status).toBe(200);
    expect((await api.submit(USER, { body: '一' })).status).toBe(429);
  });

  it('hides storage errors behind a generic message', async () => {
    api.store.submit.mockRejectedValue(new Error('/data/suggestions.json: EACCES'));
    const response = await api.submit(USER, { body: '一' });

    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('EACCES');
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('admin suggestion management', () => {
  it('only admins can list, mark and remove', async () => {
    for (const auth of [undefined, USER]) {
      expect((await api.list(auth)).status).toBe(403);
      expect((await api.mark(auth, ID, { done: true })).status).toBe(403);
      expect((await api.remove(auth, ID)).status).toBe(403);
    }
    expect(api.store.list).not.toHaveBeenCalled();
    expect(api.store.mark).not.toHaveBeenCalled();
    expect(api.store.remove).not.toHaveBeenCalled();
  });

  it('lists, marks and removes for an admin, returning the whole list', async () => {
    expect(await (await api.list(ADMIN)).json()).toMatchObject({ data: LIST });
    expect(await (await api.mark(ADMIN, ID, { done: true })).json()).toMatchObject({ data: [{ done: true }] });
    expect(api.store.mark).toHaveBeenCalledWith(ID, true);
    expect(await (await api.remove(ADMIN, ID)).json()).toMatchObject({ data: [] });
  });

  it('rejects bad ids and bodies', async () => {
    expect((await api.mark(ADMIN, 'nope', { done: true })).status).toBe(404);
    expect((await api.remove(ADMIN, '../x')).status).toBe(404);
    expect((await api.mark(ADMIN, ID, { done: 'yes' })).status).toBe(400);
  });
});
