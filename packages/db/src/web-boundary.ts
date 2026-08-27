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
 * ── Error mapping ────────────────────────────────────────────────────────────
 *
 * The web layer switches on a small closed set of Spanish-facing codes. Mapping
 * happens here, against Better Auth's machine-readable `body.code` and the
 * `INVITE_*` codes thrown by the invite gate — never against message text,
 * which is translated and will be reworded.
 */
import { APIError } from 'better-auth/api';

import { getAuth } from './auth.ts';
import { INVITE_ERROR_CODES } from './invites.ts';

/** Mirrors `AuthErrorCode` in `apps/web/src/lib/session.ts`. */
export type WebAuthErrorCode =
  | 'credenciales'
  | 'invitacion-invalida'
  | 'invitacion-usada'
  | 'email-en-uso'
  | 'password-debil'
  | 'servicio';

export type WebSessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export type WebAuthOutcome =
  { ok: true; setCookie: string[] } | { ok: false; code: WebAuthErrorCode };

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

function readErrorCode(error: unknown): string | null {
  if (!(error instanceof APIError)) return null;
  const body: unknown = error.body;
  if (typeof body !== 'object' || body === null) return null;
  const code = (body as Record<string, unknown>).code;
  return typeof code === 'string' ? code : null;
}

const INVITE_USED_CODE = INVITE_ERROR_CODES.used;
const INVITE_CODES = new Set(Object.values(INVITE_ERROR_CODES));

function mapSignUpError(error: unknown): WebAuthErrorCode {
  const code = readErrorCode(error);
  if (code === null) return 'servicio';
  if (code === INVITE_USED_CODE) return 'invitacion-usada';
  if (INVITE_CODES.has(code)) return 'invitacion-invalida';
  if (code === 'USER_ALREADY_EXISTS' || code === 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL') {
    return 'email-en-uso';
  }
  if (code === 'PASSWORD_TOO_SHORT' || code === 'PASSWORD_TOO_LONG') return 'password-debil';
  if (code === 'INVALID_EMAIL') return 'servicio';
  return 'servicio';
}

function mapSignInError(error: unknown): WebAuthErrorCode {
  const code = readErrorCode(error);
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
    try {
      const response = await getAuth().api.signInEmail({
        body: { email: input.email, password: input.password },
        headers,
        asResponse: true,
      });
      if (!response.ok) return { ok: false, code: 'credenciales' };
      return { ok: true, setCookie: setCookies(response) };
    } catch (error) {
      return { ok: false, code: mapSignInError(error) };
    }
  },

  async signUp(input, headers) {
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
      if (!response.ok) return { ok: false, code: 'invitacion-invalida' };
      return { ok: true, setCookie: setCookies(response) };
    } catch (error) {
      return { ok: false, code: mapSignUpError(error) };
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
