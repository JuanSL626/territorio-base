/**
 * Drizzle schema — the whole persistence surface of territorio-base.
 *
 * Two halves:
 *
 *  1. **Better Auth core tables** (`user`, `session`, `account`, `verification`,
 *     `rateLimit`). Their *exported const names* are load-bearing: the Drizzle
 *     adapter looks models up as `schema[modelName]`, so `user` must be exported
 *     as `user`, not `users`. Their *property* names are load-bearing too — the
 *     adapter resolves fields as `schemaModel[fieldName]` with Better Auth's
 *     camelCase field names (`emailVerified`, `createdAt`, …). SQL column names
 *     are free, so they are snake_case.
 *
 *     `account.issuer` is required by Better Auth 1.7 and is easy to miss when
 *     copying an older schema — without it, sign-in fails at account lookup.
 *
 *  2. **App tables** (`invite`, `analysis`).
 *
 * Timestamps are `integer` in `timestamp_ms` mode: Drizzle hands Better Auth a
 * real `Date` back, which is what its `customTransformOutput` expects.
 */
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import type * as SqliteDriver from 'drizzle-orm/better-sqlite3';

export const user = sqliteTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull(),
    emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
    image: text('image'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [uniqueIndex('user_email_unique').on(table.email)],
);

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    uniqueIndex('session_token_unique').on(table.token),
    index('session_user_id_idx').on(table.userId),
  ],
);

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    // Better Auth 1.7 namespaces credentials as `local:<providerId>` /
    // `oauth:<providerId>`; this column is NOT optional.
    issuer: text('issuer').notNull(),
    providerId: text('provider_id').notNull(),
    accountId: text('account_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: integer('access_token_expires_at', { mode: 'timestamp_ms' }),
    refreshTokenExpiresAt: integer('refresh_token_expires_at', { mode: 'timestamp_ms' }),
    scope: text('scope'),
    /** Scrypt hash. Never leaves the server. */
    password: text('password'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('account_user_id_idx').on(table.userId),
    index('account_issuer_account_id_idx').on(table.issuer, table.accountId),
  ],
);

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [index('verification_identifier_idx').on(table.identifier)],
);

/**
 * Backing store for `rateLimit.storage: 'database'`.
 *
 * In-memory rate limiting is per-process, so it silently degrades to nothing the
 * moment the app runs more than one worker. Login and sign-up are the two
 * endpoints worth brute-forcing on an invite-only tool, so the counter lives in
 * the database instead.
 */
export const rateLimit = sqliteTable(
  'rate_limit',
  {
    id: text('id').primaryKey(),
    key: text('key'),
    count: integer('count'),
    lastRequest: integer('last_request'),
  },
  (table) => [index('rate_limit_key_idx').on(table.key)],
);

/**
 * The only way to create an account.
 *
 * `code` is stored normalized (see `normalizeInviteCode`): uppercase, no
 * separators. It is a single-use bearer credential, kept in plaintext so an
 * admin can re-read and re-send a code that never arrived; it is scoped by
 * `expiresAt` and optionally pinned to one `email`.
 *
 * `usedAt` is the claim marker. It is set by a single conditional UPDATE
 * (`WHERE code = ? AND used_at IS NULL`), which is what makes the invite
 * genuinely single-use under concurrent sign-ups — see `claimInvite`.
 */
export const invite = sqliteTable(
  'invite',
  {
    id: text('id').primaryKey(),
    code: text('code').notNull(),
    /** Optional pin: if set, only this address may redeem the code. */
    email: text('email'),
    /** Author of the invite. Null for the bootstrap invite created by `seed`. */
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    note: text('note'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    usedAt: integer('used_at', { mode: 'timestamp_ms' }),
    usedByUserId: text('used_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  },
  (table) => [
    uniqueIndex('invite_code_unique').on(table.code),
    index('invite_email_idx').on(table.email),
  ],
);

/** Lifecycle of one analysis run. `partial` is a real, expected outcome. */
export const ANALYSIS_STATUSES = ['pending', 'running', 'ok', 'partial', 'error'] as const;
export type AnalysisStatus = (typeof ANALYSIS_STATUSES)[number];

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
 */
export const analysis = sqliteTable(
  'analysis',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name'),
    aoiGeojson: text('aoi_geojson', { mode: 'json' }).$type<AoiGeometry>().notNull(),
    areaHa: real('area_ha'),
    status: text('status', { enum: ANALYSIS_STATUSES }).notNull().default('pending'),
    resultJson: text('result_json', { mode: 'json' }).$type<Record<string, unknown>>(),
    /** Plain-Spanish failure reason, rendered verbatim in the `no-data` card. */
    errorMessage: text('error_message'),
    createdAt: integer('created_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    index('analysis_user_id_created_at_idx').on(table.userId, sql`${table.createdAt} DESC`),
  ],
);

/**
 * Every table, keyed by the name Better Auth looks models up under.
 *
 * Handed both to `drizzle()` and to `drizzleAdapter()`. Keeping one object
 * (instead of `import * as schema`) means the adapter sees tables and nothing
 * else, and that the two consumers can never drift apart.
 */
export const schema = {
  user,
  session,
  account,
  verification,
  rateLimit,
  invite,
  analysis,
};

/** The typed Drizzle client. Lives here so modules can import it next to a table. */
export type TerritorioDb = SqliteDriver.BetterSQLite3Database<typeof schema>;

export type User = typeof user.$inferSelect;
export type NewUser = typeof user.$inferInsert;
export type Session = typeof session.$inferSelect;
export type Account = typeof account.$inferSelect;
export type Verification = typeof verification.$inferSelect;
export type Invite = typeof invite.$inferSelect;
export type NewInvite = typeof invite.$inferInsert;
export type Analysis = typeof analysis.$inferSelect;
export type NewAnalysis = typeof analysis.$inferInsert;
