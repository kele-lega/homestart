import type { APIContext } from 'astro';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveSteamCover } from '../../src/adapters/steam/covers';
import { UpstreamError } from '../../src/core/http';
import { GET } from '../../src/pages/steam-covers/[appId]';

vi.mock('../../src/adapters/steam/covers', () => ({ resolveSteamCover: vi.fn() }));

const COVER = 'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/hash/library_capsule_schinese.jpg';
const context = (appId?: string) => ({ params: { appId } }) as unknown as APIContext;

beforeEach(() => {
  vi.mocked(resolveSteamCover).mockReset().mockResolvedValue(COVER);
});

afterEach(() => vi.restoreAllMocks());

describe('GET /steam-covers/<appId>', () => {
  it('redirects to the resolved official image with public caching', async () => {
    const response = await GET(context('4115450'));
    expect(resolveSteamCover).toHaveBeenCalledWith(4115450);
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(COVER);
    expect(response.headers.get('cache-control')).toBe('public, max-age=86400');
  });

  it.each([undefined, '0', '-1', '1.5', '1e3', '0570', 'NaN', '4294967296', '9007199254740993', 'https://evil.example'])('rejects invalid app ids without an upstream request: %s', async (appId) => {
    const response = await GET(context(appId));
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(resolveSteamCover).not.toHaveBeenCalled();
  });

  it('keeps trying the legacy header on upstream failure without caching the failure', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.mocked(resolveSteamCover).mockRejectedValueOnce(new UpstreamError('api.steampowered.com：请求超时'));
    const response = await GET(context('4115450'));
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe('https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4115450/header.jpg');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(log).toHaveBeenCalledOnce();
  });

  it('does not hide programming errors', async () => {
    vi.mocked(resolveSteamCover).mockRejectedValueOnce(new TypeError('bug'));
    await expect(GET(context('4115450'))).rejects.toThrow('bug');
  });
});
