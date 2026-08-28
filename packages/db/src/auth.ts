/**
 * Better Auth configuration — invite-only, email + password, httpOnly cookie.
 *
 * This module builds the *options*. It does not export a singleton, because the
 * web app has to add `tanstackStartCookies()` (which imports TanStack Start
 * server internals and must not be dragged into a CLI script), while `seed` and
 * `create-invite` need an instance with no framework plugin at all.
 *
 *   apps/web/src/lib/auth.ts →  betterAuth({ ...buildAuthOptions(), plugins: [tanstackStartCookies()] })
 *   scripts/seed.ts          →  createAuth()
 *
 * ── How sign-up is closed ────────────────────────────────────────────────────
 *
 * `emailAndPassword.disableSignUp` is left `false` on purpose: setting it would
 * 400 the endpoint outright and there would be no way to redeem an invite. The
 * gate is two layers instead:
 *
 *   1. `hooks.before` on `/sign-up/email` — read-only validation, so a bad code
 *      is rejected with a precise Spanish message before a password is hashed.
 *   2. `databaseHooks.user.create.before` — the atomic claim. Fail-closed: any
 *      user-creating endpoint that is not on the allow-list is refused, so
 *      adding a social provider or the admin plugin later cannot quietly open
 *      registration.
 *
 * ── Why the adapter's `transaction` option is off ────────────────────────────
 *
 * `drizzleAdapter({ transaction: true })` calls `db.transaction(cb)` with an
 * *async* callback. drizzle's better-sqlite3 driver is synchronous: it issues
 * BEGIN, calls the callback, gets a pending promise back, and issues COMMIT
 * immediately — committing an empty transaction and running the real work
 * outside it, with no error. A transaction that silently isn't one is worse than
 * none, so it stays `false` and `claimInvite` carries its own atomicity in a
 * single conditional UPDATE.
 */
import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError, createAuthMiddleware } from 'better-auth/api';

import { getDb } from './client.ts';
import { getEnv } from './env.ts';
import { attachInviteUserByCode, checkInvite, claimInvite, INVITE_ERROR_CODES } from './invites.ts';
import { type TerritorioDb, schema } from './schema.ts';

/**
 * The endpoints allowed to create a `user` row.
 *
 * Everything else is refused. Adding an entry here is a conscious decision to
 * open a new registration path.
 */
const USER_CREATING_PATHS = new Set(['/sign-up/email']);

/** The sign-up body field the login/register UI must send. */
export const INVITE_CODE_FIELD = 'inviteCode';

/** Pull `inviteCode` out of an untyped request body. */
function readInviteCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>)[INVITE_CODE_FIELD];
  return typeof value === 'string' ? value : null;
}

/** Pull the sign-up email out of an untyped request body. */
function readEmail(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) return null;
  const value = (body as Record<string, unknown>).email;
  return typeof value === 'string' ? value : null;
}

export type BuildAuthOptionsInput = {
  /** Override the connection. Only tests and scripts should pass this. */
  db?: TerritorioDb;
};

/**
 * The shared Better Auth options.
 *
 * The return type is inferred (not widened to `BetterAuthOptions`) so a consumer
 * spreading it keeps full inference; `satisfies` still checks it.
 */
