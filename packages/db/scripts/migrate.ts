/**
 * Apply the checked-in migrations.
 *
 *   pnpm --filter @territorio/db db:migrate
 *
 * Uses drizzle-orm's programmatic migrator rather than `drizzle-kit migrate`, so
 * production only needs the runtime dependency. Idempotent: already-applied
 * migrations are skipped via drizzle's `__drizzle_migrations` table.
 *
 * Reads `DATABASE_URL` and nothing else — a migration must not need the auth
 * signing key.
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { closeDb, getDb } from '../src/client.ts';
import { getDatabaseFile } from '../src/env.ts';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');
const file = getDatabaseFile();

console.warn(`Aplicando migraciones sobre ${file}`);
migrate(getDb(file), { migrationsFolder });
closeDb();
console.warn('Migraciones aplicadas.');
