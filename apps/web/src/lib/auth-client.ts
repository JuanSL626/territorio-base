/**
 * Auth actions for components. Safe to import from the browser.
 *
 * These are the TanStack Start server functions from `~/lib/session`,
 * re-exported under the names a form expects. Calling one from a component
 * is an RPC to the server, which talks to Supabase Auth and sets the
 * httpOnly cookie on the response — the credential never touches JavaScript.
 *
 * No `useSession()` here, deliberately: the signed-in user comes from
 * **route context**, resolved server-side in `beforeLoad` by
 * `~/lib/auth-server` — the only source correct before first paint. A client
 * hook would re-fetch what SSR already knows and flash `null` on the way.
 * Read the user with `Route.useRouteContext()`, and after
 * `signIn`/`signOut`/`setPassword` call `router.invalidate()` to re-run the
 * guards — but only AFTER `clearSessionCache`, see `~/lib/auth-server`.
 *
 * ```tsx
 * const result = await signIn({ data: { email, password } });
 * if (result.ok) {
 *   await router.invalidate();
 *   await navigate({ to: safeRedirectPath(search.redirect) });
 * } else {
 *   setError(AUTH_ERROR_MESSAGES[result.code ?? 'servicio']);
 * }
 * ```
 *
 * No self-serve sign-up: there is no `signUp` and no `/registro` any more.
 * The only way in is `adminInviteUser` (gated on already being signed in —
 * see `session.ts`), which emails a link to `routes/auth/confirm.ts`. That
 * route establishes the session; `setPassword` (below), called from
 * `routes/auth/set-password.tsx`, gives that session a password.
 */
export {
  adminInviteUser,
  AUTH_ERROR_MESSAGES,
  setPassword,
  signIn,
  signOut,
  type AuthErrorCode,
  type SessionUser,
} from './session';
