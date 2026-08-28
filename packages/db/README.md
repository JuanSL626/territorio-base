# @territorio/db

Drizzle + SQLite + Better Auth. Owns the schema, the migrations, the database
client, and the whole authentication policy.

**Server only.** Every export reaches `node:fs`, `node:crypto` or
better-sqlite3. Import it from server functions, route guards and scripts —
never from a component.

---

## Getting started

```bash
cp .env.example .env                                   # from the repo root
# set BETTER_AUTH_SECRET (openssl rand -base64 32), ADMIN_EMAIL, ADMIN_PASSWORD

pnpm --filter @territorio/db db:migrate                # create/upgrade the file
pnpm --filter @territorio/db db:seed -- --name "Tu Nombre"
```

Then invite people:

```bash
pnpm --filter @territorio/db db:create-invite -- --email ana@ejemplo.do --days 7
# → Código de invitación: 10ZE-0FRW-16M0
```

| script | what it does |
| --- | --- |
| `db:generate` | drizzle-kit: diff the schema, write a new migration into `drizzle/` |
| `db:migrate` | apply the checked-in migrations (programmatic migrator, idempotent) |
| `db:seed` | create the first administrator |
| `db:create-invite` | mint / list / revoke invite codes |

`db:migrate` and `db:create-invite` read only `DATABASE_URL` — applying schema
changes or minting a code must not require the auth signing key.

---

## Sign-up is closed

There is no open registration and no back door. `POST /sign-up/email` succeeds
only when the body carries an `inviteCode` that is:

- **known** — present in the `invite` table,
- **unused** — `used_at IS NULL`,
- **unexpired** — `expires_at` in the future, or null,
- **for you** — if the invite was pinned to an address, only that address
  redeems it.

Two layers enforce it (`src/auth.ts`):

1. `hooks.before` on `/sign-up/email` — read-only validation, so a bad code is
   rejected with a precise Spanish message *before* a password is hashed.
2. `databaseHooks.user.create.before` — the atomic claim, and the real gate. It
   is **fail-closed**: any user-creating endpoint not on the `USER_CREATING_PATHS`
   allow-list is refused outright, so adding a social provider or the admin
   plugin later cannot quietly open registration. You have to come here and say
   so.

The single-use guarantee is one conditional UPDATE, never a read-then-write:

```sql
UPDATE invite SET used_at = ? WHERE code = ? AND used_at IS NULL AND ...
```

SQLite serializes writers, so of two concurrent sign-ups exactly one gets a row
back. This matters because the Drizzle adapter's `transaction` option is
deliberately **off** — with better-sqlite3 it commits an empty transaction and
runs the real work outside it, silently. See the header of `src/auth.ts`.

Even `db:seed` goes through this path: it mints an invite for `ADMIN_EMAIL` and
redeems it. A bootstrap shortcut that writes a user row directly would also be
the path a future bug takes.

Codes are Crockford base32 (`ABCD-EFGH-JKMN`) — no `I`, `L`, `O` or `U`, and the
lookalikes a person might type are folded back, so a code read over the phone
works. Dashes and lowercase are fine everywhere.

---

## Protecting a route

Route guards live in `apps/web/src/lib/auth-server.ts`. The rule they exist to
enforce: **the session is resolved before the first byte of HTML.** `beforeLoad`
runs on the server during SSR, so a thrown `redirect` becomes a real HTTP
redirect — no signed-in shell painting and then snapping to a login form. A
`useEffect` guard cannot do that.

Protect a whole subtree with one layout route:

```ts
// apps/web/src/routes/_app.tsx
import { createFileRoute } from '@tanstack/react-router';

import { requireUser } from '~/lib/auth-server';

export const Route = createFileRoute('/_app')({
  beforeLoad: async ({ location }) => ({ user: await requireUser(location) }),
  component: AppShell,
});
```

Every child route now has `user` in context:

```ts
const { user } = Route.useRouteContext();
```

The other two guards:

```ts
// on /login and /registro — a signed-in user has no business there
beforeLoad: async ({ search }) => { await redirectIfSignedIn(search.redirect); }

// on a route that renders differently when signed in, but renders either way
beforeLoad: async () => ({ user: await optionalUser() }),
```

`requireUser` puts the attempted URL in `?redirect=`, so `/login` can send the
user back to the map with its `aoi`, `theme` and `layers` search params intact.
Feed that value through **`safeRedirectPath`** before navigating — it is
attacker-controlled, and anything that is not a plain absolute path (a full URL,
`//evil.example`, `/\evil.example`) is discarded rather than sanitized.

