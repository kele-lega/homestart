import { getContainerRenderer } from '@astrojs/svelte/container-renderer';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import { loadRenderers } from 'astro:container';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WidgetHeading } from '../../../src/core/widget';
import ServerView from '../../../src/widgets/server/View.astro';
import server from '../../../src/widgets/server/widget';
import { viewContext, withoutDevAnnotations } from '../../helpers';

vi.mock('../../../src/adapters/site-stats', () => ({ siteCounts: vi.fn() }));
vi.mock('../../../src/adapters/suggestions', () => ({ listSuggestions: vi.fn() }));
vi.mock('../../../src/core/log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/core/log')>()),
  logBackgroundError: vi.fn(),
}));

const { siteCounts } = await import('../../../src/adapters/site-stats');
const { listSuggestions } = await import('../../../src/adapters/suggestions');

let container: AstroContainer;
const HEADING: WidgetHeading = { title: '本站', level: 3 };
const ADMIN: App.Locals['auth'] = { sessionId: 1, userId: 1, username: 'root', displayName: null, role: 'admin' };
const ALICE: App.Locals['auth'] = { sessionId: 7, userId: 2, username: 'alice', displayName: null, role: 'user' };

const ENTRIES = [
  { name: 'terminal', url: 'https://work.example.com/', description: '网页终端' },
  { name: 'api', url: 'https://ccs.example.com/' },
];

const suggestion = (id: number, done: boolean) => ({
  id: `00000000-0000-4000-8000-${String(id).padStart(12, '0')}`,
  body: '加个暗色模式',
  username: 'alice',
  author: 'alice',
  createdAt: id,
  done,
});

const render = async (auth: App.Locals['auth']) =>
  withoutDevAnnotations(
    await container.renderToString(ServerView, {
      props: { id: 'server', options: { entries: ENTRIES }, heading: HEADING, ...viewContext() },
      locals: { auth },
    }),
  );

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

beforeEach(() => {
  vi.mocked(siteCounts).mockReset().mockResolvedValue({ nav: 1234, search: 56 });
  vi.mocked(listSuggestions).mockReset().mockResolvedValue([suggestion(1, false), suggestion(2, true), suggestion(3, false)]);
});

describe('server view', () => {
  it('shows everyone one counter, navigations and searches added up, padded to seven cards', async () => {
    for (const auth of [undefined, ALICE, ADMIN]) {
      const html = await render(auth);

      expect(html).toMatch(/<h3 class="l-frame-title">本站(<!---->)?<\/h3>/);
      expect(html).toContain('导航与搜索 1290 次');
      expect(html.match(/class="digit/g)).toHaveLength(7);
    }
  });

  it('asks anonymous visitors to log in before suggesting', async () => {
    const html = await render(undefined);

    expect(html).toContain('href="/login"');
    expect(html).not.toContain('<textarea');
  });

  it('gives signed-in users the suggestion form but no admin tools or server face', async () => {
    const html = await render(ALICE);

    expect(html).toContain('<textarea');
    expect(html).not.toContain('查看建议');
    expect(html).not.toContain('翻到服务器');
    for (const text of ['work.example.com', 'ccs.example.com', '网页终端', 'terminal', 'CPU']) expect(html).not.toContain(text);
    expect(listSuggestions).not.toHaveBeenCalled();
  });

  it('gives admins the tools with the pending count and a hidden server face', async () => {
    const html = await render(ADMIN);

    expect(html).toContain('查看建议');
    expect(html).toContain('发布公告');
    expect(html).toMatch(/class="badge[^"]*">2</);
    expect(html).toContain('翻到服务器');
    expect(html).toContain('服务器状态加载中');
    expect(html.match(/class="track/g)).toHaveLength(3);
    expect(html).toMatch(/<div class="face[^"]*" hidden/);
  });

  it('opens entries in a new tab and describes each one by its host', async () => {
    const html = await render(ADMIN);
    const links = [...html.matchAll(/<a\s[^>]*>/g)].map((match) => match[0]);

    expect(links).toHaveLength(2);
    for (const link of links) {
      expect(link).toContain('target="_blank"');
      expect(link).toContain('rel="noopener noreferrer"');
      expect(link).toMatch(/aria-describedby="[^"]+"/);
    }
    expect(html).toContain('网页终端');
    expect(html).toContain('work.example.com');
  });

  it('still renders when the counters or suggestions cannot be read', async () => {
    vi.mocked(siteCounts).mockRejectedValue(new Error('EACCES'));
    vi.mocked(listSuggestions).mockRejectedValue(new Error('EACCES'));
    const html = await render(ADMIN);

    expect(html).toContain('导航与搜索 0 次');
    expect(html).not.toContain('class="badge');
  });
});

describe('server options', () => {
  it('defaults to no entries and accepts up to four', () => {
    expect(server.options.parse({})).toEqual({ entries: [] });
    expect(server.options.safeParse({ entries: Array.from({ length: 5 }, () => ENTRIES[1]) }).success).toBe(false);
  });

  it('only accepts http(s) entry URLs', () => {
    expect(server.options.safeParse({ entries: [{ name: 'x', url: 'javascript:alert(1)' }] }).success).toBe(false);
    expect(server.options.safeParse({ entries: [{ name: 'x', url: 'ftp://example.com' }] }).success).toBe(false);
    expect(server.options.safeParse({ entries: [{ name: '', url: 'https://example.com' }] }).success).toBe(false);
  });

  it('has nothing to set on the settings page', () => {
    expect(server.preferences).toBeUndefined();
  });
});