export function buildAuthOptions(input: BuildAuthOptionsInput = {}) {
  const env = getEnv();
  const db = input.db ?? getDb();
  const isProduction = env.NODE_ENV === 'production';

  // `Secure` es una propiedad del TRANSPORTE, no del modo de build, así que se
  // decide por el esquema de BETTER_AUTH_URL y no por NODE_ENV.
  //
  // Atarlo a NODE_ENV rompe el stack de Docker Compose tal como lo documenta el
  // README: ahí NODE_ENV=production (correcto, es un build de producción) pero
  // la URL es http://localhost:3000. Con `Secure` sobre http plano el navegador
  // descarta la cookie, así que el login devuelve 200, no setea sesión y rebota
  // a /login para siempre — sin un solo error visible. Verificado en el
  // contenedor con `docker compose up` antes de este cambio.
  const servesOverHttps = env.BETTER_AUTH_URL.startsWith('https://');

  return {
    appName: 'territorio-base',
    baseURL: env.BETTER_AUTH_URL,
    basePath: '/api/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: [env.BETTER_AUTH_URL],

    database: drizzleAdapter(db, {
      provider: 'sqlite',
      schema,
      // See the module header. Do not flip this to `true` on better-sqlite3.
      transaction: false,
    }),

    emailAndPassword: {
      enabled: true,
      // Kept false so the endpoint exists; the invite gate below is what closes
      // registration. See the module header.
      disableSignUp: false,
      autoSignIn: true,
      requireEmailVerification: false,
      // 8, not a stricter number, because `apps/web/src/lib/session.ts` ships
      // the copy "La contraseña tiene que tener al menos 8 caracteres." A server
      // that rejects at 12 while the form promises 8 is a form that lies.
      // Raise both together or neither.
      minPasswordLength: 8,
      maxPasswordLength: 128,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 7,
      updateAge: 60 * 60 * 24,
      // Off: a cached session cookie would keep a revoked session alive for its
      // cache window. This app has one small user base and a cheap local DB —
      // the read is not worth the staleness.
      cookieCache: { enabled: false },
    },

    advanced: {
      // Agrega `Secure` y el prefijo `__Secure-`. Tiene que quedar apagado
      // sobre http plano o el navegador descarta la cookie y el login
      // "funciona" pero nunca persiste. Ver el comentario en `servesOverHttps`.
      useSecureCookies: servesOverHttps,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
      },
    },

    // In-memory counters are per-process and vanish on restart. Login and
    // sign-up are the endpoints worth brute-forcing here, so the counter is
    // stored in the `rate_limit` table.
    rateLimit: {
      enabled: isProduction,
      storage: 'database',
      modelName: 'rateLimit',
      customRules: {
        '/sign-in/email': { window: 60, max: 5 },
        '/sign-up/email': { window: 60, max: 5 },
        '/forget-password': { window: 60, max: 3 },
      },
    },

    hooks: {
      /**
       * Layer 1 — advisory. Rejects an obviously bad invite early, with a
       * message the register form can render verbatim.
       */
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return;
        const result = await checkInvite(db, {
          code: readInviteCode(ctx.body),
          email: readEmail(ctx.body),
        });
        if (!result.ok) {
          throw new APIError('FORBIDDEN', {
            code: INVITE_ERROR_CODES[result.reason],
            message: result.message,
          });
        }
      }),
    },

    databaseHooks: {
      user: {
        create: {
          /** Layer 2 — the atomic claim. This is the real gate. */
          before: async (newUser, context) => {
            // `context === null` means a direct server-side adapter call, not an
            // HTTP request. Nothing in this codebase does that; scripts go
            // through the API so they are gated like everyone else.
            if (context === null) return;

            if (!USER_CREATING_PATHS.has(context.path)) {
              throw new APIError('FORBIDDEN', {
                code: 'INVITE_REQUIRED',
                message: 'El registro solo está permitido con una invitación.',
              });
            }

            const result = await claimInvite(db, {
              code: readInviteCode(context.body),
              email: newUser.email,
            });

            if (!result.ok) {
              throw new APIError('FORBIDDEN', {
                code: INVITE_ERROR_CODES[result.reason],
                message: result.message,
              });
            }
          },

          /** Record who redeemed the invite, now that the user row exists. */
          after: async (newUser, context) => {
            if (context === null) return;
            const code = readInviteCode(context.body);
            if (code === null) return;
            await attachInviteUserByCode(db, code, newUser.id);
          },
        },
      },
    },
  } satisfies BetterAuthOptions;
}

/**
 * Build a Better Auth instance. Prefer `getAuth()` in app code.
 *
 * Takes an explicit `db` so tests and scripts can point at their own file.
 */
export function createAuth(input: BuildAuthOptionsInput = {}) {
  return betterAuth(buildAuthOptions(input));
}

export type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

/**
 * The process-wide Better Auth instance, built on first use.
 *
 * One instance, deliberately: `webAuthBoundary` (server functions) and any
 * future `/api/auth/*` HTTP handler must share the same rate-limit counters,
 * the same connection and the same secret. Two instances would look identical
 * in tests and diverge under load.
 */
export function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

export type SignUpWithInviteParams = {
  name: string;
  email: string;
  password: string;
  /** The code from `db:create-invite`. Dashes and lowercase are fine. */
  inviteCode: string;
};

/**
 * Server-side sign-up that carries the invite code.
 *
 * Better Auth's runtime body schema is
 * `z.object({ … }).and(z.record(z.string(), z.any()))`, so `inviteCode` really
 * does reach `ctx.body` — which is where the gate reads it — and
 * `parseUserInput` drops it again before the INSERT, so it never lands on the
 * `user` table. Exactly the behavior we want.
 *
 * The *generated* types, however, list only the six documented fields. The way
 * past that is not a cast: TypeScript's excess-property check fires on fresh
 * object literals only, so passing a **named value** (`params`) type-checks
 * without any assertion. That is the whole trick, and it is the same one the
 * web client uses — build the body as a `const`, then pass it.
 *
 * The alternative, declaring `inviteCode` as a `user.additionalFields` entry,
 * would also type-check but would add a column storing a bearer credential on
 * every user row, forever.
 */
export async function signUpWithInvite(
  auth: Auth,
  params: SignUpWithInviteParams,
  options: { headers?: Headers } = {},
) {
  return await auth.api.signUpEmail({
    body: params,
    headers: options.headers,
  });
}
