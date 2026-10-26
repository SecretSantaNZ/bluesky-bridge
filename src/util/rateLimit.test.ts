import { afterEach, describe, expect, it, vi } from 'vitest';
import { clientKeyFromRequest, createRateLimiter } from './rateLimit.js';

describe('createRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('allows requests up to the max within the window', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
    expect(limiter('key')).toBe(true);
    expect(limiter('key')).toBe(true);
    expect(limiter('key')).toBe(true);
  });

  it('blocks requests beyond the max within the window', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 2 });
    expect(limiter('key')).toBe(true);
    expect(limiter('key')).toBe(true);
    expect(limiter('key')).toBe(false);
  });

  it('allows requests again after the window has passed', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const limiter = createRateLimiter({ windowMs: 1_000, max: 1 });
    expect(limiter('key')).toBe(true);
    expect(limiter('key')).toBe(false);
    vi.setSystemTime(1_000);
    expect(limiter('key')).toBe(true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
    expect(limiter('a')).toBe(true);
    expect(limiter('b')).toBe(true);
    expect(limiter('a')).toBe(false);
    expect(limiter('b')).toBe(false);
  });

  it('evicts the oldest key when the store is full of live keys', () => {
    const limiter = createRateLimiter({ windowMs: 60_000, max: 1, maxKeys: 2 });
    expect(limiter('a')).toBe(true);
    expect(limiter('b')).toBe(true);
    expect(limiter('c')).toBe(true);
    // inserting 'c' evicted 'a' as the oldest live key
    expect(limiter('a')).toBe(true);
    // inserting 'a' evicted 'b', but 'c' is still remembered in its window
    expect(limiter('c')).toBe(false);
  });
});

describe('clientKeyFromRequest', () => {
  it('uses the last X-Forwarded-For entry set by the reverse proxy', () => {
    expect(
      clientKeyFromRequest({
        headers: { 'x-forwarded-for': '10.0.0.1, 203.0.113.7' },
        ip: '127.0.0.1',
      })
    ).toBe('203.0.113.7');
  });

  it('joins repeated X-Forwarded-For headers before taking the last entry', () => {
    expect(
      clientKeyFromRequest({
        headers: { 'x-forwarded-for': ['10.0.0.1', '203.0.113.7'] },
        ip: '127.0.0.1',
      })
    ).toBe('203.0.113.7');
  });

  it('falls back to the socket address when the header is missing', () => {
    expect(clientKeyFromRequest({ headers: {}, ip: '127.0.0.1' })).toBe(
      '127.0.0.1'
    );
  });

  it('falls back to the socket address when the header is empty', () => {
    expect(
      clientKeyFromRequest({
        headers: { 'x-forwarded-for': ', , ' },
        ip: '1.2.3.4',
      })
    ).toBe('1.2.3.4');
  });
});
