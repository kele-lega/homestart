import { describe, expect, it } from 'vitest';
import { parseLinks } from '../../../src/core/links';
import { pickFavorites } from '../../../src/widgets/favorites/pick';

const { links } = parseLinks({
  links: [
    { name: 'A', url: 'https://a.example', favorite: true },
    { name: 'B', url: 'https://b.example' },
    { name: 'C', url: 'https://c.example', favorite: true },
    { name: 'D', url: 'https://d.example' },
    { name: 'E', url: 'https://e.example', favorite: true },
  ],
});
const names = (picked: readonly { name: string }[]) => picked.map((link) => link.name);

describe('pickFavorites', () => {
  it('puts recently visited links first, most recent first', () => {
    expect(names(pickFavorites(links, ['https://d.example/', 'https://b.example/', 'https://a.example/'], 3))).toEqual(['D', 'B', 'A']);
  });

  it('fills the rest with favorite: true links, then any other link, in config order and without repeating', () => {
    expect(names(pickFavorites(links, ['https://c.example/'], 4))).toEqual(['C', 'A', 'E', 'B']);
    expect(names(pickFavorites(links, ['https://b.example/'], 2))).toEqual(['B', 'A']);
  });

  it('shows the configured favorites first without any visits, capped at count', () => {
    expect(names(pickFavorites(links, [], 4))).toEqual(['A', 'C', 'E', 'B']);
    expect(names(pickFavorites(links, [], 2))).toEqual(['A', 'C']);
  });

  it('skips visited addresses that are no longer in links.yaml', () => {
    expect(names(pickFavorites(links, ['https://gone.example/', 'https://d.example/'], 2))).toEqual(['D', 'A']);
  });

  it('still fills up when no link is marked favorite (a navigation edited in settings)', () => {
    const plain = links.map((link) => ({ ...link, favorite: false }));
    expect(names(pickFavorites(plain, ['https://d.example/'], 3))).toEqual(['D', 'A', 'B']);
  });
});
