# @territorio/db

Drizzle + Supabase Postgres. Owns the schema, the typed Drizzle client, and
ownership-scoped queries for `analysis` and the `rate_limit` upsert.

**Server only.** Every export reaches `node:crypto` or opens a Postgres
connection. Import it from server functions, route guards and scripts —
never from a component.

---

## What moved, with the SQLite → Supabase migration

This package used to also own the whole authentication policy (Better Auth:
`user`/`session`/`account`/`verification`, plus the app's own `invite` table
and gate). That is **gone**:

| Was here | Now |
| --- | --- |
| `user`, `session`, `account`, `verification` tables | `auth.users` etc., provisioned and migrated by Supabase (GoTrue) — not a table this repo creates or versions |
| `invite` table + `src/invites.ts` | Retired. Sign-up is expected to move to Supabase's native `inviteUserByEmail`, which needs no app-owned invite table |
| `src/auth.ts` (Better Auth instance, invite-gated sign-up hooks) | Deleted. Its replacement — wiring Supabase Auth — is a separate, in-flight piece of work, not part of this package |
| `src/web-boundary.ts` + `web-boundary.test.ts` (the `webAuthBoundary` seam `apps/web/src/lib/session.ts` resolves) | Deleted along with `auth.ts`/`invites.ts`: it was pure Better-Auth-to-Supabase-error-code glue, and Supabase Auth's session/cookie model isn't the same shape (JWT-based, typically `@supabase/ssr`). Rebuilding this seam against Supabase Auth is the next piece of work — see `apps/web/src/lib/session.ts` for the contract it needs to satisfy |
| `scripts/migrate.ts` | Deleted. Applying schema changes is now the Supabase CLI's job (`supabase db push` / `supabase db reset`) — see "Changing the schema" below |
| `scripts/seed.ts`, `scripts/create-invite.ts`, `scripts/argv.ts` | Deleted. Both were invite-table CLIs; with `invite` gone they have nothing to operate on. Provisioning the first user is expected to go through Supabase's own admin tooling (`inviteUserByEmail` / the Dashboard), not a script in this package |
| `packages/db/drizzle/*.sql` (SQLite migrations) | Deleted. Postgres migrations now live in `supabase/migrations/` at the repo root — the Supabase CLI's own directory, not a package-local one (see below) |

What **survived**, translated to Postgres (full mapping and rationale in
`docs/supabase/03-datos-migracion.md`):

- `analysis` — `id`/`user_id` are now `uuid` (`user_id` a real FK to
  `auth.users(id) ON DELETE CASCADE`), timestamps are `timestamptz`,
  `aoi_geojson`/`result_json` are `jsonb`, `status` is a Postgres
  `analysis_status` enum (Postgres-enforced now, not just a TypeScript union).
- `rate_limit` — `id` is `uuid`; `count`/`last_request` **stay `bigint`**
  (epoch ms), not `timestamptz` — the CAS upsert in `rate-limit.ts` does
  integer arithmetic directly, see that file's header.

Both tables call `.enableRLS()` in `schema.ts` with **zero** `pgPolicy()`
attached — default-deny. That's a safety net against Supabase exposing every
`public` table over PostgREST by default, not the real authorization
mechanism: the real mechanism is unchanged, every function in `analyses.ts`
still filters explicitly on `userId`, and the only thing that ever opens a
Postgres connection here is this one trusted Node process (via `client.ts`),
which RLS does not restrict.

---

## Getting started

```bash
cp .env.example .env                                   # from the repo root
# set DATABASE_URL to a Supabase Postgres connection string
```

There is no `db:migrate` / `db:seed` in this package any more. Schema changes
are applied with the Supabase CLI, against either the local Docker stack
(`supabase start` + `supabase db reset`) or the linked remote project
(`supabase db push`) — see "Changing the schema" below.

---

## Schema notes

- **`analysis.result_json` is `jsonb`.** Postgres has no ~6 MB ceiling the way
  SQLite effectively did — the practical limit is ~1 GB per value — but a
  large value still pays TOAST compression/decompression on every read. The
  6 MB cap in `apps/web/src/lib/analysis-runtime.ts` (`MAX_RESULT_BYTES`)
  stays exactly as it was: an app-level constant, not a SQLite limitation
  Postgres removes the need for.
