/**
 * SSR route guards.
 *
 * The rule this file exists to enforce: **the session is resolved before the
 * first byte of HTML is rendered.** `beforeLoad` runs on the server during SSR,
 * so a `redirect()` thrown here becomes a real HTTP redirect — the browser never
 * paints a signed-in shell that then snaps to a login form. A `useEffect` guard
 * cannot do that, and neither can a `useSession()` check inside a component.
 *
 * On client-side navigation the same `beforeLoad` runs in the browser and
 * `fetchSession()` becomes one RPC round trip. Same code, same decision, both
 * times.
 *
 * Session reading itself is `fetchSession` from `~/lib/session` — the single
 * server function for it. This module adds only the redirect policy on top, so
 * there is never a second way to ask "who is this".
 *
 * Safe to import from route files: the server work happens inside a
 * `createServerFn` handler, which TanStack Start strips from the client bundle.
 * Do **not** import `~/lib/auth` from a route file — import this.
 */
import { type AnyRedirect, redirect } from '@tanstack/react-router';

import { fetchSession, type SessionUser } from './session';

export type { SessionUser };

/**
 * Throw a router redirect.
 *
 * `redirect()` returns a `Response`, not an `Error` — that is how TanStack
 * Router signals navigation out of `beforeLoad`, and throwing it is the
 * documented pattern. `only-throw-error` cannot know that, so the waiver lives
 * here, once, instead of at every call site. Building the `redirect(...)` at the
 * call site keeps its `to`/`search` fully type-checked against the route tree.
 */
function throwRedirect(target: AnyRedirect): never {
  // eslint-disable-next-line @typescript-eslint/only-throw-error -- see above
  throw target;
}

/**
 * Guard for a protected route's `beforeLoad`. Redirects to `/login` when there
 * is no session, and returns the user otherwise — so whatever you spread it into
 * becomes route context for every child route.
 *
 * ```ts
 * export const Route = createFileRoute('/_app')({
 *   beforeLoad: async ({ location }) => ({ user: await requireUser(location) }),
 *   component: AppShell,
 * });
 * ```
 *
 * The attempted URL rides along as `?redirect=`, so `/login` can send the user
 * back to the map with its `aoi`, `theme` and `layers` search params intact
 * instead of dumping them on the home page.
 */
export async function requireUser(location: { href: string }): Promise<SessionUser> {
  const user = await fetchSession();
  if (user === null) {
    throwRedirect(redirect({ to: '/login', search: { redirect: location.href } }));
  }
  return user;
}

/**
 * Guard for `/login` and `/registro`: a signed-in user has no business on them.
 *
 * `redirectTo` is the route's validated `?redirect=` search param. It is passed
 * through `safeRedirectPath` first — see below.
 */
export async function redirectIfSignedIn(redirectTo?: string): Promise<void> {
  const user = await fetchSession();
  if (user !== null) {
    throwRedirect(redirect({ href: safeRedirectPath(redirectTo) }));
  }
}

/**
 * Read the session without requiring one. For routes that render differently
 * when signed in rather than refusing to render at all.
 */
export async function optionalUser(): Promise<SessionUser | null> {
  return await fetchSession();
}

/**
 * Reduce a `?redirect=` value to a same-origin path, or `/`.
 *
 * An open redirect is the classic bug in exactly this pattern: `?redirect=` is
 * attacker-controlled, so anything that is not a plain absolute path — a full
 * URL, a scheme-relative `//evil.example`, or the `/\` variant browsers
 * normalize to `//` — is discarded rather than sanitized. Discarding is safe to
 * get wrong; sanitizing is not.
 */
export function safeRedirectPath(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
