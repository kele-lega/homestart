import { describe, expect, it } from 'vitest';
import { centerSquare } from '../../src/lib/avatar-image';

describe('centerSquare', () => {
  it('crops the middle of a landscape image', () => {
    expect(centerSquare(400, 300)).toEqual([50, 0, 300]);
  });

  it('crops the middle of a portrait image', () => {
    expect(centerSquare(300, 401)).toEqual([0, 50, 300]);
  });

  it('keeps a square image whole', () => {
    expect(centerSquare(256, 256)).toEqual([0, 0, 256]);
  });
});
