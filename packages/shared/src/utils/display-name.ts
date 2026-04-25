// ============================================================
// DISPLAY NAME GENERATOR
// Random "{Adjective} {Animal}" names — e.g., "Clever Fox"
// ============================================================

const ADJECTIVES = [
  'Swift', 'Clever', 'Brave', 'Lucky', 'Mighty',
  'Gentle', 'Bold', 'Witty', 'Calm', 'Keen',
  'Fierce', 'Wise', 'Noble', 'Quick', 'Silent',
  'Cunning', 'Vivid', 'Zesty', 'Cosmic', 'Neon',
  'Arctic', 'Solar', 'Lunar', 'Stellar', 'Frosty',
  'Turbo', 'Hyper', 'Ultra', 'Mega', 'Super',
  'Epic', 'Rad', 'Wavy', 'Breezy',
  'Spicy', 'Chill', 'Funky', 'Jazzy', 'Peppy',
  'Snappy', 'Zippy', 'Fluffy', 'Crackle', 'Glowing',
  'Shadow', 'Stormy', 'Crystal', 'Velvet', 'Iron',
];

const ANIMALS = [
  'Penguin', 'Fox', 'Bear', 'Wolf', 'Hawk',
  'Tiger', 'Eagle', 'Otter', 'Raven', 'Lynx',
  'Panda', 'Falcon', 'Crane', 'Heron', 'Ibis',
  'Seal', 'Badger', 'Viper', 'Mink', 'Newt',
  'Falcon', 'Stag', 'Boar', 'Crab', 'Orca',
  'Mako', 'Finch', 'Wren', 'Vole', 'Shrike',
  'Moose', 'Gecko', 'Iguana', 'Llama', 'Alpaca',
  'Quail', 'Puffin', 'Stoat', 'Kite', 'Kestrel',
  'Osprey', 'Goshawk', 'Marten', 'Pika', 'Dhole',
  'Tapir', 'Saola', 'Narwhal', 'Bison', 'Okapi',
];

/**
 * Generate a random display name: "{Adjective} {Animal}"
 */
export function generateDisplayName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]!;
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]!;
  return `${adj} ${animal}`;
}

/**
 * Validate a display name.
 * - 2–24 characters
 * - Alphanumeric + spaces only
 */
export function isValidDisplayName(name: string): boolean {
  if (typeof name !== 'string') return false;
  if (name.length < 2 || name.length > 24) return false;
  return /^[A-Za-z0-9 ]+$/.test(name);
}

/**
 * Sanitize a display name (trim, collapse spaces, limit length).
 */
export function sanitizeDisplayName(name: string): string {
  return name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 24);
}
