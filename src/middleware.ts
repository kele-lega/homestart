import type { APIContext, MiddlewareNext } from 'astro';
import { SESSION_COOKIE } from './adapters/auth/session';
import { getAuthService } from './adapters/auth/service';

/**
 * 服务端岛屿（/_server-islands/*）按登录用户渲染（日程、截止日），
 * 却是可以缓存的 GET 请求：一律 private, no-store，不让代理或浏览器留下别人的数据。
 * 页面本身不含用户数据，/api 的缓存头由 core/api.ts 的 json() 决定，这里都不动。
 */
const SERVER_ISLANDS = '/_server-islands/';
const NO_STORE = 'private, no-store';

/** 站内登录会话：Cookie 里只有不可预测的 id，查表得到用户名和角色，写进 locals.auth 给后续处理读取 */
async function resolveAuth(context: APIContext): Promise<void> {
  const sessionId = context.cookies.get(SESSION_COOKIE)?.value;
  if (!sessionId) return;
  const service = await getAuthService();
  const session = service.currentUser(sessionId);
  if (session) context.locals.auth = { userId: session.userId, username: session.username, role: session.role };
}

export async function onRequest(context: APIContext, next: MiddlewareNext): Promise<Response> {
  await resolveAuth(context);
  const response = await next();
  if (!context.url.pathname.startsWith(SERVER_ISLANDS)) return response;
  // 复制出新的响应再改头；Astro 在中间件之后才把 cookie 挂到返回的响应上
  const headers = new Headers(response.headers);
  headers.set('cache-control', NO_STORE);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
