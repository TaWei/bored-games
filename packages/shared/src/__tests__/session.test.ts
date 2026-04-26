import { describe, test, expect } from 'bun:test';
import { isValidSessionId, hashSessionId } from '../utils/session';

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

describe('hashSessionId', () => {
  test('produces a SHA-256 hex digest (64 characters)', async () => {
    const hash = await hashSessionId('test-session-id');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  test('produces consistent output for same input', async () => {
    const hash1 = await hashSessionId('consistent-input');
    const hash2 = await hashSessionId('consistent-input');
    expect(hash1).toBe(hash2);
  });

  test('produces different output for different inputs', async () => {
    const hash1 = await hashSessionId('input-a');
    const hash2 = await hashSessionId('input-b');
    expect(hash1).not.toBe(hash2);
  });

  test('produces a valid UUID v4 hashed format (deterministic)', async () => {
    const hash = await hashSessionId('123e4567-e89b-42d3-a456-426614174000');
    // SHA-256 produces 64 hex chars — same format as session ID storage
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  test('empty string produces a valid hash', async () => {
    const hash = await hashSessionId('');
    expect(hash).toHaveLength(64);
  });

  test('unicode input is handled correctly', async () => {
    const hash = await hashSessionId('名前');
    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });
});
