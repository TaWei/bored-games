import { describe, test, expect } from 'bun:test';
import { isValidSessionId } from '../utils/session';

describe('isValidSessionId', () => {
  test('accepts valid UUID v4 strings', () => {
    // Standard UUID v4 format — version=4 at position 15, variant=8/9/a/b at position 17
    expect(isValidSessionId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
    expect(isValidSessionId('a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5')).toBe(true);
    // Version=4 (pos15), variant=b (pos17)
    expect(isValidSessionId('AAAAAAAA-BBBB-4abc-8DDD-123456789abc')).toBe(true);
  });

  test('accepts lowercase UUID v4 strings', () => {
    expect(isValidSessionId('123e4567-e89b-42d3-a456-426614174000')).toBe(true);
  });

  test('rejects UUID v4 with wrong version digit', () => {
    // Version 5 (not v4) — version nibble at pos15 should be 4
    expect(isValidSessionId('123e4567-e89b-52d3-a456-426614174000')).toBe(false);
    // Version 1
    expect(isValidSessionId('123e4567-e89b-12d3-a456-426614174000')).toBe(false);
  });

  test('rejects malformed UUID strings', () => {
    expect(isValidSessionId('not-a-uuid')).toBe(false);
    expect(isValidSessionId('123e4567e89b42d3a456426614174000')).toBe(false); // no hyphens
    expect(isValidSessionId('123e4567-e89b-42d3-a456')).toBe(false); // too short
    expect(isValidSessionId('123e4567-e89b-42d3-a456-426614174000-extra')).toBe(false); // too long
  });

  test('rejects empty or whitespace strings', () => {
    expect(isValidSessionId('')).toBe(false);
    expect(isValidSessionId('   ')).toBe(false);
  });

  test('rejects non-string input', () => {
    // @ts-ignore
    expect(isValidSessionId(null)).toBe(false);
    // @ts-ignore
    expect(isValidSessionId(undefined)).toBe(false);
    // @ts-ignore
    expect(isValidSessionId(123)).toBe(false);
    // @ts-ignore
    expect(isValidSessionId({})).toBe(false);
  });
});
