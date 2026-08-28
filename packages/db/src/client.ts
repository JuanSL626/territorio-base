/**
 * Postgres connection + typed Drizzle client. Opened lazily and memoized:
 * importing this module must not touch the network, so lint/typecheck/tests
 * stay side-effect free.
 *
 * Target is `postgres-js` in Supavisor session mode (port 5432) or a direct
 * connection — see `docs/supabase/03-datos-migracion.md` §5. Session mode
 * holds one long-lived connection for the process and supports prepared
 * statements (`postgres-js`'s default, `prepare: true`). `DATABASE_URL`
 * decides host/port; pointing it at the transaction pooler (port 6543)
 * without also setting `prepare: false` fails at the first prepared query.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { getEnv } from './env.ts';
import { type TerritorioDb, schema } from './schema.ts';

function createDb(connectionString: string) {
  const sql = postgres(connectionString);
  return { sql, db: drizzle({ client: sql, schema }) };
}

let cached: {
  connectionString: string;
  sql: ReturnType<typeof postgres>;
  db: TerritorioDb;
} | null = null;

/**
 * The Drizzle client. Same instance for the whole process.
 *
 * `connectionString` is only for tests and one-off scripts; leave it out in
 * app code so it comes from `DATABASE_URL`.
 */
export function getDb(connectionString?: string): TerritorioDb {
  return getConnection(connectionString).db;
}

/** The raw `postgres-js` handle — needed by anything that wants a raw query. */
export function getSql(connectionString?: string): ReturnType<typeof postgres> {
  return getConnection(connectionString).sql;
}

function getConnection(connectionString?: string): {
  connectionString: string;
  sql: ReturnType<typeof postgres>;
  db: TerritorioDb;
} {
  const target = connectionString ?? getEnv().DATABASE_URL;
  if (cached !== null) {
    if (cached.connectionString !== target) {
      throw new Error(
        'Ya hay una conexión abierta a otra base; cerrala con closeDb() antes de abrir otra.',
      );
    }
    return cached;
  }
  cached = { connectionString: target, ...createDb(target) };
  return cached;
}

/** Close the connection. For tests and for scripts that must exit cleanly. */
export async function closeDb(): Promise<void> {
  if (cached === null) return;
  await cached.sql.end();
  cached = null;
}
