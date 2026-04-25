import { describe, test, expect } from 'bun:test';
import {
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
} from '../utils/room-code';

describe('generateRoomCode', () => {
  test('generates a code of the default length (6)', () => {
    const code = generateRoomCode();
    expect(code.length).toBe(6);
  });

  test('generates a code of custom length', () => {
    expect(generateRoomCode(4).length).toBe(4);
    expect(generateRoomCode(8).length).toBe(8);
    expect(generateRoomCode(10).length).toBe(10);
  });

  test('generates only valid characters (uppercase, no I/O/0/1)', () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    for (let i = 0; i < 100; i++) {
      const code = generateRoomCode();
      for (const char of code) {
        expect(alphabet).toContain(char);
      }
    }
  });

  test('generates unique codes (statistical distribution check)', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      codes.add(generateRoomCode());
    }
    expect(codes.size).toBeGreaterThan(950);
  });
});

describe('isValidRoomCode', () => {
  test('returns true for valid 6-char codes', () => {
    expect(isValidRoomCode('ABCDEF')).toBe(true);
    expect(isValidRoomCode('XY2345')).toBe(true);
    expect(isValidRoomCode('A23BCD')).toBe(true);
  });

  test('returns false for codes with excluded characters I, O, 0, 1', () => {
    expect(isValidRoomCode('I23456')).toBe(false);
    expect(isValidRoomCode('AOIBCD')).toBe(false);
    expect(isValidRoomCode('012345')).toBe(false);
    expect(isValidRoomCode('A1BCDE')).toBe(false);
  });

  test('returns false for wrong length', () => {
    expect(isValidRoomCode('ABCDE')).toBe(false);
    expect(isValidRoomCode('ABCDEFG')).toBe(false);
    expect(isValidRoomCode('')).toBe(false);
  });

  test('returns false for lowercase', () => {
    expect(isValidRoomCode('abcdef')).toBe(false);
  });

  test('returns false for non-string input', () => {
    // @ts-ignore
    expect(isValidRoomCode(null)).toBe(false);
    // @ts-ignore
    expect(isValidRoomCode(undefined)).toBe(false);
    // @ts-ignore
    expect(isValidRoomCode(123456)).toBe(false);
  });

  test('returns false for codes with spaces or special chars', () => {
    expect(isValidRoomCode('ABC D1')).toBe(false);
    expect(isValidRoomCode('ABC-12')).toBe(false);
    expect(isValidRoomCode('ABC!@#')).toBe(false);
  });
});

describe('normalizeRoomCode', () => {
  test('returns the uppercase trimmed code when valid', () => {
    expect(normalizeRoomCode('abcdef')).toBe('ABCDEF');
    expect(normalizeRoomCode('  AbCdEf  ')).toBe('ABCDEF');
  });

  test('returns null for invalid codes', () => {
    expect(normalizeRoomCode('ABCDE')).toBeNull();
    expect(normalizeRoomCode('I23456')).toBeNull();
    expect(normalizeRoomCode('abcde')).toBeNull();
    expect(normalizeRoomCode('')).toBeNull();
    expect(normalizeRoomCode('   ')).toBeNull();
  });

  test('handles mixed case input', () => {
    expect(normalizeRoomCode('AbCdEf')).toBe('ABCDEF');
  });
});
