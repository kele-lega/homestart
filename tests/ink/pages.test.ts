import { describe, expect, it } from 'vitest';
import { isForward, isSubPage, neighbor, pathOf, routeOf, titleOf } from '../../src/ink/pages';

describe('ink pages', () => {
  it('maps the five addresses to routes and back; anything else is not ours', () => {
    expect(routeOf('/')).toBe('home');
    expect(routeOf('/cal')).toBe('cal');
    expect(routeOf('/dir/')).toBe('dir');
    expect(routeOf('/settings')).toBeUndefined();
    expect(routeOf('/cal/x')).toBeUndefined();
    expect(pathOf('home')).toBe('/');
    expect(pathOf('site')).toBe('/site');
    expect(isSubPage('play')).toBe(true);
    expect(isSubPage('home')).toBe(false);
  });

  it('flips between sub pages in a ring, choosing the nearer direction', () => {
    expect(neighbor('cal', 1)).toBe('dir');
    expect(neighbor('cal', -1)).toBe('site');
    expect(neighbor('site', 1)).toBe('cal');
    expect(isForward('cal', 'dir')).toBe(true);
    expect(isForward('dir', 'cal')).toBe(false);
    expect(isForward('site', 'cal')).toBe(true);
  });

  it('titles sub pages before the site title', () => {
    expect(titleOf('home', '我的主页')).toBe('我的主页');
    expect(titleOf('cal', '我的主页')).toBe('月令 · 我的主页');
  });
});
