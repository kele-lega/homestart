import { describe, expect, it } from 'vitest';
import { deepFreeze } from '../../src/lib/deep-freeze';

describe('deepFreeze', () => {
  it('freezes nested objects and arrays and returns the same reference', () => {
    const value = { a: [{ b: 1 }], c: { d: 'x' } };
    const frozen = deepFreeze(value);

    expect(frozen).toBe(value);
    expect(Object.isFrozen(frozen.a)).toBe(true);
    expect(Object.isFrozen(frozen.a[0])).toBe(true);
    expect(() => (frozen.a as unknown[]).push(2)).toThrow(TypeError);
  });

  it('passes primitives and null through untouched', () => {
    expect(deepFreeze(1)).toBe(1);
    expect(deepFreeze(null)).toBeNull();
    expect(deepFreeze(undefined)).toBeUndefined();
  });
});
