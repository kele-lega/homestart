import { describe, expect, it } from 'vitest';
import { isComposing } from '../../src/lib/keyboard';

describe('isComposing', () => {
  it('detects keys that belong to an IME composition', () => {
    expect(isComposing({ isComposing: true, keyCode: 27 })).toBe(true);
    // Safari：结束组合的那次 keydown 在 compositionend 之后触发，只能靠 keyCode 229 识别
    expect(isComposing({ isComposing: false, keyCode: 229 })).toBe(true);
  });

  it('lets ordinary keys through', () => {
    expect(isComposing({ isComposing: false, keyCode: 27 })).toBe(false);
  });
});
