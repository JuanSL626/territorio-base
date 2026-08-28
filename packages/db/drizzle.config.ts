/**
 * drizzle-kit config — used only to GENERATE migrations (`pnpm db:generate`).
 *
 * Applying them is the Supabase CLI's job (`supabase db push` against the
 * linked project, `supabase db reset` locally) — never `drizzle-kit migrate`
 * or `drizzle-kit push` against the real project. Two migration-history
 * tables (`drizzle`'s own vs. Supabase's `supabase_migrations`) that don't
 * know about each other is exactly the trap that produces: see
 * `docs/supabase/03-datos-migracion.md` §2. `out` therefore points at
 * `supabase/migrations` — the repo root's Supabase project, not a
 * `packages/db/drizzle` of its own — and `migrations.prefix: 'supabase'`
 * names files the way the Supabase CLI expects
 * (`<timestamp>_<slug>.sql`, timestamp = literal apply order).
 *
 * This file intentionally imports nothing from `src/`: drizzle-kit loads it in
 * its own esbuild sandbox, and pulling in `env.ts` would make schema generation
 * require a valid `DATABASE_URL`. `drizzle-kit generate` itself never opens a
 * connection — it diffs `schema.ts` against `supabase/migrations`' own
 * snapshots — but `dbCredentials.url` is still declared, matching the config
 * shape drizzle-kit expects for the `postgresql` dialect.
 */
import { defineConfig } from 'drizzle-kit';
import { resolve } from 'node:path';

// drizzle-kit always sets cwd to the package root when it loads this file
// (`packages/db`); the repo-root `supabase/` directory is two levels up.
const repoRoot = resolve(process.cwd(), '../..');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: resolve(repoRoot, 'supabase/migrations'),
  migrations: { prefix: 'supabase' },
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://placeholder/placeholder' },
  strict: true,
  verbose: true,
});
