import { getContainerRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import ToolbarView from '../../../src/widgets/toolbar/View.astro';
import toolbar from '../../../src/widgets/toolbar/widget';
import { viewContext, withoutDevAnnotations } from '../../helpers';

vi.mock('../../../src/adapters/announcements', () => ({ listAnnouncements: vi.fn() }));
vi.mock('../../../src/adapters/auth/service', () => ({ getAuthService: vi.fn() }));

const { listAnnouncements } = await import('../../../src/adapters/announcements');
const { getAuthService } = await import('../../../src/adapters/auth/service');

const ADMIN: App.Locals['auth'] = { sessionId: 10, userId: 1, username: 'kele', displayName: '可乐', role: 'admin' };
const USER: App.Locals['auth'] = { sessionId: 20, userId: 2, username: 'alice', displayName: null, role: 'user' };
// 2026-10-02 23:14 上海时间
const LAST_LOGIN = Date.parse('2026-10-02T15:14:00Z');

let container: AstroContainer;
const render = async (auth?: App.Locals['auth'], path = '/') =>
  withoutDevAnnotations(
    await container.renderToString(ToolbarView, {
      props: { id: 'toolbar', options: {}, ...viewContext({ timezone: 'Asia/Shanghai' }) },
      locals: { auth },
      request: new Request(`http://localhost${path}`),
    }),
  );

function accountFor(auth: NonNullable<App.Locals['auth']>, previousLogin: { at: number; ip: string } | null) {
  const { userId: id, username, displayName, role } = auth;
  // alice 传过头像，可乐用默认色块图
  const avatar = { seed: 'a'.repeat(32), image: username === 'alice' ? '/avatars/0123456789abcdef0123456789abcdef.webp' : null };
  return { id, username, displayName, role, avatar, createdAt: 0, previousLogin };
}

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

beforeEach(() => {
  vi.mocked(listAnnouncements).mockReset().mockResolvedValue([]);
  vi.mocked(getAuthService).mockReset();
});

function signIn(auth: NonNullable<App.Locals['auth']>, previousLogin: { at: number; ip: string } | null, sessions = 1) {
  vi.mocked(getAuthService).mockResolvedValue({
    account: (id: number) => (id === auth.userId ? accountFor(auth, previousLogin) : undefined),
    listSessions: () => Array.from({ length: sessions }, (_, n) => ({ id: n })),
  } as never);
}

describe('toolbar widget', () => {
  it('is bare and takes no options', () => {
    expect(toolbar.chrome).toBe('bare');
    expect(toolbar.options.safeParse({ x: 1 }).success).toBe(false);
  });
});

describe('toolbar view', () => {
  it('shows a login avatar, the settings circle and the announcements button to visitors', async () => {
    const html = await render();

    expect(html).toMatch(/<a class="circle avatar[^"]*" href="\/login" data-anonymous/);
    expect(html).toContain('还没登录');
    expect(html).toMatch(/href="\/settings" aria-label="设置"/);
    expect(html).toMatch(/aria-haspopup="dialog" aria-label="公告"/);
    expect(html).not.toContain('退出登录');
    expect(getAuthService).not.toHaveBeenCalled();
  });

  it('shows the uploaded avatar, the summary and the account sections to a signed-in user, without the IP', async () => {
    signIn(USER, { at: LAST_LOGIN, ip: '203.0.113.8' }, 3);
    const html = await render(USER);

    expect(html).toMatch(/aria-label="个人中心（alice）"[^>]*>(?:\s|<!--[^>]*-->)*<img[^>]*src="\/avatars\/0123456789abcdef0123456789abcdef\.webp"/);
    expect(html).toContain('2026.10.02 23:14');
    expect(html).toContain('3 台');
    for (const [href, label] of [
      ['/account#profile', '个人资料'],
      ['/account#password', '修改密码'],
      ['/account#sessions', '登录设备'],
    ]) {
      expect(html).toMatch(new RegExp(`href="${href}"[\\s\\S]*?${label}`));
    }
    expect(html).not.toContain('/account#users');
    expect(html).toContain('退出登录');
    expect(html).not.toContain('203.0.113.8');
    expect(html).not.toContain('管理员');
  });

  it('adds account management for admins and uses the nickname, with the username underneath', async () => {
    signIn(ADMIN, null);
    const html = await render(ADMIN);

    expect(html).toContain('aria-label="个人中心（可乐）"');
    // 没传过头像：默认色块图
    expect(html).toMatch(/aria-label="个人中心（可乐）"[^>]*>(?:\s|<!--[^>]*-->)*<svg[^>]*viewBox="0 0 6 6"/);
    expect(html).toContain('@kele');
    expect(html).toContain('管理员');
    expect(html).toContain('href="/account#users"');
    expect(html).toContain('这是第一次');
  });

  it('treats a session whose account was deleted as signed out', async () => {
    vi.mocked(getAuthService).mockResolvedValue({ account: () => undefined, listSessions: () => [] } as never);
    const html = await render(USER);

    expect(html).toContain('href="/login" data-anonymous');
    // 空字符串的属性渲染成没有值的 data-user，脚本读到的是 ''
    expect(html).toMatch(/data-account data-user[\s>]/);
  });

  it('marks the settings circle as the current page on /settings', async () => {
    expect(await render(undefined, '/settings')).toMatch(/href="\/settings" aria-label="设置" aria-current="page"/);
  });

  it('renders the announcements server-side, so the dialog has them before hydration', async () => {
    vi.mocked(listAnnouncements).mockResolvedValue([
      { id: '00000000-0000-4000-8000-000000000001', title: '停机维护', body: '今晚\n十点', createdAt: LAST_LOGIN, author: '可乐' },
    ]);
    const html = await render();

    expect(html).toContain('停机维护');
    expect(html).toContain('今晚\n十点');
    expect(html).toContain('2026.10.02');
    expect(html).not.toContain('写一条');
  });
});
