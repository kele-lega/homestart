import { z } from 'astro/zod';
import { defineAction, definePreferences, defineWidget } from '../../core/widget';
import { loadSteamView, type SteamView } from './data';

/**
 * Steam：最近两周玩过的游戏，正在玩的排最前，点击不做任何操作。
 * 每个登录用户在设置页绑定自己的 SteamID64（/api/settings/steam）；API Key 只在服务端环境变量 STEAM_API_KEY
 */
export const STEAM_MAX_COUNT = 10;

const SteamOptions = z.strictObject({
  /** 最多列几款游戏 */
  count: z.number().int().min(1).max(STEAM_MAX_COUNT).default(4),
});

export type SteamOptions = z.infer<typeof SteamOptions>;

const SteamPreference = z.strictObject({
  count: z.number().int('款数要是整数').min(1, '至少列 1 款').max(STEAM_MAX_COUNT, `最多列 ${STEAM_MAX_COUNT} 款`),
});

export type SteamPreference = z.infer<typeof SteamPreference>;

const recent = defineAction({
  query: z.object({}),
  run: async (options: SteamOptions, _query, ctx): Promise<SteamView> => loadSteamView(options.count, ctx),
});

export default defineWidget({
  type: 'steam',
  title: 'Steam',
  head: 'view',
  options: SteamOptions,
  actions: { recent },
  preferences: definePreferences({
    schema: SteamPreference,
    apply: (options: SteamOptions, preference) => ({ ...options, ...preference }),
  }),
});
