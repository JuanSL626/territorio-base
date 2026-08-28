/**
 * Drizzle schema — the whole persistence surface of territorio-base, on
 * Supabase Postgres.
 *
 * Better Auth's own tables (`user`, `session`, `account`, `verification`) and
 * `invite` are GONE from this package. Supabase Auth (GoTrue) owns
 * authentication now: `auth.users` is provisioned and migrated by Supabase
 * itself, never by a migration in this repo. `authUsers` below is Drizzle's
 * read-only *reference* to that table — just enough shape to declare a
 * foreign key from `analysis.user_id`, not a table this package creates.
 *
 * What's left are the two tables that were never Better Auth's: `analysis`
 * and `rate_limit`. See `README.md` for what moved where.
 *
 * RLS: both tables call `.enableRLS()` with zero `pgPolicy()` calls attached.
 * That is *default-deny*, on purpose — a cheap safety net against the fact
 * that Supabase exposes every table in `public` over PostgREST by default
 * (`anon`/`authenticated` roles), not the real authorization mechanism. The
 * real mechanism is unchanged: every function in `analyses.ts` /
 * `rate-limit.ts` filters explicitly on `userId`, and the only thing that
 * ever opens a Postgres connection is this one trusted Node process (via
 * `client.ts`, using the Postgres role in `DATABASE_URL` — not the `anon` or
 * `authenticated` roles RLS is guarding against), which RLS does not
 * restrict.
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  index,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { authUsers } from 'drizzle-orm/supabase';

import type * as PostgresJsDriver from 'drizzle-orm/postgres-js';

/**
 * Backing store for the login/sign-up rate limiter in `rate-limit.ts`.
 *
 * `last_request` stays `bigint` (epoch ms), NOT `timestamptz`: the CAS upsert
 * in `consumeRateLimit` does integer arithmetic directly
 * (`(now - last_request) > windowMs`, all in milliseconds). Making this a
 * `timestamptz` would force rewriting that comparison as interval arithmetic
 * for no benefit — this table is never read by date range or `ORDER BY`, it
 * is the one timestamp in the schema that participates in integer math
 * instead of date comparison. See `docs/supabase/03-datos-migracion.md`.
 */
export const rateLimit = pgTable(
  'rate_limit',
  {
    id: uuid('id').primaryKey(),
    key: text('key').notNull(),
    count: bigint('count', { mode: 'number' }),
    lastRequest: bigint('last_request', { mode: 'number' }),
  },
  (table) => [uniqueIndex('rate_limit_key_unique').on(table.key)],
).enableRLS();

/** Lifecycle of one analysis run. `partial` is a real, expected outcome. */
export const ANALYSIS_STATUSES = ['pending', 'running', 'ok', 'partial', 'error'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

/** Postgres-enforced version of the same status list — SQLite only ever validated it in TypeScript. */
export const analysisStatus = pgEnum('analysis_status', ANALYSIS_STATUSES);

/**
 * Minimal structural type for a stored AOI.
 *
 * `packages/geo` owns AOI parsing and validation; this is only strong enough to
 * keep the column from being `unknown` at the call site.
 */
export type AoiGeometry = {
  type: 'Polygon' | 'MultiPolygon';
  coordinates: unknown[];
};

/**
 * One analysis, owned by the user who ran it.
 *
 * The design brief keeps AOI geometry out of the URL (`?aoi=<id>`); this table
 * is what that id points at, which is also what makes `/reporte/$analysisId`
 * re-openable after a reload.
 *
 * `resultJson` is deliberately loose. The analysis contract lives in
 * `packages/api-client` / `packages/geo`; once it is a type, narrow this column
 * with `.$type<AnalysisResult>()` — one edit, no migration.
 *
 * `resultJson` is `jsonb`, not `json`: Postgres has no ~6 MB ceiling the way
 * SQLite effectively did, but a large value still pays TOAST
 * compression/decompression on every read — which is why `MAX_RESULT_BYTES`
 * in `apps/web/src/lib/analysis-runtime.ts` stays exactly as it was, as an
 * app-level constant, not something Postgres makes unnecessary. What `jsonb`
 * *does* buy over plain `text`+`json.parse` is the two expression indexes
 * below, replacing what used to be a `json_extract(...)` full table scan.
 */
export const analysis = pgTable(
  'analysis',
  {
    id: uuid('id').primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    name: text('name'),
    aoiGeojson: jsonb('aoi_geojson').$type<AoiGeometry>().notNull(),
    areaHa: real('area_ha'),
    status: analysisStatus('status').notNull().default('pending'),
    resultJson: jsonb('result_json').$type<Record<string, unknown>>(),
    /** Plain-Spanish failure reason, rendered verbatim in the `no-data` card. */
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('analysis_user_id_created_at_idx').on(table.userId, sql`${table.createdAt} DESC`),
    // Replaces the old `json_extract(result_json, '$.raster_job_id')` full
    // table scan (see `getAnalysisByRasterJobIdForUser` in `analyses.ts`).
    index('analysis_raster_job_id_idx').on(sql`(${table.resultJson} ->> 'raster_job_id')`),
    // Same idea for the coastal overlay cache key
    // (`getAnalysisByCoastalCacheKeyForUser`); `coastal` is nested one level
    // deeper than `raster_job_id`, hence the `->` then `->>`.
    index('analysis_coastal_cache_key_idx').on(
      sql`(${table.resultJson} -> 'coastal' ->> 'cache_key')`,
    ),
  ],
).enableRLS();

/**
 * Every table this package owns and creates.
 *
 * `auth.users` (via `authUsers`) is intentionally NOT in here: it is a
 * reference for foreign keys, not a table this schema object should ever be
 * asked to migrate or seed.
 */
export const schema = {
  rateLimit,
  analysis,
};

/** The typed Drizzle client. Lives here so modules can import it next to a table. */
export type TerritorioDb = PostgresJsDriver.PostgresJsDatabase<typeof schema>;

export type Analysis = typeof analysis.$inferSelect;
export type NewAnalysis = typeof analysis.$inferInsert;
