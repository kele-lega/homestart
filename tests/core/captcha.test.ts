import { describe, expect, it } from 'vitest';
import { CAPTCHA_TTL_MS, createCaptchaStore, normalizeAnswer } from '../../src/core/captcha';
import { canDraw, captchaSvg } from '../../src/core/captcha-image';

function store(maxEntries?: number) {
  let time = 0;
  let next = 0;
  const captcha = createCaptchaStore({ now: () => time, newId: () => `id-${(next += 1)}`, newCode: () => '0729', maxEntries });
  return { captcha, advance: (ms: number) => (time += ms) };
}

describe('captcha store', () => {
  it('accepts the right answer once, for the owner only', () => {
    const { captcha } = store();
    const { id } = captcha.issue('alice');
    expect(captcha.verify('bob', id, '0729')).toBe('missing');

    const second = captcha.issue('alice').id;
    expect(captcha.verify('alice', second, ' ０７２９ ')).toBe('ok');
    expect(captcha.verify('alice', second, '0729')).toBe('missing');
  });

  it('burns the challenge on a wrong answer', () => {
    const { captcha } = store();
    const { id } = captcha.issue('alice');
    expect(captcha.verify('alice', id, '1111')).toBe('wrong');
    expect(captcha.verify('alice', id, '0729')).toBe('missing');
  });

  it('expires challenges', () => {
    const { captcha, advance } = store();
    const { id } = captcha.issue('alice');
    advance(CAPTCHA_TTL_MS);
    expect(captcha.verify('alice', id, '0729')).toBe('missing');
  });

  it('drops the oldest challenge past the cap', () => {
    const { captcha } = store(2);
    const first = captcha.issue('alice').id;
    const second = captcha.issue('alice').id;
    captcha.issue('alice');
    expect(captcha.verify('alice', first, '0729')).toBe('missing');
    expect(captcha.verify('alice', second, '0729')).toBe('ok');
  });

  it('returns an svg data url', () => {
    const { image } = createCaptchaStore().issue('alice');
    expect(Buffer.from(image.replace(/^data:image\/svg\+xml;base64,/, ''), 'base64').toString()).toMatch(/^<svg /);
  });

  it('normalizes full-width digits and spaces', () => {
    expect(normalizeAnswer(' １２3４ ')).toBe('1234');
  });
});

describe('captcha image', () => {
  it('draws digits as paths, never as text', () => {
    const svg = captchaSvg('8051');
    expect(svg).not.toMatch(/<text|8051/);
    expect(svg).toContain('<path');
  });

  it('differs between draws of the same code', () => {
    expect(captchaSvg('1234')).not.toBe(captchaSvg('1234'));
  });

  it('refuses anything but digits', () => {
    expect(canDraw('0123456789')).toBe(true);
    expect(canDraw('12a')).toBe(false);
    expect(() => captchaSvg('<x>')).toThrow();
  });
});
