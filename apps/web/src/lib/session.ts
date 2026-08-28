/**
 * Auth server functions — the ENTIRE surface that talks to Supabase Auth.
 *
 * Everything here is a `createServerFn`: TanStack Start strips the handler
 * body from the client bundle, so a credential or the `service_role` key
 * never ships to the browser. Components import the client-safe re-export in
 * `~/lib/auth-client`; route guards import `~/lib/auth-server`. Neither of
 * those files reimplements anything — they only wrap what's here.
 *
 * `fetchSession` is the ONLY place that decides "who is this" and it does so
 * with `getUser()`, never `getSession()`. `getSession()` reads the access
 * token out of the cookie and trusts it as-is — a token revoked server-side
 * (global sign-out, a banned user, a rotated `service_role`) still reads as
 * "signed in" until it expires on its own. `getUser()` performs a network
 * call to the Supabase Auth server, so a revoked session shows up as `null`
 * immediately. That round-trip is the entire reason `~/lib/auth-server`
 * caches the result per tab (`staleTime: 'static'`) instead of calling this
 * on every navigation — see that file's header for the full argument.
 */
import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import { consumeRateLimit, getDb } from '@territorio/db';

import { getSupabaseAdminClient } from './supabase/admin';
import { getSupabaseServerClient } from './supabase/server';

import type { User } from '@supabase/supabase-js';

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthErrorCode =
  | 'credenciales'
  | 'invitacion-invalida'
  | 'email-en-uso'
  | 'password-debil'
  | 'demasiados-intentos'
  | 'no-autorizado'
  | 'servicio';

/** Copy en español de cada código de error, en un solo lugar. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  credenciales: 'Email o contraseña incorrectos.',
  'invitacion-invalida': 'El link de invitación no es válido o ya venció.',
  'email-en-uso': 'Ya hay una cuenta con ese email.',
  'password-debil': 'La contraseña tiene que tener al menos 8 caracteres.',
  'demasiados-intentos': 'Demasiados intentos. Probá de nuevo en unos minutos.',
  'no-autorizado': 'Necesitás iniciar sesión para hacer eso.',
  servicio: 'No se pudo contactar el servicio de cuentas. Probá de nuevo en un momento.',
};

type AuthActionResult = { ok: boolean; code?: AuthErrorCode; retryAfterSeconds?: number };

/**
 * `user.user_metadata` is `{ [key: string]: any }` on the SDK's own types —
 * this is the one narrowing point so `any` never leaks past this function.
 */
function toSessionUser(user: User): SessionUser {
  const name: unknown = user.user_metadata.name;
  return {
    id: user.id,
    // Password sign-in always has an email; `User.email` is only optional
    // because the SDK also models phone-only accounts, which this app never
    // creates.
    email: user.email ?? '',
    name: typeof name === 'string' && name.trim() !== '' ? name : null,
  };
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** Rate limit for `/login`: 5 attempts per 60s, keyed by normalized email — see `packages/db/src/rate-limit.ts`. */
const SIGN_IN_RATE_LIMIT = { windowSeconds: 60, max: 5 };

/** Lee la sesión vía `getUser()`. Nunca lanza: sin sesión o error de red → null. */
export const fetchSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    try {
      const supabase = getSupabaseServerClient();
      const { data, error } = await supabase.auth.getUser();
      if (error) return null;
      return toSessionUser(data.user);
    } catch {
      return null;
    }
  },
);

const signInSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
});

export const signIn = createServerFn({ method: 'POST' })
  .validator(signInSchema)
  .handler(async ({ data }): Promise<AuthActionResult> => {
    const email = normalizeEmail(data.email);

    // Supabase's own `/token` limit is per-IP and generic (see
    // `docs/supabase/02-auth-invitaciones.md` §6) — it does not stop credential
    // stuffing against one account from rotating IPs. This check is what does,
    // and it runs BEFORE Supabase ever sees the attempt.
    const limited = await consumeRateLimit(getDb(), {
      bucket: 'sign-in',
      identifier: email,
      rule: SIGN_IN_RATE_LIMIT,
    });
    if (!limited.ok) {
      return { ok: false, code: 'demasiados-intentos', retryAfterSeconds: limited.retryAfterSeconds };
    }

    try {
      const supabase = getSupabaseServerClient();
      const { error } = await supabase.auth.signInWithPassword({ email, password: data.password });
      if (error) {
        return { ok: false, code: error.code === 'invalid_credentials' ? 'credenciales' : 'servicio' };
      }
      return { ok: true };
    } catch {
      return { ok: false, code: 'servicio' };
    }
  });

export const signOut = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: boolean }> => {
    try {
      const supabase = getSupabaseServerClient();
      await supabase.auth.signOut();
    } catch {
      // Sign-out never fails visibly: whatever state Supabase is in, the
      // client clears its own cached session right after this call.
    }
    return { ok: true };
  },
);

const setPasswordSchema = z.object({
  password: z.string().min(8).max(256),
});

/**
 * Finish the invite flow: the visitor already has a valid session from
 * `routes/auth/confirm.ts`'s `verifyOtp` — this just gives that account a
 * password so future sign-ins don't need a fresh email link.
 */
export const setPassword = createServerFn({ method: 'POST' })
  .validator(setPasswordSchema)
  .handler(async ({ data }): Promise<AuthActionResult> => {
    try {
      const supabase = getSupabaseServerClient();
      const { data: current } = await supabase.auth.getUser();
      if (current.user === null) return { ok: false, code: 'no-autorizado' };

      const { error } = await supabase.auth.updateUser({ password: data.password });
      if (error) {
        return { ok: false, code: error.code === 'weak_password' ? 'password-debil' : 'servicio' };
      }
      return { ok: true };
    } catch {
      return { ok: false, code: 'servicio' };
    }
  });

const inviteSchema = z.object({
  email: z.string().trim().min(1).max(320),
  name: z.string().trim().max(120).optional(),
});

/**
 * Invite someone by email — `supabase.auth.admin.inviteUserByEmail()`, the
 * `service_role` Admin API. Server-only twice over: it's a `createServerFn`
 * AND it reaches into `~/lib/supabase/admin`, which throws if
 * `SUPABASE_SERVICE_ROLE_KEY` ever ended up in a browser bundle by mistake.
 *
 * Gate: the caller has to be signed in. That's the whole gate — this repo has
 * no roles/permissions table yet (`packages/db/README.md`: "Roles / who may
 * invite ... this package has no opinion on it any more"). Any signed-in user
 * can invite another today; tighten this the day a roles table exists.
 *
 * `email_exists` is the one Supabase error worth a specific message —
 * everything else (rate-limited, malformed, transient) collapses to
 * `servicio` rather than inventing codes for cases this app can't yet act on
 * differently.
 */
export const adminInviteUser = createServerFn({ method: 'POST' })
  .validator(inviteSchema)
  .handler(async ({ data }): Promise<AuthActionResult> => {
    const supabase = getSupabaseServerClient();
    const { data: current } = await supabase.auth.getUser();
    if (current.user === null) return { ok: false, code: 'no-autorizado' };

    try {
      const admin = getSupabaseAdminClient();
      const { error } = await admin.auth.admin.inviteUserByEmail(normalizeEmail(data.email), {
        data: data.name !== undefined && data.name !== '' ? { name: data.name } : undefined,
      });
      if (error) {
        return { ok: false, code: error.code === 'email_exists' ? 'email-en-uso' : 'servicio' };
      }
      return { ok: true };
    } catch {
      return { ok: false, code: 'servicio' };
    }
  });
