import { describe, expect, it } from 'vitest';
import { resolveMaxGiftees } from './game-mode.js';
import { BadRequestError } from 'http-errors-enhanced';

describe('resolveMaxGiftees', () => {
  it('requires at least 2 giftees for super santa', () => {
    expect(() => resolveMaxGiftees('Super Santa', 1)).toThrow(BadRequestError);
    expect(() => resolveMaxGiftees('Super Santa', 0)).toThrow(BadRequestError);
  });

  it('accepts 2 or more giftees for super santa', () => {
    expect(resolveMaxGiftees('Super Santa', 2)).toBe(2);
    expect(resolveMaxGiftees('Super Santa', 5)).toBe(5);
  });

  it('always matches a single giftee for regular', () => {
    expect(resolveMaxGiftees('Regular', 5)).toBe(1);
    expect(resolveMaxGiftees('Regular', 1)).toBe(1);
  });

  it('matches no giftees for giftee only', () => {
    expect(resolveMaxGiftees('Giftee Only', 3)).toBe(0);
  });

  it('passes santa only limits through unchanged', () => {
    expect(resolveMaxGiftees('Santa Only', 3)).toBe(3);
  });
});
