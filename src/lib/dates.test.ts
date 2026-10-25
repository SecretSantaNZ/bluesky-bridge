import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  formatDate,
  formatDateIso,
  formatDatetime,
  parseDate,
} from './dates.js';

describe('dates', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('parseDate', () => {
    it('parses yyyy-MM-dd format', () => {
      const date = parseDate('2025-12-25');
      expect(date.getFullYear()).toBe(2025);
      expect(date.getMonth()).toBe(11); // December is 11
      expect(date.getDate()).toBe(25);
    });
  });

  describe('formatDate', () => {
    it('formats a Date object', () => {
      const date = new Date(2025, 11, 25); // December 25, 2025
      expect(formatDate(date)).toBe('25th Dec');
    });

    it('formats a date string', () => {
      expect(formatDate('2025-12-25')).toBe('25th Dec');
    });
  });

  describe('formatDateIso', () => {
    it('formats a Date object as yyyy-MM-dd', () => {
      const date = new Date(2025, 11, 25);
      expect(formatDateIso(date)).toBe('2025-12-25');
    });

    it('formats a date string as yyyy-MM-dd', () => {
      expect(formatDateIso('2025-01-05')).toBe('2025-01-05');
    });
  });

  describe('formatDatetime', () => {
    it('formats relative time', () => {
      const now = new Date('2025-12-25T12:00:00Z');
      vi.setSystemTime(now);
      const date = new Date('2025-12-25T11:00:00Z');
      const result = formatDatetime(date);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
