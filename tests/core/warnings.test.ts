import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../../src/core/config';
import { reportWarningsOnce } from '../../src/core/warnings';

const configWith = (warnings: string[]) => ({ layout: { warnings } }) as unknown as AppConfig;

describe('reportWarningsOnce', () => {
  it('reports each loaded config only once', () => {
    const seen: string[] = [];
    const config = configWith(['a', 'b']);
    reportWarningsOnce(config, (m) => seen.push(m));
    reportWarningsOnce(config, (m) => seen.push(m));
    expect(seen).toEqual(['a', 'b']);
  });

  it('reports again after the config is reloaded', () => {
    const seen: string[] = [];
    reportWarningsOnce(configWith(['a']), (m) => seen.push(m));
    reportWarningsOnce(configWith(['a']), (m) => seen.push(m));
    expect(seen).toEqual(['a', 'a']);
  });
});
