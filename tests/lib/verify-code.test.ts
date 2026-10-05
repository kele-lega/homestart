import { describe, expect, it } from 'vitest';
import { cleanCode } from '../../src/lib/verify-code';

describe('cleanCode', () => {
  it('keeps a plain 6-digit code', () => {
    expect(cleanCode('012345')).toBe('012345');
  });

  it('turns full-width digits into ASCII', () => {
    expect(cleanCode('１２３４５６')).toBe('123456');
  });

  it('drops spaces and punctuation copied along with the code', () => {
    expect(cleanCode(' 123 456 ')).toBe('123456');
    expect(cleanCode('123456，')).toBe('123456');
    expect(cleanCode('验证码是 123456，10 分钟内有效')).toBe('123456');
  });

  it('caps the length at 6', () => {
    expect(cleanCode('1234567')).toBe('123456');
  });
});
