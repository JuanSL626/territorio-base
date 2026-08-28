/**
 * SSR route guards. `beforeLoad` runs server-side during SSR, so a
 * `redirect()` thrown here is a real HTTP redirect — the browser never paints
 * a signed-in shell that then snaps to a login form, which a `useEffect`
 * guard can't do.
 *
 * Por qué el guard NO llama a `fetchSession()` directo:
 *
 * `beforeLoad` corre en CADA navegación del router, incluidas las que sólo
 * tocan search params — el mapa escribe `?bbox=` en cada `moveend` y
 * `?layers=` en cada checkbox, así que un `await fetchSession()` acá adentro
 * convertía cada pan y cada toggle en un `GET /_serverFn/…fetchSession`.
 *
 * No era sólo chattiness: `beforeLoad` que lanza = error de navegación = el
 * error boundary de la raíz reemplaza la app entera. Con el servidor caído,
 * mover el mapa borraba el AOI, el análisis y el mapa mismo con un «Failed to
 * fetch».
 *
 * La sesión se resuelve entonces UNA vez y se guarda en el `QueryClient` del
 * contexto del router (`~/router`): uno por request en el servidor —nunca un
 * singleton de módulo, o dos usuarios compartirían sesión durante el SSR— y
 * uno por pestaña en el cliente, hidratado desde el payload del SSR.
 * `queryClient.query()` devuelve el valor cacheado sin red, así que el guard
 * sigue corriendo en cada navegación pero cuesta cero round trips.
 *
 * El precio: en el cliente la sesión no se revalida sola (`staleTime:
 * 'static'`) — correcto porque este guard protege la NAVEGACIÓN, no los
 * datos (cada `createServerFn` valida su propia sesión). Lo que sí hay que
 * hacer es TIRAR el cache cuando la sesión cambia de verdad:
 * `clearSessionCache` se llama en `signIn` y `signOut` (login.tsx,
 * _app/index.tsx) y en `setPassword` (`routes/auth/set-password.tsx`). Sin
 * eso, entrar después de salir vería el `null` viejo y rebotaría a /login en
 * loop.
 *
 * Session reading itself is `fetchSession` de `~/lib/session` — la única
 * server function para eso; este módulo sólo agrega la política de redirect.
 *
 * Seguro de importar desde route files: el trabajo de servidor corre dentro
 * de un handler `createServerFn`, que TanStack Start saca del bundle cliente.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { type AnyRedirect, redirect } from '@tanstack/react-router';

import { fetchSession, type SessionUser } from './session';

export type { SessionUser };

/**
 * La sesión como query cacheada. `staleTime: 'static'` hace que la query
 * NUNCA se considere vencida — ni `invalidateQueries` ni `refetchQueries` la
 * despiertan, sólo `clearSessionCache` la olvida, que es la semántica que
 * quiere un guard de navegación.
 *
 * `retry: false` porque un guard que reintenta retrasa la navegación; si la
 * primera lectura falla no queda nada cacheado, así que la siguiente
 * navegación la vuelve a pedir.
 */
export const sessionQueryOptions = queryOptions({
  queryKey: ['session'] as const,
  queryFn: async () => await fetchSession(),
  staleTime: 'static',
  gcTime: Infinity,
  retry: false,
});

/**
 * Olvidar la sesión cacheada. Se llama después de CUALQUIER mutación de auth
 * (`signIn`, `signOut`, `setPassword`) y antes de `router.invalidate()`, que
 * es lo que vuelve a correr los guards.
 */
export function clearSessionCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
}

/**
 * `redirect()` returns a `Response`, not an `Error` — the documented way
 * TanStack Router signals navigation out of `beforeLoad`. `only-throw-error`
 * can't know that, so the waiver lives here once instead of at every call
 * site; building `redirect(...)` at the call site keeps `to`/`search` fully
 * type-checked against the route tree.
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
 *   beforeLoad: async ({ context, location }) => ({
 *     user: await requireUser(context.queryClient, location),
 *   }),
 *   component: AppShell,
 * });
 * ```
 *
 * El `queryClient` sale del contexto del router (cabecera del módulo).
 *
 * The attempted URL rides along as `?redirect=`, so `/login` can send the
 * user back to the map with its `aoi`, `theme` and `layers` search params
 * intact instead of dumping them on the home page.
 */
export async function requireUser(
  queryClient: QueryClient,
  location: { href: string },
): Promise<SessionUser> {
  const user = await queryClient.query(sessionQueryOptions);
  if (user === null) {
    throwRedirect(redirect({ to: '/login', search: { redirect: location.href } }));
  }
  return user;
}

/**
 * Guard for `/login`: a signed-in user has no business on it. (No public
 * `/registro` any more — registration moved to `inviteUserByEmail` + a
 * confirmation link, not a form a stranger can fill in; see `session.ts`'s
 * header and `routes/auth/set-password.tsx`.)
 *
 * `redirectTo` is the route's validated `?redirect=` search param, passed
 * through `safeRedirectPath` first.
 *
 * Éste SÍ lee del servidor cada vez, a propósito: `/login` no escribe search
 * params en bucle, se visita una vez, y la lectura fresca es la que decide si
 * la persona ya tiene sesión.
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
 * Open redirect is the classic bug in this pattern: `?redirect=` is
 * attacker-controlled, so anything not a plain absolute path — a full URL, a
 * scheme-relative `//evil.example`, or the `/\` variant browsers normalize to
 * `//` — is discarded rather than sanitized. Discarding is safe to get wrong;
 * sanitizing is not.
 */
export function safeRedirectPath(value: string | undefined | null): string {
  if (value === undefined || value === null || value === '') return '/';
  if (!value.startsWith('/')) return '/';
  if (value.startsWith('//') || value.startsWith('/\\')) return '/';
  return value;
}
