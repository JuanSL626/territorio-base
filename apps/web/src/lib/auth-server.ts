/**
 * SSR route guards.
 *
 * The rule this file exists to enforce: **the session is resolved before the
 * first byte of HTML is rendered.** `beforeLoad` runs on the server during SSR,
 * so a `redirect()` thrown here becomes a real HTTP redirect — the browser never
 * paints a signed-in shell that then snaps to a login form. A `useEffect` guard
 * cannot do that, and neither can a `useSession()` check inside a component.
 *
 * On client-side navigation the same `beforeLoad` runs in the browser — and
 * that is where the naive version of this file was expensive.
 *
 * Por qué el guard NO llama a `fetchSession()` directo:
 *
 * `beforeLoad` no corre "cuando cambia la ruta": corre en CADA navegación del
 * router, incluidas las que sólo tocan search params. En esta app el mapa
 * escribe search params todo el tiempo — `?bbox=` en cada `moveend`, `?layers=`
 * en cada checkbox — así que un `await fetchSession()` acá dentro convertía
 * cada `pan` y cada toggle en un `GET /_serverFn/…fetchSession`.
 *
 * No era sólo chattiness. `beforeLoad` que lanza = error de navegación = el
 * error boundary de la raíz reemplaza la app entera. Con el servidor caído,
 * mover el mapa borraba el AOI, el análisis y el mapa mismo con un «Failed to
 * fetch».
 *
 * La sesión se resuelve entonces UNA vez y se guarda en el `QueryClient` que ya
 * vive en el contexto del router (`~/router`): uno por request en el servidor
 * —nunca un singleton de módulo, o dos usuarios compartirían sesión durante el
 * SSR— y uno por pestaña en el cliente, hidratado desde el payload del SSR.
 * `queryClient.query()` devuelve el valor cacheado sin pedir nada, así que el
 * guard sigue corriendo en cada navegación pero cuesta cero round trips.
 *
 * El precio explícito: en el cliente la sesión no se revalida sola
 * (`staleTime: 'static'`). Es correcto porque este guard protege la NAVEGACIÓN,
 * no los datos — cada `createServerFn` valida su propia sesión, como dice
 * `routes/_app.tsx`. Lo que sí hay que hacer es TIRAR el cache cuando la sesión
 * cambia de verdad: `clearSessionCache` se llama en `signIn`, `signUp` y
 * `signOut` (login.tsx, register.tsx, _app/index.tsx). Sin eso, entrar después
 * de salir vería el `null` viejo y rebotaría a /login en loop.
 *
 * Session reading itself is `fetchSession` from `~/lib/session` — the single
 * server function for it. This module adds only the redirect policy on top, so
 * there is never a second way to ask "who is this".
 *
 * Safe to import from route files: the server work happens inside a
 * `createServerFn` handler, which TanStack Start strips from the client bundle.
 * Do **not** import `~/lib/auth` from a route file — import this.
 */
import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { type AnyRedirect, redirect } from '@tanstack/react-router';

import { fetchSession, type SessionUser } from './session';

export type { SessionUser };

/**
 * La sesión como query cacheada.
 *
 * `staleTime: 'static'` es el modo de react-query en el que una query NUNCA se
 * considera vencida: `queryClient.query()` devuelve lo cacheado sin tocar la
 * red, y ni `invalidateQueries` ni `refetchQueries` la despiertan. Se olvida
 * SÓLO con `clearSessionCache`, que es exactamente la semántica que quiere un
 * guard de navegación.
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
 * (`signIn`, `signUp`, `signOut`) y antes de `router.invalidate()`, que es lo
 * que vuelve a correr los guards.
 */
export function clearSessionCache(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: sessionQueryOptions.queryKey });
}

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
 *   beforeLoad: async ({ context, location }) => ({
 *     user: await requireUser(context.queryClient, location),
 *   }),
 *   component: AppShell,
 * });
 * ```
 *
 * El `queryClient` sale del contexto del router (ver la cabecera del módulo):
 * es lo que hace que el guard corra en cada navegación sin pedir la sesión de
 * nuevo.
 *
 * The attempted URL rides along as `?redirect=`, so `/login` can send the user
 * back to the map with its `aoi`, `theme` and `layers` search params intact
 * instead of dumping them on the home page.
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
 * Guard for `/login` and `/registro`: a signed-in user has no business on them.
 *
 * `redirectTo` is the route's validated `?redirect=` search param. It is passed
 * through `safeRedirectPath` first — see below.
 *
 * Éste SÍ lee del servidor cada vez, a propósito: `/login` y `/registro` no
 * escriben search params en bucle, se visitan una vez, y la lectura fresca es
 * la que decide si la persona ya tiene sesión. Cachearla acá sólo agregaría un
 * estado más que sincronizar con `clearSessionCache`.
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
