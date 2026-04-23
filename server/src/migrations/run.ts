// ============================================================
// MIGRATION RUNNER — executes .sql files against PostgreSQL
// Usage: bun run db:migrate
// ============================================================

import { readdirSync, readFileSync } from 'fs';
import { join, resolve } from 'path';
import postgres from 'postgres';
import { config } from '../lib/config';

const MIGRATIONS_DIR = resolve(import.meta.dir, '.');

async function runMigrations() {
  console.log('🔄 Running migrations...');
  console.log(`   Database: ${config.DATABASE_URL.replace(/:[^:@]+@/, ':***@')}`);

  const sql = postgres(config.DATABASE_URL, { max: 1 });

  // Get all .sql files sorted alphabetically
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.log('   No migration files found.');
    return;
  }

  for (const file of files) {
    const path = join(MIGRATIONS_DIR, file);
    const content = readFileSync(path, 'utf-8');

    console.log(`   Running: ${file}`);
    try {
      await sql.unsafe(content);
      console.log(`   ✅ ${file}`);
    } catch (err) {
      console.error(`   ❌ ${file} failed:`);
      console.error(err);
      throw err;
    }
  }

  await sql.end();
  console.log('✅ All migrations complete.');
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
