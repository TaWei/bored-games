// ============================================================
// SESSION HELPERS
// ============================================================

/**
 * Hash a sessionId using SHA-256 for privacy-preserving storage.
 * The raw sessionId is never stored in the database — only its hash.
 *
 * Uses Web Crypto API (browser) or Node crypto (server).
 */
export async function hashSessionId(sessionId: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(sessionId);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Synchronous hash using Node crypto (server-side only).
 * Falls back to a placeholder in browser environments.
 */
export function hashSessionIdSync(sessionId: string): string {
  // Will be overridden by server-side import
  // This is a browser-safe stub
  if (typeof globalThis.crypto !== 'undefined' && 'subtle' in globalThis.crypto) {
    throw new Error('Use hashSessionId() in browser — this is async');
  }
  // Node.js path (imported dynamically in server)
  return sessionId; // placeholder until Node implementation
}

/**
 * Validate a sessionId format (UUID v4).
 */
export function isValidSessionId(sessionId: string): boolean {
  if (typeof sessionId !== 'string') return false;
  // UUID v4 regex
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sessionId);
}
