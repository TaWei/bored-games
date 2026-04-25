import { describe, test, expect } from 'bun:test';
import {
  generateDisplayName,
  isValidDisplayName,
  sanitizeDisplayName,
} from '../utils/display-name';

describe('generateDisplayName', () => {
  test('returns a name in "{Adjective} {Animal}" format', () => {
    const name = generateDisplayName();
    expect(name).toMatch(/^[A-Za-z]+ [A-Za-z]+$/);
  });

  test('returns a name with 2 parts separated by a space', () => {
    const name = generateDisplayName();
    expect(name.split(' ')).toHaveLength(2);
  });

  test('returns valid display names (passes isValidDisplayName)', () => {
    for (let i = 0; i < 50; i++) {
      expect(isValidDisplayName(generateDisplayName())).toBe(true);
    }
  });

  test('produces varied output across many calls', () => {
    const names = new Set<string>();
    for (let i = 0; i < 500; i++) {
      names.add(generateDisplayName());
    }
    expect(names.size).toBeGreaterThan(100);
  });
});

describe('isValidDisplayName', () => {
  test('accepts valid names', () => {
    expect(isValidDisplayName('Swift Fox')).toBe(true);
    expect(isValidDisplayName('AB')).toBe(true);
    expect(isValidDisplayName('A'.repeat(24))).toBe(true);
    expect(isValidDisplayName('CleverBear123')).toBe(true);
    expect(isValidDisplayName('Mr Fox')).toBe(true);
  });

  test('rejects too short names', () => {
    expect(isValidDisplayName('A')).toBe(false);
    expect(isValidDisplayName('')).toBe(false);
  });

  test('rejects too long names', () => {
    expect(isValidDisplayName('A'.repeat(25))).toBe(false);
    expect(isValidDisplayName('VeryLongNameThatExceeds24Chars')).toBe(false);
  });

  test('rejects names with invalid characters', () => {
    expect(isValidDisplayName('Swift-Fox')).toBe(false);
    expect(isValidDisplayName('Swift@Fox')).toBe(false);
    expect(isValidDisplayName('Swift Fox!')).toBe(false);
    expect(isValidDisplayName('Swift\tFox')).toBe(false);
  });

  test('rejects non-string input', () => {
    // @ts-ignore
    expect(isValidDisplayName(null)).toBe(false);
    // @ts-ignore
    expect(isValidDisplayName(undefined)).toBe(false);
    // @ts-ignore
    expect(isValidDisplayName(123)).toBe(false);
  });
});

describe('sanitizeDisplayName', () => {
  test('returns trimmed name', () => {
    expect(sanitizeDisplayName('  Swift Fox  ')).toBe('Swift Fox');
  });

  test('collapses multiple spaces', () => {
    expect(sanitizeDisplayName('Swift    Fox')).toBe('Swift Fox');
    expect(sanitizeDisplayName('  Swift   Fox  ')).toBe('Swift Fox');
  });

  test('removes special characters', () => {
    // Special chars are replaced with spaces, then multiple spaces collapsed, then trimmed
    expect(sanitizeDisplayName('Swift@#$Fox')).toBe('Swift Fox');
  });

  test('handles trailing special characters correctly', () => {
    // trim() runs last, so trailing special chars are properly removed
    expect(sanitizeDisplayName('Swift-Fox!')).toBe('Swift Fox');
    expect(sanitizeDisplayName('Test!')).toBe('Test');
  });

  test('limits to 24 characters', () => {
    const long = 'A'.repeat(30);
    expect(sanitizeDisplayName(long).length).toBe(24);
  });

  test('returns empty string for whitespace-only input', () => {
    expect(sanitizeDisplayName('   ')).toBe('');
    expect(sanitizeDisplayName('\t\n')).toBe('');
  });

  test('handles mixed content correctly', () => {
    // '  Swift@#$ Fox!  ' → 'Swift  Fox !' → trim → 'Swift  Fox' (trim at end, trailing space removed)
    expect(sanitizeDisplayName('  Swift@#$ Fox!  ')).toBe('Swift Fox');
  });
});
