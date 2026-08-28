/**
 * `webAuthBoundary` — the seam `apps/web/src/lib/session.ts` resolves at runtime.
 *
 * That module declares an `AuthBoundary` contract and looks this export up with
 * a dynamic `import()` plus structural type guards, so the web app type-checks
 * and builds whether or not this file exists, and **fails closed** if it doesn't
 * (no session, redirect to /login). This is the implementation that turns it on.
 *
 * The web side drives auth through TanStack Start server functions rather than
 * through Better Auth's HTTP handler, so this boundary returns `Set-Cookie`
 * header *strings* and lets the caller apply them. That is why it uses
 * `asResponse: true` everywhere and why the instance here carries no
 * `tanstackStartCookies()` plugin — the caller owns the response.
 *
 * Error mapping: the web layer switches on a small closed set of Spanish-facing codes. Mapping
 * happens here, against Better Auth's machine-readable `body.code` and the
 * `INVITE_*` codes thrown by the invite gate — never against message text,
 * which is translated and will be reworded.
 *
 * With `asResponse: true`, Better Auth never *throws* one of its own
 * `APIError`s to this caller — better-call converts them into a `Response`
 * with the matching status, which is why every branch below reads
 * `response.ok` and the response body's `code` rather than relying on
 * `catch`. `catch` only ever sees a genuinely unexpected failure.
 *
 * Rate limiting: `/sign-in/email` and `/sign-up/email` are brute-forceable —
 * password guessing and invite-code / spam sign-up respectively — and
 * Better Auth's own `rateLimit` option cannot enforce that here (see the
 * header of `auth.ts`). `consumeRateLimit` is the real check, run before
 * either call below.
 */
import { APIError } from 'better-auth/api';

import { getAuth } from './auth.ts';
import { getDb } from './client.ts';
import { INVITE_ERROR_CODES, normalizeEmail, releaseOrphanedClaim } from './invites.ts';
import { consumeRateLimit, type RateLimitRule } from './rate-limit.ts';

/** Mirrors `AuthErrorCode` in `apps/web/src/lib/session.ts`. */
export type WebAuthErrorCode =
  | 'credenciales'
  | 'invitacion-invalida'
  | 'invitacion-usada'
  | 'email-en-uso'
  | 'password-debil'
  | 'demasiados-intentos'
  | 'servicio';

export type WebSessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export type WebAuthOutcome =
  | { ok: true; setCookie: string[] }
  | { ok: false; code: WebAuthErrorCode; retryAfterSeconds?: number };

export type WebSignInInput = { email: string; password: string };
export type WebSignUpInput = {
  name: string;
  email: string;
  password: string;
  inviteCode: string;
};

export type WebAuthBoundary = {
  getSession: (headers: Headers) => Promise<WebSessionUser | null>;
  signIn: (input: WebSignInInput, headers: Headers) => Promise<WebAuthOutcome>;
  signUp: (input: WebSignUpInput, headers: Headers) => Promise<WebAuthOutcome>;
  signOut: (headers: Headers) => Promise<WebAuthOutcome>;
};

/** The `code` off a thrown `APIError` — the early-validation path that throws
 * even under `asResponse: true` (see the module header). */
function codeFromThrown(error: unknown): string | null {
  if (!(error instanceof APIError)) return null;
  const body: unknown = error.body;
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

/** The `code` off a `!response.ok` Response body — the normal failure path
 * under `asResponse: true`. */
async function codeFromResponse(response: Response): Promise<string | null> {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return null;
    const code = (body as Record<string, unknown>).code;
    return typeof code === 'string' ? code : null;
  } catch {
    return null;
  }
}

/** The insert-time failure that surfaces the invite-claim race (see
 * `releaseOrphanedClaim` and the `auth.ts` header) — never a normal invite,
 * password, or duplicate-email rejection. */
const FAILED_TO_CREATE_USER_CODE = 'FAILED_TO_CREATE_USER';

const INVITE_USED_CODE = INVITE_ERROR_CODES.used;
const INVITE_CODES = new Set(Object.values(INVITE_ERROR_CODES));

