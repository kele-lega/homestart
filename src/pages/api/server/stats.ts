import type { APIRoute } from 'astro';
import { readSystemStats } from '../../../adapters/system-stats';
import { fail, isCrossSite, json, ok } from '../../../core/api';
import { describeError } from '../../../core/log';
import { presentStats } from '../../../widgets/server/present';

/**
 * GET /api/server/stats：本机的 CPU、内存、存储，首页服务器版块每几秒轮询一次。
 * 仅管理员：角色来自站内登录会话（中间件写进 locals.auth），反代注入的用户名头不算数
 */
export const GET: APIRoute = async ({ request, locals, logger }) => {
  if (isCrossSite(request.headers)) return json(403, fail('不允许跨站请求'));
  if (locals.auth?.role !== 'admin') return json(403, fail('只有管理员可以查看服务器状态'));
  try {
    return json(200, ok(presentStats(await readSystemStats())));
  } catch (error) {
    logger.error(`服务器状态读取失败：${describeError(error)}`);
    return json(500, fail('服务器状态暂时读不到'));
  }
};