- **Two jsonb expression indexes** replace what used to be
  `json_extract(...)` full table scans in `analyses.ts`:
  `analysis_raster_job_id_idx` on `(result_json ->> 'raster_job_id')` and
  `analysis_coastal_cache_key_idx` on
  `(result_json -> 'coastal' ->> 'cache_key')`. The query code has to match
  the index expression exactly (`->`/`->>` in the same shape) for Postgres to
  use it — see the comments in `analyses.ts` at each call site.
- **IDs are `uuid`, generation unchanged.** `createAnalysis` still calls
  `randomUUID()` from `node:crypto` and passes the value explicitly — no
  `defaultRandom()` in the schema, same as before.
- **`rate_limit.last_request` stays `bigint`, not `timestamptz`** — see
  `rate-limit.ts`'s header for why (it's arithmetic, not a date comparison).

### Changing the schema

```bash
# edit src/schema.ts
pnpm --filter @territorio/db db:generate    # writes supabase/migrations/<timestamp>_*.sql
supabase db reset                            # applies + validates against the local Docker stack
git add supabase/migrations                  # migrations are checked in, at the repo root — not here
supabase db push                             # applies to the linked remote project
```

`drizzle-kit generate` (what `db:generate` runs) only ever GENERATES SQL —
`drizzle.config.ts` points its `out` at `supabase/migrations` with
`migrations.prefix: 'supabase'`, matching the filename shape the Supabase CLI
expects. **Never** run `drizzle-kit migrate`/`drizzle-kit push`, or the
programmatic `drizzle-orm/postgres-js/migrator`, against the real project:
that migrator keeps its own history table
(`drizzle.__drizzle_migrations`), independent of the Supabase CLI's own
(`supabase_migrations` schema) — running both against the same database
means each believes it owns migration history and neither sees the other,
which is exactly what broke for people who tried it in production (see
`docs/supabase/03-datos-migracion.md` §2 for the sourced writeup). This
package's `db:generate` is the only drizzle-kit command that's safe to run
against the real project, because it never opens a connection to it.

---

## Connecting: which Postgres URL

`DATABASE_URL` is a Postgres connection string, not a SQLite file path.
Three valid shapes (`docs/supabase/03-datos-migracion.md` §5, `.env.example`):

| Mode | Port | When |
| --- | --- | --- |
| Supavisor **session mode** | 5432, `*.pooler.supabase.com` | **Recommended for this app** — one long-lived Node server holding a persistent connection (or small pool), same pattern as the memoized `better-sqlite3` handle this used to be. Supports prepared statements, which `client.ts` leaves on (`postgres-js`'s default). |
| Supavisor **transaction mode** | 6543 | Serverless/edge, many short-lived connections — not this app's shape. Needs `postgres(url, { prepare: false })` if ever used; `client.ts` does not set this today. |
| Direct connection | 5432, `db.<project>.supabase.co` | Lowest latency, but needs IPv6 egress from the host. |

---

## Not built (deliberate, not forgotten)

Carried over from before the migration, unaffected by it:

- **Public sharing of `/reporte/$id`.** Every analysis read is owner-scoped;
  there is no `getAnalysis(id)` that skips the owner check. Logged-out
  sharing needs a `shareToken` column and a second, token-scoped read — a
  product decision, not an oversight.

New, a direct consequence of this migration:

- **Roles / who may invite.** With `invite` gone, "who may create an account"
  is now whatever Supabase Auth's own admin flow decides
  (`inviteUserByEmail`, or the Dashboard) — this package has no opinion on it
  any more.
- **A local `:memory:`-equivalent for tests.** There is no in-process
  Postgres. `rate-limit.test.ts` needs `TEST_DATABASE_URL` (or `DATABASE_URL`)
  pointed at a real, disposable Postgres — `supabase start`'s stack, or a bare
  `postgres:17` container — and skips itself when neither is reachable. This
  is a real new CI requirement (Docker + a cached Postgres image), not
  cosmetic — see `docs/supabase/03-datos-migracion.md` §4.
