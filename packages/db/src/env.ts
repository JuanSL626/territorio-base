/**
 * Server-side environment contract.
 *
 * Validated with zod, parsed **lazily**. Importing `@territorio/db` must never
 * be enough to crash a process: `pnpm typecheck`, `pnpm lint` and unit tests all
 * import this package with an empty environment. Nothing is read until the first
 * call to `getEnv()`, which is memoized.
 *
 * This module is server-only. It reads `process.env` and must never be pulled
 * into a browser bundle — `apps/web` imports it exclusively from server
 * functions and `beforeLoad` guards.
 */
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as z from 'zod';

/**
 * The variables the web server validates at boot.
 *
 * `.env.example` documents more than this — the ones `services/api` reads
 * (`TERRITORIO_*`), the build-time `VITE_API_URL`, and the ones only
 * `compose.yaml` interpolates. Those are deliberately outside this schema:
 * they belong to processes that never import this package.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /**
   * Signing key for session tokens and every other Better Auth secret.
   * 32 bytes minimum: `openssl rand -base64 32`.
   */
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, 'BETTER_AUTH_SECRET debe tener al menos 32 caracteres (openssl rand -base64 32)'),

  /** Public origin of the web app. Drives cookie `Secure` and trusted origins. */
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),

  /** SQLite file. `file:` prefix optional; relative paths resolve to the repo root. */
  DATABASE_URL: z.string().min(1).default('file:./data/territorio.db'),

  /**
   * Base URL of the Python raster service (`services/api`).
   *
   * 8787 — the port `services/api` binds in `pnpm dev`, in its Dockerfile and
   * in its README, and the fallback hardcoded in `apps/web/src/lib/api.ts`.
   * This default used to say 8000, which meant an unset `API_URL` pointed the
   * SSR server at a port nothing listens on. Every file in the repo now says
   * 8787; a 8000 anywhere is a leftover, not a convention.
   */
  API_URL: z.url().default('http://localhost:8787'),

  /** Only read by `scripts/seed.ts`. Optional everywhere else. */
  ADMIN_EMAIL: z.email().optional(),
  ADMIN_PASSWORD: z.string().min(12, 'ADMIN_PASSWORD debe tener al menos 12 caracteres').optional(),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Parse and memoize the environment.
 *
 * Throws once, with every failing variable listed, instead of surfacing
 * `undefined` three layers down inside Better Auth.
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

/**
 * The database file, validating `DATABASE_URL` and nothing else.
 *
 * Running migrations must not require `BETTER_AUTH_SECRET`: a deploy applies
 * schema changes from contexts that have no business holding the signing key.
 */
export function getDatabaseFile(source: NodeJS.ProcessEnv = process.env): string {
  return resolveDatabaseFile(envSchema.shape.DATABASE_URL.parse(source.DATABASE_URL));
}

/**
 * Walk up from this file until the workspace root (the directory holding
 * `pnpm-workspace.yaml`) is found.
 *
 * `DATABASE_URL` is relative by default, and Turborepo runs every task with the
 * *package* directory as cwd. Resolving against `process.cwd()` would therefore
 * give `packages/db/data/territorio.db` for a migration and
 * `apps/web/data/territorio.db` for the server — two different databases, no
 * error message, and a login that "randomly" stops working. Anchoring on the
 * workspace root makes the path mean the same thing from every cwd.
 */
function findWorkspaceRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 12; depth += 1) {
    if (existsSync(resolve(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

/**
 * Turn `DATABASE_URL` into an absolute filesystem path.
 *
 * Accepts `file:./data/territorio.db`, `./data/territorio.db`, `:memory:` and
 * absolute paths. In production, prefer an absolute path.
 */
export function resolveDatabaseFile(databaseUrl: string): string {
  const raw = databaseUrl.startsWith('file:') ? databaseUrl.slice('file:'.length) : databaseUrl;
  if (raw === ':memory:' || raw === '') return raw;
  if (isAbsolute(raw)) return raw;
  return resolve(findWorkspaceRoot(), raw);
}
