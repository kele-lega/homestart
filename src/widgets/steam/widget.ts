import { z } from 'astro/zod';
import type { SteamBinding } from '../../adapters/steam/model';
import { bindSteamAccount, unbindSteamAccount } from '../../adapters/steam/service';
import { defineAction, defineWidget } from '../../core/widget';
import { loadSteamView, type SteamView } from './data';

/**
 * Steam：最近两周玩过的游戏，正在玩的排最前，点击不做任何操作。
 * 每个登录用户在卡片底部绑定自己的 SteamID64；API Key 只在服务端环境变量 STEAM_API_KEY
 */
const SteamOptions = z.strictObject({
  /** 最多列几款游戏 */
  count: z.number().int().min(1).max(10).default(4),
});

export type SteamOptions = z.infer<typeof SteamOptions>;

const recent = defineAction({
  query: z.object({}),
  run: async (options: SteamOptions, _query, ctx): Promise<SteamView> => loadSteamView(options.count, ctx),
});

const BindBody = z.object({ account: z.string({ error: '缺少 SteamID' }) });

const bind = defineAction({
  method: 'PUT',
  query: z.object({}),
  body: BindBody,
  run: async (_options: SteamOptions, _query, { user, body }): Promise<SteamBinding> => bindSteamAccount(user, body.account),
});

const unbind = defineAction({
  method: 'DELETE',
  query: z.object({}),
  run: async (_options: SteamOptions, _query, { user }): Promise<SteamBinding> => unbindSteamAccount(user),
});

export default defineWidget({
  type: 'steam',
  title: 'Steam',
  head: 'view',
  options: SteamOptions,
  actions: { recent, bind, unbind },
});
