import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { NARROW_MAX, WIDE_MIN } from '../../src/lib/breakpoints';

const SRC = fileURLToPath(new URL('../../src', import.meta.url));
const STYLED = /\.(css|astro|svelte)$/;
const sources = readdirSync(SRC, { recursive: true, encoding: 'utf8' })
  .filter((file) => STYLED.test(file))
  .map((file) => ({ file, text: readFileSync(join(SRC, file), 'utf8') }));

describe('viewport breakpoints', () => {
  it('uses the single desktop / mobile breakpoint that the islands match with matchMedia', () => {
    const used = sources.flatMap(({ file, text }) =>
      [...text.matchAll(/@media[^{]*\(width\s*(?:<=|>)\s*([\d.]+rem)\)/g)].map((match) => `${file}: ${match[1]}`),
    );
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((entry) => !entry.endsWith(`: ${WIDE_MIN}`) && !entry.endsWith(`: ${NARROW_MAX}`))).toEqual([]);
  });

  it('only uses the narrow-window breakpoint for the zone grid', () => {
    // 整个数值才算：0.78rem 这样的字号不是断点
    const token = new RegExp(`(?<![\\d.])${NARROW_MAX.replace('.', '\\.')}`);
    const narrow = sources.filter(({ text }) => token.test(text)).map(({ file }) => file.replaceAll('\\', '/'));
    expect(narrow).toEqual(['zones/zones.css']);
  });
});
