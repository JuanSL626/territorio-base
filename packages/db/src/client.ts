/**
 * The Postgres connection and the typed Drizzle client.
 *
 * Opened lazily and memoized: importing this module must not touch the
 * network, so `lint`, `typecheck` and unit tests stay side-effect free.
 *
 * `postgres-js` in **Supavisor session mode** (port 5432, `*.pooler.supabase.com`
 * host, or a direct `db.<project>.supabase.co:5432` connection) is the
 * intended target — see `docs/supabase/03-datos-migracion.md` §5 for why:
 * this process holds one long-lived connection (or a small pool) for its
 * whole lifetime, which is exactly what session mode is for, and it supports
 * prepared statements (`postgres-js`'s default), unlike transaction mode
 * (port 6543), which would need `{ prepare: false }`. Nothing here hardcodes
 * a port or host — that's `DATABASE_URL`'s job (see `.env.example`) — but
 * `prepare: true` (the default) is *only* correct for session mode/direct
 * connection; pointing `DATABASE_URL` at the transaction pooler without also
 * flipping this to `prepare: false` will fail at the first prepared query.
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
