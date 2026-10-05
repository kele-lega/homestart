import { describe, expect, it } from 'vitest';
import { readSteamView } from '../../../src/widgets/steam/client';

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
