/**
 * The SQLite connection and the typed Drizzle client.
 *
 * Opened lazily and memoized: importing this module must not touch the
 * filesystem, so `lint`, `typecheck` and unit tests stay side-effect free.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { getEnv, resolveDatabaseFile } from './env.ts';
import { type TerritorioDb, schema } from './schema.ts';

/**
 * PRAGMAs, and why each one is not optional:
 *
 * - `foreign_keys = ON` — SQLite ignores foreign keys **per connection** unless
 *   this is set. Without it, `analysis.user_id` and `invite.used_by_user_id`
 *   are decorative: deleting a user leaves orphan rows and no error.
 * - `journal_mode = WAL` — readers do not block the writer. The SSR guard reads
 *   the session on every request while the analysis writer is running.
 * - `busy_timeout` — turns a `SQLITE_BUSY` throw into a bounded wait.
 * - `synchronous = NORMAL` — the safe pairing with WAL.
 */
function applyPragmas(sqlite: Database.Database): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.pragma('synchronous = NORMAL');
}

function createDb(file: string) {
  if (file !== ':memory:' && file !== '') {
    mkdirSync(dirname(file), { recursive: true });
  }
  const sqlite = new Database(file);
  applyPragmas(sqlite);
  return { sqlite, db: drizzle(sqlite, { schema }) };
}

let cached: { file: string; sqlite: Database.Database; db: TerritorioDb } | null = null;

/**
 * The Drizzle client. Same instance for the whole process.
 *
 * `file` is only for tests and one-off scripts; leave it out in app code so the
 * path comes from `DATABASE_URL`.
 */
export function getDb(file?: string): TerritorioDb {
  return getConnection(file).db;
}

/** The raw better-sqlite3 handle — needed by the migrator and by `PRAGMA` work. */
export function getSqlite(file?: string): Database.Database {
  return getConnection(file).sqlite;
}

function getConnection(file?: string): {
  file: string;
  sqlite: Database.Database;
  db: TerritorioDb;
} {
  const target = file ?? resolveDatabaseFile(getEnv().DATABASE_URL);
  if (cached !== null) {
    if (cached.file !== target) {
      throw new Error(
        `Ya hay una conexión abierta a "${cached.file}"; se pidió "${target}". Cerrala con closeDb() antes de abrir otra.`,
      );
    }
    return cached;
  }
  cached = { file: target, ...createDb(target) };
  return cached;
}

/** Close the connection. For tests and for scripts that must exit cleanly. */
export function closeDb(): void {
  if (cached === null) return;
  cached.sqlite.close();
  cached = null;
}
