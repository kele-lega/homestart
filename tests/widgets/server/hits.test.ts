import { beforeAll, describe, expect, it, vi } from 'vitest';
import { bump, mergeCounts, readCounts } from '../../../src/lib/site-stats';
import { hitOf } from '../../../src/widgets/server/hits';

// 没装 DOM 环境：hitOf 只用到 instanceof Element、closest 和 dataset，造一个最小的就够了
class FakeElement {
  constructor(private readonly link: { dataset: Record<string, string> } | null) {}
  closest(selector: string) {
    if (!this.link) return null;
    const { dataset } = this.link;
    return selector.includes('data-visit') && ('visit' in dataset || 'hit' in dataset) ? this.link : null;
  }
}

beforeAll(() => {
  vi.stubGlobal('Element', FakeElement);
});

const ATTR: Record<string, string> = { 'data-visit': 'visit', 'data-hit': 'hit' };

function linkWith(attrs: Record<string, string>): Element {
  const keys = Object.keys(attrs);
  if (keys.length === 0) return new FakeElement(null) as unknown as Element;
  const dataset = Object.fromEntries(keys.map((name) => [ATTR[name]!, attrs[name]!]));
  return new FakeElement({ dataset }) as unknown as Element;
}

describe('hitOf', () => {
  it('counts site links as navigation and search-engine opens as searches', () => {
    expect(hitOf({ button: 0, target: linkWith({ 'data-visit': '' }) })).toBe('nav');
    expect(hitOf({ button: 1, target: linkWith({ 'data-visit': '' }) })).toBe('nav');
    expect(hitOf({ button: 0, target: linkWith({ 'data-hit': 'search' }) })).toBe('search');
  });

  it('ignores other links, other buttons and non-elements', () => {
    expect(hitOf({ button: 0, target: linkWith({}) })).toBeUndefined();
    expect(hitOf({ button: 0, target: linkWith({ 'data-hit': 'other' }) })).toBeUndefined();
    expect(hitOf({ button: 2, target: linkWith({ 'data-visit': '' }) })).toBeUndefined();
    expect(hitOf({ button: 0, target: null })).toBeUndefined();
  });
});

describe('site counts', () => {
  it('reads only well-formed counts', () => {
    expect(readCounts({ nav: 1, search: 2 })).toEqual({ nav: 1, search: 2 });
    expect(readCounts({ nav: -1, search: 2 })).toBeUndefined();
    expect(readCounts({ nav: 1 })).toBeUndefined();
    expect(readCounts(null)).toBeUndefined();
  });

  it('never goes backwards when a late reply arrives', () => {
    const local = bump({ nav: 10, search: 3 }, 'nav');
    expect(local).toEqual({ nav: 11, search: 3 });
    expect(mergeCounts(local, { nav: 10, search: 5 })).toEqual({ nav: 11, search: 5 });
  });
});
