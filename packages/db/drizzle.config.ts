/**
 * drizzle-kit config — used only to GENERATE migrations (`pnpm db:generate`).
 *
 * Applying them is `pnpm db:migrate`, which runs `scripts/migrate.ts` against
 * drizzle-orm's programmatic migrator. That keeps drizzle-kit — a devDependency
 * — off the production path.
 *
 * This file intentionally imports nothing from `src/`: drizzle-kit loads it in
 * its own esbuild sandbox, and pulling in `env.ts` would make schema generation
 * require a valid `BETTER_AUTH_SECRET`.
 */
import { defineConfig } from 'drizzle-kit';
import { isAbsolute, resolve } from 'node:path';

const raw = process.env.DATABASE_URL ?? 'file:./data/territorio.db';
const path = raw.startsWith('file:') ? raw.slice('file:'.length) : raw;
// drizzle-kit loads this file through its own bundler, where `import.meta.dirname`
// is undefined — hence cwd, which drizzle-kit always sets to the package root.
// `packages/db` → repo root is two levels up, matching `resolveDatabaseFile`.
const url = isAbsolute(path) ? path : resolve(process.cwd(), '../..', path);

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/schema.ts',
  out: './drizzle',
  dbCredentials: { url },
  strict: true,
  verbose: true,
});
