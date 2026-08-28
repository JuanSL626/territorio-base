/**
 * Auth actions for components. Safe to import from the browser.
 *
 * These are the TanStack Start server functions from `~/lib/session`, re-exported
 * under the names a form expects. Calling one from a component is an RPC to the
 * server, which talks to Better Auth and sets the httpOnly cookie on the
 * response — the credential never touches JavaScript, which is the point.
 *
 * There is no `useSession()` here, deliberately.
 *
 * The signed-in user comes from **route context**, resolved server-side in
 * `beforeLoad` by `~/lib/auth-server`. That is the only source that is correct
 * before first paint. A client hook would re-fetch what SSR already knows and
 * would flash `null` on the way. Read the user with `Route.useRouteContext()`,
 * and after `signIn`/`signOut` call `router.invalidate()` to re-run the guards.
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
 * Sign-up needs an invite code.
 *
 * Registration is closed. `signUp` requires `inviteCode`; without a valid,
 * unused, unexpired code the server refuses and returns
 * `code: 'invitacion-invalida'` or `'invitacion-usada'`. Codes may be typed with
 * dashes and in lowercase — the server normalizes before lookup, and folds the
 * Crockford confusables (`I`→`1`, `O`→`0`, `L`→`1`, `U`→`V`), so a code read
 * aloud over the phone still works.
 */
export {
  AUTH_ERROR_MESSAGES,
  signIn,
  signOut,
  signUp,
  type AuthErrorCode,
  type SessionUser,
  type SignInInput,
  type SignUpInput,
} from './session';
