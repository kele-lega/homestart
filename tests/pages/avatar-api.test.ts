import type { APIContext } from 'astro';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

const SAME_ORIGIN = { 'sec-fetch-site': 'same-origin' };
const JSON_HEADERS = { ...SAME_ORIGIN, 'content-type': 'application/json' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };
const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG).toString('base64')}`;
const OLD_FILE = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp';
const SEED = '0123456789abcdef0123456789abcdef';

type Auth = App.Locals['auth'];

let dir: string;
let previousDir: string | undefined;

async function setup() {
  vi.resetModules();
  const avatar = await import('../../src/pages/api/account/avatar');
  const serve = await import('../../src/pages/avatars/[file]');
  const { getAuthService } = await import('../../src/adapters/auth/service');

  const context = (auth: Auth, method: string, body?: unknown, headers: Record<string, string> = body === undefined ? SAME_ORIGIN : JSON_HEADERS) =>
    ({
      request: new Request('http://localhost/api/account/avatar', { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      locals: { auth },
    }) as unknown as APIContext;

  return {
    upload: (auth: Auth, body: unknown, headers?: Record<string, string>) => avatar.PUT(context(auth, 'PUT', body, headers)),
    reset: (auth: Auth) => avatar.DELETE(context(auth, 'DELETE')),
    serve: (file: string) => serve.GET({ params: { file } } as unknown as APIContext),
    getAuthService: vi.mocked(getAuthService),
  };
}

/** 假的账号服务：记住当前的头像文件，setAvatar 换掉并返回旧的 */
function fakeService(initial: string | null) {
  let current = initial;
  const setAvatar = vi.fn((_userId: number, file: string | null) => {
    const previous = current;
    current = file;
    return previous;
  });
  const account = vi.fn(() => ({ avatar: { seed: SEED, image: current ? `/avatars/${current}` : null } }));
  return { setAvatar, account };
}

let api: Awaited<ReturnType<typeof setup>>;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'home-avatar-api-'));
  previousDir = process.env.AVATARS_DIR;
  process.env.AVATARS_DIR = dir;
  api = await setup();
});

afterEach(async () => {
  if (previousDir === undefined) delete process.env.AVATARS_DIR;
  else process.env.AVATARS_DIR = previousDir;
  await rm(dir, { recursive: true, force: true });
});

describe('guards', () => {
  it('answers 401 when signed out and 403 to cross-site requests', async () => {
    expect((await api.upload(undefined, { image: PNG_DATA_URL })).status).toBe(401);
    expect((await api.reset(undefined)).status).toBe(401);
    expect((await api.upload(ALICE, { image: PNG_DATA_URL }, { ...JSON_HEADERS, 'sec-fetch-site': 'cross-site' })).status).toBe(403);
    expect(api.getAuthService).not.toHaveBeenCalled();
  });
});

describe('PUT /api/account/avatar', () => {
  it('stores the image, points the account at it and deletes the old file', async () => {
    await writeFile(path.join(dir, OLD_FILE), 'old');
    const service = fakeService(OLD_FILE);
    api.getAuthService.mockResolvedValue(service as never);

    const response = await api.upload(ALICE, { image: PNG_DATA_URL });
    expect(response.status).toBe(200);
    const [file] = await readdir(dir);
    expect(file).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(service.setAvatar).toHaveBeenCalledWith(ALICE!.userId, file);
    await expect(response.json()).resolves.toEqual({
      success: true,
      data: { avatar: { seed: SEED, image: `/avatars/${file}` } },
      error: null,
    });
  });

  it('keeps the file when the same picture is uploaded again', async () => {
    api.getAuthService.mockResolvedValue(fakeService(null) as never);
    await api.upload(ALICE, { image: PNG_DATA_URL });
    expect((await api.upload(ALICE, { image: PNG_DATA_URL })).status).toBe(200);
    expect(await readdir(dir)).toHaveLength(1);
  });

  it('rejects non-images and broken base64 before touching the account', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64');
    const responses = await Promise.all([
      api.upload(ALICE, { image: svg }),
      api.upload(ALICE, { image: 'not base64!' }),
      api.upload(ALICE, {}),
    ]);
    expect(responses.map((response) => response.status)).toEqual([400, 400, 400]);
    expect(api.getAuthService).not.toHaveBeenCalled();
    expect(await readdir(dir)).toEqual([]);
  });

  it('removes the new file again when the account update fails', async () => {
    const { AuthInputError } = await import('../../src/adapters/auth/store');
    api.getAuthService.mockResolvedValue({
      setAvatar: () => {
        throw new AuthInputError('没有这个账号');
      },
    } as never);
    const response = await api.upload(ALICE, { image: PNG_DATA_URL });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: '没有这个账号' });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('DELETE /api/account/avatar', () => {
  it('goes back to the default picture and deletes the uploaded file', async () => {
    await writeFile(path.join(dir, OLD_FILE), 'old');
    const service = fakeService(OLD_FILE);
    api.getAuthService.mockResolvedValue(service as never);
    const response = await api.reset(ALICE);
    expect(service.setAvatar).toHaveBeenCalledWith(ALICE!.userId, null);
    await expect(response.json()).resolves.toMatchObject({ data: { avatar: { seed: SEED, image: null } } });
    expect(await readdir(dir)).toEqual([]);
  });
});

describe('GET /avatars/[file]', () => {
  it('serves a stored avatar with long caching and a locked-down policy', async () => {
    await writeFile(path.join(dir, OLD_FILE), 'webp-bytes');
    const response = await api.serve(OLD_FILE);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/webp');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('content-security-policy')).toContain('sandbox');
    await expect(response.text()).resolves.toBe('webp-bytes');
  });

  it('answers 404 for missing files and names outside the pattern', async () => {
    expect((await api.serve('bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png')).status).toBe(404);
    expect((await api.serve('../auth.db')).status).toBe(404);
  });
});
