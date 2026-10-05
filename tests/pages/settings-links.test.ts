import type { APIContext } from 'astro';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/user-links', () => ({ writeUserLinks: vi.fn() }));
vi.mock('../../src/adapters/site-icons/fetch', () => ({ fetchSiteIcon: vi.fn() }));
vi.mock('../../src/adapters/site-icons/store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/adapters/site-icons/store')>()),
  saveIcon: vi.fn(),
  readIcon: vi.fn(),
}));

const JSON_HEADERS = { 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);

async function setup() {
  vi.resetModules();
  const links = await import('../../src/pages/api/settings/links');
  const siteIcon = await import('../../src/pages/api/settings/site-icon');
  const file = await import('../../src/pages/site-icons/[file]');
  const { IconInputError } = await import('../../src/adapters/site-icons/store');
  const logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn() };
  const context = (method: string, path: string, body?: unknown, params: Record<string, string> = {}) => {
    const url = new URL(path, 'http://localhost');
    const init = { method, headers: JSON_HEADERS, body: body === undefined ? undefined : JSON.stringify(body) };
    return { request: new Request(url, init), url, locals: { auth: ALICE }, logger, params } as unknown as APIContext;
  };
  return {
    save: (body: unknown) => links.PUT(context('PUT', '/api/settings/links', body)),
    reset: () => links.DELETE(context('DELETE', '/api/settings/links')),
    icon: (body: unknown) => siteIcon.POST(context('POST', '/api/settings/site-icon', body)),
    serve: (name: string) => file.GET(context('GET', `/site-icons/${name}`, undefined, { file: name })),
    mocks: {
      writeUserLinks: vi.mocked((await import('../../src/adapters/user-links')).writeUserLinks),
      fetchSiteIcon: vi.mocked((await import('../../src/adapters/site-icons/fetch')).fetchSiteIcon),
      saveIcon: vi.mocked((await import('../../src/adapters/site-icons/store')).saveIcon),
      readIcon: vi.mocked((await import('../../src/adapters/site-icons/store')).readIcon),
    },
    IconInputError,
  };
}

let api: Awaited<ReturnType<typeof setup>>;
const body = async (response: Response) => (await response.json()) as { success: boolean; data: unknown; error: string | null };

beforeEach(async () => {
  api = await setup();
});

describe('PUT/DELETE /api/settings/links', () => {
  it('saves the cleaned-up navigation for the user and answers with it', async () => {
    const response = await api.save({ categories: [{ name: ' 工具 ', links: [{ name: '翻译', url: 'https://fanyi.example' }] }] });
    const saved = { categories: [{ name: '工具', links: [{ name: '翻译', url: 'https://fanyi.example/' }] }] };

    expect(await body(response)).toEqual({ success: true, data: saved, error: null });
    expect(api.mocks.writeUserLinks).toHaveBeenCalledWith('alice', saved);
  });

  it('says which category and site is wrong, and saves nothing', async () => {
    const response = await api.save({ categories: [{ name: '工具', links: [{ name: '', url: 'https://x.example' }] }] });

    expect(response.status).toBe(400);
    expect((await body(response)).error).toBe('第 1 个分类「工具」的第 1 个网站：网站名称不能为空');
    expect(api.mocks.writeUserLinks).not.toHaveBeenCalled();
  });

  it('accepts a full navigation bigger than the usual 4 KB body limit', async () => {
    const links = Array.from({ length: 24 }, (_, i) => ({ name: `网站 ${i}`, url: `https://site-${i}.example.com/some/long/path`, icon: '/site-icons/0123456789abcdef0123456789abcdef.png' }));
    const categories = Array.from({ length: 5 }, (_, i) => ({ name: `分类 ${i}`, links }));
    expect((await api.save({ categories })).status).toBe(200);
  });

  it('restores links.yaml on DELETE', async () => {
    expect(await body(await api.reset())).toEqual({ success: true, data: null, error: null });
    expect(api.mocks.writeUserLinks).toHaveBeenCalledWith('alice', undefined);
  });
});

describe('POST /api/settings/site-icon', () => {
  it('fetches a site icon and stores it', async () => {
    api.mocks.fetchSiteIcon.mockResolvedValue(PNG);
    api.mocks.saveIcon.mockResolvedValue('/site-icons/0123456789abcdef0123456789abcdef.png');

    expect((await body(await api.icon({ url: 'https://example.com' }))).data).toEqual({ icon: '/site-icons/0123456789abcdef0123456789abcdef.png' });
    expect(api.mocks.fetchSiteIcon).toHaveBeenCalledWith('https://example.com', expect.anything());
    expect(api.mocks.saveIcon).toHaveBeenCalledWith(PNG);
  });

  it('stores an uploaded image, with or without the data: prefix', async () => {
    api.mocks.saveIcon.mockResolvedValue('/site-icons/0123456789abcdef0123456789abcdef.png');
    const base64 = Buffer.from(PNG).toString('base64');

    expect((await api.icon({ image: `data:image/png;base64,${base64}` })).status).toBe(200);
    expect((await api.icon({ image: base64 })).status).toBe(200);
    expect(api.mocks.saveIcon).toHaveBeenNthCalledWith(1, PNG);
  });

  it('turns unusable images into a readable 400', async () => {
    api.mocks.saveIcon.mockRejectedValue(new api.IconInputError('只支持 PNG、JPG、GIF、WebP、ICO、SVG 图片'));
    const response = await api.icon({ image: 'aGVsbG8=' });
    expect([response.status, (await body(response)).error]).toEqual([400, '只支持 PNG、JPG、GIF、WebP、ICO、SVG 图片']);
    expect((await api.icon({ image: '!!not base64!!' })).status).toBe(400);
    expect((await api.icon({ url: 'ftp://x' })).status).toBe(400);
  });
});

describe('GET /site-icons/<file>', () => {
  it('serves stored icons for a long time with a script-blocking CSP', async () => {
    api.mocks.readIcon.mockResolvedValue({ bytes: Buffer.from('<svg/>'), type: 'svg' });
    const response = await api.serve('0123456789abcdef0123456789abcdef.svg');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/svg+xml');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('answers 404 for anything else', async () => {
    api.mocks.readIcon.mockResolvedValue(undefined);
    expect((await api.serve('nope.png')).status).toBe(404);
  });
});
