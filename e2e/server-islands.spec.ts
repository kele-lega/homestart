import { expect, test } from './support/fixtures';

// 岛屿按登录用户渲染，中间件给所有 /_server-islands/ 响应加上 no-store（见 src/middleware.ts）。
// 这里验证构建后的服务端真的走了中间件：缺参数的请求在读取任何岛屿之前就被拒绝，不会去连外部服务
test.describe('服务端岛屿', () => {
  test('响应一律不许缓存，出错时也一样', async ({ request }) => {
    const response = await request.get('/_server-islands/missing');
    expect(response.status()).toBe(400);
    expect(response.headers()['cache-control']).toBe('private, no-store');
  });
});