`/login` must therefore declare `redirect` in its search schema:

```ts
validateSearch: z.object({ redirect: z.string().optional() }),
```

---

## What `apps/web` imports

| module | for | runs where |
| --- | --- | --- |
| `~/lib/auth-server` | `requireUser`, `redirectIfSignedIn`, `optionalUser`, `safeRedirectPath` | route files (`beforeLoad`) |
| `~/lib/auth-client` | `signIn`, `signUp`, `signOut`, `AUTH_ERROR_MESSAGES` | components |
| `~/lib/db` | `getDb`, the `analysis` helpers | server functions only |
| `~/lib/auth` | the raw Better Auth instance | only if the HTTP surface gets mounted |

Auth actions are TanStack Start **server functions** (`~/lib/session`), not HTTP
calls to `/api/auth/*`. The credential never touches client JavaScript and the
cookie is set on the server response. `@territorio/db` fills that seam with
`webAuthBoundary`, which `~/lib/session` resolves by dynamic import and structural
type guard — and which fails closed (no session, redirect to `/login`) if it is
ever missing.

There is no `useSession()` hook on purpose. The signed-in user comes from route
context, resolved server-side; a client hook would re-fetch what SSR already
knows and flash `null` on the way. After `signIn`/`signOut`, call
`router.invalidate()` to re-run the guards.

Sign-in/sign-up errors arrive as a closed set of codes with Spanish copy in
`AUTH_ERROR_MESSAGES`: `credenciales`, `invitacion-invalida`, `invitacion-usada`,
`email-en-uso`, `password-debil`, `demasiados-intentos`, `servicio`. The mapping
from Better Auth's machine-readable codes happens in `src/web-boundary.ts` —
never against message text, which is translated and will be reworded.
`demasiados-intentos` carries a `retryAfterSeconds` alongside the code (see
`src/rate-limit.ts`).

---

## Schema notes

Two of these will cost you an afternoon if you change them without reading:

- **Export names are load-bearing.** The Drizzle adapter looks models up as
  `schema[modelName]`, so the table must be exported as `user`, not `users`.
  Property names are load-bearing too — the adapter resolves fields as
  `schemaModel[fieldName]` using Better Auth's camelCase names (`emailVerified`,
  `createdAt`). SQL column names are free, and are snake_case.
- **`account.issuer` is required** in Better Auth 1.7. It is easy to miss when
  copying an older schema, and its absence breaks sign-in at account lookup, not
  at startup.

`PRAGMA foreign_keys = ON` is set per connection in `src/client.ts`. SQLite
ignores foreign keys without it, which would make `analysis.user_id` decorative.

`rate_limit` backs `src/rate-limit.ts`, the actual login/sign-up rate limiter —
**not** Better Auth's own `rateLimit` option, which this app deliberately does
not configure (it only takes effect through `auth.handler()`, and nothing here
dispatches a Request through it; see the header of `src/auth.ts`). `key` is
unique, so every attempt is a single atomic `INSERT ... ON CONFLICT DO UPDATE`
— no read-then-write gap. Always on, in every environment; a brute-force
control that only ran in production couldn't have been verified outside it.

`analysis.result_json` is typed loosely (`Record<string, unknown>`). Once
`packages/api-client` / `packages/geo` publish the analysis contract, narrow it
with `.$type<AnalysisResult>()` — one edit, no migration.

### Changing the schema

```bash
# edit src/schema.ts
pnpm --filter @territorio/db db:generate     # writes drizzle/NNNN_*.sql
pnpm --filter @territorio/db db:migrate
git add packages/db/drizzle                  # migrations are checked in
```

---

## Not built (deliberate, not forgotten)

- **Public sharing of `/reporte/$id`.** Every analysis read is owner-scoped;
  there is no `getAnalysis(id)` that skips the owner check, because an id-only
  accessor is how a report route ends up serving someone else's AOI to whoever
  guesses a uuid. Logged-out sharing needs a `shareToken` column and a second,
  token-scoped read — a product decision, not an oversight.
- **Password reset / email verification.** No mail transport is configured.
  `sendResetPassword` is unset, so the endpoints exist but send nothing.
- **Roles.** Every user is equal. Invites are minted from the CLI, so "who may
  invite" is currently "who has shell access".
