import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ToneSchema } from '../../src/core/layout-schema';

const css = readFileSync(new URL('../../src/styles/tones.css', import.meta.url), 'utf8');

describe('tones.css', () => {
  it('defines colors for exactly the tones that layout.yaml accepts', () => {
    const defined = [...css.matchAll(/\[data-tone='([a-z]+)'\]/g)].map((match) => match[1]);
    expect(new Set(defined)).toEqual(new Set(ToneSchema.options));
  });
});
