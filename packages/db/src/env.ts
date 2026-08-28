/**
 * Server-side environment contract for this package: `DATABASE_URL` only.
 *
 * Validated with zod, parsed **lazily**. Importing `@territorio/db` must never
 * be enough to crash a process: `pnpm typecheck`, `pnpm lint` and unit tests all
 * import this package with an empty environment. Nothing is read until the first
 * call to `getEnv()`, which is memoized.
 *
 * This module is server-only. It reads `process.env` and must never be pulled
 * into a browser bundle.
 */
import * as z from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Postgres connection string for Drizzle (`postgres-js`), pointed at
   * Supabase Postgres. No default, on purpose — a wrong-but-valid default
   * (e.g. a stray local Postgres) is a worse failure mode for a database
   * connection than failing loudly at boot.
   *
   * Three valid shapes, see `docs/supabase/03-datos-migracion.md` §5 and
   * `.env.example`: Supavisor session mode (port 5432, recommended for this
   * app's long-lived Node server), Supavisor transaction mode (port 6543,
   * needs `{ prepare: false }` in `client.ts`), or a direct connection
   * (port 5432, `db.<project>.supabase.co`, needs IPv6 egress).
   */
  DATABASE_URL: z
    .string()
    .min(1, 'DATABASE_URL es obligatoria: la cadena de conexión de Postgres (ver .env.example).')
    .refine(
      (value) => value.startsWith('postgres://') || value.startsWith('postgresql://'),
      'DATABASE_URL debe empezar con postgres:// o postgresql:// (cadena de conexión de Postgres, no un archivo SQLite).',
    ),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and memoize the environment.
 *
 * Throws once, with every failing variable listed, instead of surfacing
 * `undefined` three layers down inside a query.
 */
export function getEnv(source: NodeJS.ProcessEnv = process.env): Env {
  if (cached !== null) return cached;

  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `  · ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(
      `Variables de entorno inválidas o faltantes:\n${detail}\n\nRevisá .env.example en la raíz del repo.`,
    );
  }

  cached = parsed.data;
  return cached;
}

/** Test seam. Never call this from application code. */
export function resetEnvCache(): void {
  cached = null;
}
