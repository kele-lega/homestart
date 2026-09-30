import { describe, expect, it } from 'vitest';
import { isSteamId64, parseSteamInput } from '../../../src/adapters/steam/steam-id';

const ID = '76561198000000001';

describe('isSteamId64', () => {
  it.each([
    ['76561197960265729', true],
    ['76561202255233023', true],
    [ID, true],
    // 账号编号 0 不是有效账号；超出 32 位编号就不是个人账号
    ['76561197960265728', false],
    ['76561202255233024', false],
    ['7656119800000000', false],
    ['765611980000000011', false],
    [' 76561198000000001', false],
    ['１２３', false],
  ])('%s → %s', (text, expected) => {
    // Act + Assert
    expect(isSteamId64(text)).toBe(expected);
  });
});

describe('parseSteamInput', () => {
  it.each([
    [`  ${ID} `, { kind: 'id', steamId: ID }],
    [`https://steamcommunity.com/profiles/${ID}`, { kind: 'id', steamId: ID }],
    [`steamcommunity.com/profiles/${ID}/`, { kind: 'id', steamId: ID }],
    [`http://www.steamcommunity.com/profiles/${ID}/games?tab=all`, { kind: 'id', steamId: ID }],
    ['https://steamcommunity.com/id/gabelogannewell/', { kind: 'vanity', name: 'gabelogannewell' }],
    ['STEAMCOMMUNITY.COM/id/Some_Name', { kind: 'vanity', name: 'Some_Name' }],
    ['some_name', { kind: 'vanity', name: 'some_name' }],
  ])('%s → %o', (text, expected) => {
    // Act + Assert
    expect(parseSteamInput(text)).toEqual(expected);
  });

  it.each([
    ['', '请填写 SteamID64 或个人资料链接'],
    ['   ', '请填写 SteamID64 或个人资料链接'],
    // 纯数字只可能是 SteamID64，不再按自定义链接查
    ['12345', 'SteamID64 是 7656119 开头的 17 位数字'],
    ['76561197960265728', 'SteamID64 是 7656119 开头的 17 位数字'],
    ['https://steamcommunity.com/profiles/123', 'SteamID64 是 7656119 开头的 17 位数字'],
    [`https://steamcommunity.com.evil.example/profiles/${ID}`, '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    [`https://evil.example/?next=steamcommunity.com/profiles/${ID}`, '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    ['https://steamcommunity.com/groups/x', '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    ['https://steamcommunity.com/id/a b', '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    ['ab', '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    ['名字', '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    ['x'.repeat(33), '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
    ['https://[bad', '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接'],
  ])('%j 无效：%s', (text, message) => {
    // Act + Assert
    expect(parseSteamInput(text)).toEqual({ kind: 'invalid', message });
  });
});
