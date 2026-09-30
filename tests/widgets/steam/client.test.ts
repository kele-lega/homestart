import { describe, expect, it } from 'vitest';
import { readBinding, readSteamView } from '../../../src/widgets/steam/client';

describe('readSteamView', () => {
  it('accepts a well-shaped view', () => {
    const body = { success: true, data: { account: undefined, sub: '最近游玩', feed: { status: 'unbound' } } };

    expect(readSteamView(body)).toEqual(body.data);
  });

  it('rejects a failed or malformed response', () => {
    expect(readSteamView({ success: false, error: 'x' })).toBeUndefined();
    expect(readSteamView({ success: true, data: { sub: '最近游玩' } })).toBeUndefined();
    expect(readSteamView(null)).toBeUndefined();
  });
});

describe('readBinding', () => {
  it('accepts a successful binding response', () => {
    expect(readBinding({ success: true, data: { steamId: '76561197960265729' } })).toEqual({ ok: true, steamId: '76561197960265729' });
    expect(readBinding({ success: true, data: { steamId: undefined } })).toEqual({ ok: true, steamId: undefined });
  });

  it('carries the server message on failure, with a fallback', () => {
    expect(readBinding({ success: false, error: 'SteamID64 是 7656119 开头的 17 位数字' })).toEqual({
      ok: false,
      message: 'SteamID64 是 7656119 开头的 17 位数字',
    });
    expect(readBinding({ success: false })).toEqual({ ok: false, message: '保存失败，请稍后再试' });
  });
});
