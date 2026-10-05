import type { APIRoute } from 'astro';
import { z } from 'astro/zod';
import { bindSteamAccount, unbindSteamAccount } from '../../../adapters/steam/service';
import { settingsRoute } from '../../../core/settings-api';

/** PUT 绑定 Steam 账号（SteamID64 或个人资料链接）、DELETE 解除绑定；返回 { steamId } */
const Body = z.object({ account: z.string({ error: '缺少 SteamID' }) });

export const PUT: APIRoute = settingsRoute({ body: Body, run: ({ user, body }) => bindSteamAccount(user, body.account) });

export const DELETE: APIRoute = settingsRoute({ run: ({ user }) => unbindSteamAccount(user) });