function mapSignUpError(code: string | null): WebAuthErrorCode {
  if (code === null) return 'servicio';
  if (code === INVITE_USED_CODE) return 'invitacion-usada';
  if (INVITE_CODES.has(code)) return 'invitacion-invalida';
  if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return 'email-en-uso';
  }
  if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return 'password-debil';
  return 'servicio';
}

function mapSignInError(code: string | null): WebAuthErrorCode {
  if (code === 'INVALID_EMAIL_OR_PASSWORD' || code === 'INVALID_EMAIL') return 'credenciales';
  if (code === null) return 'servicio';
  return 'credenciales';
}

/**
 * Every `Set-Cookie` the response carries.
 *
 * `getSetCookie()` and not `get('set-cookie')`: a sign-in sets more than one
 * cookie, and `get` folds them into a single comma-joined string that browsers
 * then parse wrong.
 */
function setCookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

/**
 * Same values the dead `rateLimit.customRules` config declared (see
 * `auth.ts`) — `/forget-password` is left out because nothing in this app
 * calls it yet (no mail transport is configured; see the package README).
 */
const SIGN_IN_RATE_LIMIT: RateLimitRule = { windowSeconds: 60, max: 5 };
const SIGN_UP_RATE_LIMIT: RateLimitRule = { windowSeconds: 60, max: 5 };

export const webAuthBoundary: WebAuthBoundary = {
  async getSession(headers) {
    const result = await getAuth().api.getSession({ headers });
    if (result === null) return null;
    return {
      id: result.user.id,
      email: result.user.email,
      name: result.user.name,
    };
  },

  async signIn(input, headers) {
    const identifier = normalizeEmail(input.email) ?? '';
    const limit = await consumeRateLimit(getDb(), {
      bucket: 'sign-in',
      identifier,
      rule: SIGN_IN_RATE_LIMIT,
    });
    if (!limit.ok) {
      return { ok: false, code: 'demasiados-intentos', retryAfterSeconds: limit.retryAfterSeconds };
    }

    try {
      const response = await getAuth().api.signInEmail({
        body: { email: input.email, password: input.password },
        headers,
        asResponse: true,
      });
      if (!response.ok) return { ok: false, code: mapSignInError(await codeFromResponse(response)) };
      return { ok: true, setCookie: setCookies(response) };
    } catch (error) {
      return { ok: false, code: mapSignInError(codeFromThrown(error)) };
    }
  },

  async signUp(input, headers) {
    const identifier = normalizeEmail(input.email) ?? '';
    const limit = await consumeRateLimit(getDb(), {
      bucket: 'sign-up',
      identifier,
      rule: SIGN_UP_RATE_LIMIT,
    });
    if (!limit.ok) {
      return { ok: false, code: 'demasiados-intentos', retryAfterSeconds: limit.retryAfterSeconds };
    }

    try {
      // A named `const`, never an inline literal: `inviteCode` is an extra body
      // field that Better Auth accepts at runtime but leaves out of its
      // generated types, and TypeScript's excess-property check only fires on
      // fresh literals. See `signUpWithInvite` in `auth.ts` for the full story.
      const body = {
        name: input.name,
        email: input.email,
        password: input.password,
        inviteCode: input.inviteCode,
      };
      const response = await getAuth().api.signUpEmail({ body, headers, asResponse: true });
      if (!response.ok) {
        const code = await codeFromResponse(response);
        if (code === FAILED_TO_CREATE_USER_CODE) {
          // See `releaseOrphanedClaim` and the `auth.ts` header: the insert
          // lost the `user_email_unique` race after this request's own
          // invite claim already went through. Free the code again instead
          // of leaving it burned with no account behind it.
          await releaseOrphanedClaim(getDb(), input.inviteCode);
          return { ok: false, code: 'servicio' };
        }
        return { ok: false, code: mapSignUpError(code) };
      }
      return { ok: true, setCookie: setCookies(response) };
    } catch (error) {
      return { ok: false, code: mapSignUpError(codeFromThrown(error)) };
    }
  },

  async signOut(headers) {
    try {
      const response = await getAuth().api.signOut({ headers, asResponse: true });
      return { ok: true, setCookie: setCookies(response) };
    } catch {
      // Signing out must never fail loudly: the user wants to be logged out and
      // the cookie clear is already best-effort on the caller's side.
      return { ok: true, setCookie: [] };
    }
  },
};
