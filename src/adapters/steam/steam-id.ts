/**
 * SteamID64 和绑定时的输入。只接受个人账号（universe 1、type 1、instance 1）：
 * 76561197960265728 + 账号编号（1 至 2^32 - 1）。群组等其他类型的 ID 也是 17、18 位数字，但查不到游戏。
 */

const INDIVIDUAL_BASE = 76561197960265728n;
const MAX_ACCOUNT_ID = 0xffff_ffffn;
const STEAM_ID64 = /^\d{17}$/;
/** 自定义链接（steamcommunity.com/id/<名字>）里的名字 */
const VANITY_NAME = /^\w{3,32}$/;
const PROFILE_HOSTS = new Set(['steamcommunity.com', 'www.steamcommunity.com']);

export type SteamInput =
  | { readonly kind: 'id'; readonly steamId: string }
  | { readonly kind: 'vanity'; readonly name: string }
  | { readonly kind: 'invalid'; readonly message: string };

const EMPTY = '请填写 SteamID64 或个人资料链接';
const BAD_ID = 'SteamID64 是 7656119 开头的 17 位数字';
const UNRECOGNIZED = '请填 17 位 SteamID64，或 steamcommunity.com 的个人资料链接';

export function isSteamId64(text: string): boolean {
  if (!STEAM_ID64.test(text)) return false;
  const account = BigInt(text) - INDIVIDUAL_BASE;
  return account >= 1n && account <= MAX_ACCOUNT_ID;
}

function parseProfileUrl(text: string): SteamInput {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { kind: 'invalid', message: UNRECOGNIZED };
  }
  if (!PROFILE_HOSTS.has(url.hostname)) return { kind: 'invalid', message: UNRECOGNIZED };
  const [section, value = ''] = url.pathname.split('/').filter(Boolean);
  if (section === 'profiles') return isSteamId64(value) ? { kind: 'id', steamId: value } : { kind: 'invalid', message: BAD_ID };
  if (section === 'id' && VANITY_NAME.test(value)) return { kind: 'vanity', name: value };
  return { kind: 'invalid', message: UNRECOGNIZED };
}

/**
 * 绑定时填的内容：SteamID64、资料链接（…/profiles/<ID>）、自定义链接（…/id/<名字>）或只填名字。
 * 纯数字只按 SteamID64 处理；自定义链接要用 API Key 查成 SteamID64，由调用方负责
 */
export function parseSteamInput(raw: string): SteamInput {
  const text = raw.trim();
  if (!text) return { kind: 'invalid', message: EMPTY };
  if (/^\d+$/.test(text)) return isSteamId64(text) ? { kind: 'id', steamId: text } : { kind: 'invalid', message: BAD_ID };
  if (VANITY_NAME.test(text)) return { kind: 'vanity', name: text };
  return parseProfileUrl(text);
}
