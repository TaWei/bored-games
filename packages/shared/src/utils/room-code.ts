// ============================================================
// ROOM CODE GENERATOR
// Cryptographically random 6-char alphanumeric codes
// Entropy: 62^6 ≈ 56 billion combinations
// ============================================================

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
// Note: deliberately excludes I, O, 0, 1 to avoid confusion

/**
 * Generate a cryptographically random room code.
 * @param length - Number of characters (default 6)
 */
export function generateRoomCode(length = 6): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => ALPHABET[b % ALPHABET.length]!)
    .join('');
}

/**
 * Validate room code format.
 * Returns true if the code matches the expected format.
 */
export function isValidRoomCode(code: string): boolean {
  if (typeof code !== 'string') return false;
  if (code.length !== 6) return false;
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/.test(code);
}

/**
 * Normalize a room code (uppercase, trimmed).
 * Returns null if the normalized result isn't valid.
 */
export function normalizeRoomCode(code: string): string | null {
  const normalized = code.trim().toUpperCase();
  return isValidRoomCode(normalized) ? normalized : null;
}
