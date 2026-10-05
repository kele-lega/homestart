import { afterEach, describe, expect, it, vi } from 'vitest';
import { readResult, savePreferences, searchPlaces, SETTINGS_CHANGED_FLAG } from '../../src/lib/settings-api';
import { CLIENT_HEADER } from '../../src/lib/widget-api';

const storage = () => {
  const items = new Map<string, string>();
  return { setItem: (key: string, value: string) => items.set(key, value), getItem: (key: string) => items.get(key) ?? null, items };
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('readResult', () => {
  it('passes data through on success and carries the server message on failure, with a fallback', () => {
    expect(readResult({ success: true, data: { steamId: '1' }, error: null })).toEqual({ ok: true, data: { steamId: '1' } });
    expect(readResult({ success: false, error: '请先登录' })).toEqual({ ok: false, message: '请先登录' });
    for (const body of [null, 'oops', { success: false }, { success: 'true' }]) {
      expect(readResult(body), JSON.stringify(body)).toEqual({ ok: false, message: '保存失败，请稍后再试' });
    }
  });
});

describe('settings calls', () => {
  it('sends JSON with the same-origin header and marks the home page stale after a successful save', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({ success: true, data: { steam: null }, error: null }));
    const session = storage();
    vi.stubGlobal('fetch', fetch);
    vi.stubGlobal('sessionStorage', session);

    await expect(savePreferences({ steam: null })).resolves.toEqual({ ok: true, data: { steam: null } });
    const [url, init] = fetch.mock.calls[0]!;
    expect([url, init?.method, init?.body]).toEqual(['/api/settings/preferences', 'PATCH', '{"steam":null}']);
    expect((init?.headers as Record<string, string>)[CLIENT_HEADER]).toBe('1');
    expect(session.items.get(SETTINGS_CHANGED_FLAG)).toBe('1');
  });

  it('does not mark anything for lookups or failures, and reports network errors in words', async () => {
    const session = storage();
    vi.stubGlobal('sessionStorage', session);
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: true, data: [], error: null })));
    await searchPlaces('坪山');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ success: false, data: null, error: '最多列 10 款' })));
    await expect(savePreferences({ steam: { count: 11 } })).resolves.toEqual({ ok: false, message: '最多列 10 款' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    await expect(savePreferences({ steam: null })).resolves.toEqual({ ok: false, message: '网络出了点问题，没能保存' });
    expect(session.items.size).toBe(0);
  });
});
