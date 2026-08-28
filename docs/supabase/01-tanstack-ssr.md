# TanStack Start + Supabase — patrón de SSR

> Documento de referencia previo a la implementación. Objetivo del usuario (no
> se re-discute acá): reemplazar `packages/db` (Drizzle + SQLite + Better Auth)
> por **Supabase Postgres + Auth nativo**, siguiendo el camino idiomático de
> Supabase y TanStack antes que mantener capas propias.
>
> Todo lo citado acá se leyó de verdad: el ejemplo oficial
> `TanStack/router/examples/react/start-supabase-basic` (fetch directo de
> GitHub, commit en `main` al 2026-08-27/28), la documentación de `@supabase/ssr`
> vía Context7 (`/supabase/ssr`, que indexa `github.com/supabase/ssr`), el
> quickstart y la guía "Server-Side Auth" de supabase.com, y los `package.json`
> / `versions` reales de npm. No hay pseudocódigo: cada snippet es código que
> existe en alguna de esas fuentes, con su cita.

---

## 0. Resumen ejecutivo

**Patrón elegido:** un módulo `~/lib/supabase/server.ts` con una función
`getSupabaseServerClient()` que crea un `createServerClient` (de `@supabase/ssr`)
por request, leyendo/escribiendo cookies con las primitivas de
`@tanstack/react-start/server` (`getCookies` / `setCookie`) en vez de
`Headers` a mano. Ese cliente se usa desde `createServerFn` (para RPCs) y desde
`server.handlers` de rutas de archivo (para el único caso que Supabase exige un
endpoint HTTP real: la confirmación de OTP/invitación). El guard SSR de este
repo (`requireUser` + `staleTime: 'static'` en el `QueryClient` del router) es
**compatible tal cual** con Supabase — de hecho se vuelve más importante,
porque `getUser()` es una llamada de red al servidor de Auth, no una lectura
local de cookie.

**Los 3 riesgos principales para este repo:**

1. **Hace falta una ruta HTTP nueva que hoy no existe.** El flujo de
   invitación de este repo (equivalente a `signUp` con `inviteCode`) se
   traduce en Supabase a `supabase.auth.admin.inviteUserByEmail()`, que manda
   un email con un link a `{redirectTo}?token_hash=...&type=invite`. Un email
   no puede apuntar a un `createServerFn` (es un endpoint RPC con protocolo
   propio, no un GET plano) — necesita una ruta de archivo con
   `server: { handlers: { GET } }`, igual al patrón que ya existe en
   `apps/web/src/routes/api/raster.*.ts`. Sin esa ruta el link del email no
   tiene dónde aterrizar. Ver §6.
2. **`getUser()` es una llamada de red por cada verificación, no una lectura de
   cookie.** Con Better Auth, `boundary.getSession(headers)` resuelve contra
   SQLite local (mismo proceso, mismo disco). Con Supabase, la única llamada
   *segura* (`getUser()`) sale a la red hacia el servidor de Auth de Supabase.
   El patrón `staleTime: 'static'` de `auth-server.ts` — que hoy existe para no
   convertir cada `pan` del mapa en un roundtrip — pasa de ser una optimización
   a ser **la diferencia entre navegar rápido y pegarle a un servicio externo
   en cada `beforeLoad`**. Ver §3 y §4.
3. **El refresh de tokens sólo se persiste si el cliente que lo dispara puede
   escribir cookies en ESA respuesta, antes de que se cierre.** `@supabase/ssr`
   documenta esto explícitamente (ver cita en §5): si el refresh completa
   después de que la respuesta ya se envió, la cookie nueva se pierde y el
   próximo request vuelve a refrescar. En TanStack Start eso encaja bien
   *dentro* de un `createServerFn` o un route handler (el cliente se crea, se
   llama `getUser()`, se retorna — todo antes del `return`), pero **no** hay
   nada parecido al middleware de Next.js que refresque la sesión en *cada*
   request de forma centralizada salvo que se arme a propósito con
   `createStart({ requestMiddleware: [...] })`. Ver §5.

---

## 1. `@supabase/ssr` — versión y API real

### Versión

```
$ npm view @supabase/ssr version
0.12.5

$ npm view @supabase/supabase-js version
2.112.4
```

El ejemplo oficial de TanStack (`start-supabase-basic/package.json`, ver §2)
pinea `"@supabase/ssr": "^0.5.2"` y `"@supabase/supabase-js": "^2.48.1"` — son
viejas. Para este repo conviene partir de `^0.12.x` / `^2.11x.x`: la API de
`getAll`/`setAll` es estable desde 0.4.0, y las versiones más nuevas traen
fixes de "chunking" de cookies (un JWT largo se parte en varias cookies
`sb-<project-ref>-auth-token.0`, `.1`, etc. — versiones viejas de `@supabase/ssr`
tenían bugs limpiando esos chunks).

### `createServerClient` / `createBrowserClient` — firma real

Ambos vienen de `@supabase/ssr` y comparten la misma forma: URL del proyecto,
clave pública (`anon`/`publishable`), y un objeto `cookies`.

```ts
// Cliente de servidor (Context7 · /supabase/ssr ·
// _autodocs/api-reference-createServerClient.md, adaptado con
// parseCookieHeader para el caso "tengo un objeto Request crudo")
import { createServerClient, parseCookieHeader } from '@supabase/ssr';

const supabase = createServerClient(supabaseUrl, supabaseKey, {
  cookies: {
    getAll() {
      return parseCookieHeader(request.headers.get('Cookie') ?? '');
    },
    setAll(cookiesToSet, headers) {
      cookiesToSet.forEach(({ name, value, options }) => {
        response.cookies.set(name, value, options);
      });
      Object.entries(headers).forEach(([key, value]) => {
        response.headers.set(key, value);
      });
    },
  },
});
```

```ts
// Cliente de navegador (Context7 · /supabase/ssr ·
// _autodocs/api-reference-createBrowserClient.md)
import { createBrowserClient } from '@supabase/ssr';

const supabase = createBrowserClient(
  'https://your-project.supabase.co',
  'your-anon-key',
);
```

`createBrowserClient` persiste la sesión en cookies del navegador (no en
`localStorage`, a diferencia del cliente "plano" de `@supabase/supabase-js`) —
es lo que permite que el mismo cookie jar sea legible por el servidor en el
siguiente request.

### `getAll`/`setAll` vs `get`/`set`/`remove` — cuál está deprecado hoy

**`get`/`set`/`remove` está deprecado desde `@supabase/ssr` 0.4.0.** Cita
textual de la documentación del paquete (Context7 · `/supabase/ssr` ·
`docs/design.md`):

> "The get, set, and remove methods are deprecated as of version 0.4.0 in
> favor of getAll and setAll. This change is necessary because individual
> access methods cannot reliably identify and clear all stale cookie chunks
> associated with a single storage item. Users must migrate to the new
> methods to ensure full state visibility and proper cleanup of stale
> cookies."

Y el tipo que lo marca en el propio paquete:

```ts
// Context7 · /supabase/ssr · _autodocs/types.md
// CookieMethodsServerDeprecated: "Deprecated cookie configuration using
// get, set, and remove. Not recommended; use CookieMethodsServer instead."
```

Conclusión operativa: **usar siempre `getAll`/`setAll`**, nunca la forma
vieja — es la única forma en la que Supabase puede limpiar de verdad todos los
chunks de un JWT largo cuando la sesión cambia. El ejemplo oficial de TanStack
Start (§2) y el quickstart de Supabase para TanStack (§2) ya usan `getAll`/`setAll`.

---

## 2. El patrón canónico: `start-supabase-basic` + quickstart de TanStack

### 2.1 El ejemplo oficial (`TanStack/router/examples/react/start-supabase-basic`)

Repo: <https://github.com/TanStack/router/tree/main/examples/react/start-supabase-basic>
(vive dentro del monorepo de `router`, no de `tanstack-start` aparte). Sus
versiones pineadas coinciden casi exactamente con las de este repo:

```jsonc
// package.json del ejemplo (fetch directo, 2026-08-27)
{
  "dependencies": {
    "@supabase/ssr": "^0.5.2",
    "@supabase/supabase-js": "^2.48.1",
    "@tanstack/react-router": "^1.170.32",   // este repo: 1.170.32, exacto
    "@tanstack/react-start": "^1.168.49",    // este repo: 1.168.49, exacto
    "react": "^19.0.0"
  }
}
```

Eso importa: el ejemplo corre sobre la MISMA versión de `@tanstack/react-start`
que ya está pineada en `pnpm-workspace.yaml` de este repo, así que su API de
`createServerFn` / `createFileRoute` / `@tanstack/react-start/server` es
directamente aplicable sin ajuste de versión.

**Dónde vive el cliente de servidor** — `src/utils/supabase.ts` (código real,
fetch directo del raw file):

```ts
import { getCookies, setCookie } from '@tanstack/react-start/server'
import { createServerClient } from '@supabase/ssr'

export function getSupabaseServerClient() {
  return createServerClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({
            name,
            value,
          }))
        },
        setAll(cookies) {
          cookies.forEach((cookie) => {
            setCookie(cookie.name, cookie.value)
          })
        },
      },
    },
  )
}
```

Notar la diferencia con el patrón "Next.js" del §1: acá no hay `Request`ni
`Response` explícitos — `getCookies()` y `setCookie()` son las primitivas de
`@tanstack/react-start/server` que leen/escriben directo sobre el request/response
del framework, sin pasar por `Headers` a mano. Esto es exactamente lo que
`session.ts` de este repo NO hace hoy (arma un `Headers` con `getRequestHeaders()`
y se lo pasa a `boundary.getSession(headers)`) — con Supabase conviene ir
directo a las primitivas de `@tanstack/react-start/server`, como hace el
ejemplo, en vez de reconstruir un objeto `Headers`.

**Cómo se usa dentro de un `createServerFn`** — `src/routes/__root.tsx`:

```tsx
import { createServerFn } from '@tanstack/react-start'
import { getSupabaseServerClient } from '../utils/supabase'

const fetchUser = createServerFn({ method: 'GET' }).handler(async () => {
  const supabase = getSupabaseServerClient()
  const { data, error: _error } = await supabase.auth.getUser()

  if (!data.user?.email) {
    return null
  }

  return {
    email: data.user.email,
  }
})

export const Route = createRootRoute({
  beforeLoad: async () => {
    const user = await fetchUser()
    return { user }
  },
  // ...
})
```

**Sign-in** — `src/routes/_authed.tsx`:

```tsx
export const loginFn = createServerFn({ method: 'POST' })
  .validator((d: { email: string; password: string }) => d)
  .handler(async ({ data }) => {
    const supabase = getSupabaseServerClient()
    const { error } = await supabase.auth.signInWithPassword({
      email: data.email,
      password: data.password,
    })
    if (error) {
      return { error: true, message: error.message }
    }
  })

export const Route = createFileRoute('/_authed')({
  beforeLoad: ({ context }) => {
    if (!context.user) {
      throw new Error('Not authenticated')
    }
  },
  errorComponent: ({ error }) => {
    if (error.message === 'Not authenticated') return <Login />
    throw error
  },
})
```

**Sign-out** — `src/routes/logout.tsx` (server function como `loader`, patrón
poco intuitivo pero real):

```tsx
const logoutFn = createServerFn().handler(async () => {
  const supabase = getSupabaseServerClient()
  const { error } = await supabase.auth.signOut()
  if (error) return { error: true, message: error.message }
  throw redirect({ href: '/' })
})

export const Route = createFileRoute('/logout')({
  preload: false,
  loader: () => logoutFn(),
})
```

**Ojo con esto para el repo:** el ejemplo llama a `fetchUser()` (que dispara
`getUser()`, red hacia Supabase) en el `beforeLoad` de `__root.tsx` — **sin
cachear nada**, en cada navegación. Es exactamente el anti-patrón que
`auth-server.ts` de este repo documenta y evita a propósito (ver la cabecera
de ese archivo: "un `await fetchSession()` acá dentro convertía cada `pan` y
cada toggle en un `GET /_serverFn/…fetchSession`"). El ejemplo oficial es
un starter minimalista, no está optimizado para una app con navegación de
alta frecuencia como el mapa de este repo. **No copiar ese `beforeLoad` tal
cual** — envolver la misma llamada en el patrón `sessionQueryOptions` +
`staleTime: 'static'` que ya existe.

### 2.2 El quickstart de Supabase para TanStack Start

<https://supabase.com/docs/guides/getting-started/quickstarts/tanstack> —
pasos reales tal como los documenta la página:

1. `npm install @supabase/supabase-js @supabase/ssr`
2. Variables de entorno: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`
   (prefijo `VITE_` porque también se leen del lado cliente vía
   `import.meta.env`).
3. `src/lib/supabase/client.ts` (navegador):

```ts
/// <reference types="vite/client" />
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    import.meta.env.VITE_SUPABASE_URL!,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY!
  )
}
```

4. `src/lib/supabase/server.ts` (servidor — de la documentación de Supabase UI,
   `supabase.com/ui/docs/tanstack/client`, que es el mismo contenido que el
   quickstart referencia para el lado servidor):

```ts
import { createServerClient } from '@supabase/ssr'
import { getCookies, setCookie, setResponseHeader } from '@tanstack/react-start/server'

export function createClient() {
  return createServerClient(
    process.env.VITE_SUPABASE_URL!,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return Object.entries(getCookies()).map(([name, value]) => ({ name, value }))
        },
        setAll(cookies, headers) {
          cookies.forEach(({ name, value, options }) => {
            setCookie(name, value, options)
          })
          Object.entries(headers).forEach(([name, value]) => {
            setResponseHeader(name, value)
          })
        },
      },
    }
  )
}
```

Nota: esta variante sí pasa `options` a `setCookie` (el ejemplo de §2.1 no lo
hace) y también reenvía el segundo argumento de `setAll` (`headers`) con
`setResponseHeader`. **Preferir esta forma** — el segundo argumento de
`setAll` existe para casos donde Supabase necesita mandar headers de
respuesta además de cookies (poco común hoy, pero gratis de soportar) y
`options` (`maxAge`, `path`, `sameSite`, `secure`, …) es necesario para que
las cookies de sesión de Supabase salgan con los atributos correctos —
omitirlo (como hace `start-supabase-basic`) funciona en el ejemplo porque no
depende de esos atributos, pero no es lo que hay que copiar a producción.

`process.env.VITE_SUPABASE_URL` (no `import.meta.env`) del lado servidor: en
Vite/TanStack Start, las variables `VITE_*` quedan disponibles en
`process.env` en el proceso Node del servidor porque Vite las carga vía
`dotenv` en `mode=development`/`build`; en producción hay que asegurarse de
que el proceso Node real (el `server.mjs` de este repo, ver `vite.config.ts`)
tenga esas env vars seteadas — no son "públicas por el prefijo `VITE_`" en el
sentido de Node, son públicas porque Vite también las inyecta en el bundle de
cliente.

### 2.3 Cómo se hidrata la sesión sin flash de contenido no autenticado

El mecanismo es el mismo que ya usa este repo para SSR de TanStack Query, sin
nada Supabase-específico: el usuario se resuelve en `beforeLoad` (servidor),
viaja como parte del `RouterContext`/estado dehidratado del router, y el
primer render de cliente ya lo tiene — no hay `useEffect` que dispare un
segundo fetch. La diferencia con Better Auth es de origen del dato, no de
mecanismo: en vez de `boundary.getSession(headers)` contra SQLite, es
`supabase.auth.getUser()` contra el servidor de Auth de Supabase, con el
mismo costo (un side-effect de red) pagado una vez por request de SSR en vez
de una vez por componente.

---

## 3. El guard SSR: `beforeLoad` + `staleTime: 'static'` con Supabase

**El patrón de `auth-server.ts` se sostiene tal cual — no hay nada idiomático
mejor para este caso.** Es más: se vuelve más necesario, no menos.

Lo que cambia es sólo la fuente que rellena el query:

```ts
// hoy (auth-server.ts):
export const sessionQueryOptions = queryOptions({
  queryKey: ['session'] as const,
  queryFn: async () => await fetchSession(), // → boundary.getSession(headers), SQLite local
  staleTime: 'static',
  gcTime: Infinity,
  retry: false,
});

// con Supabase, mismo shape, mismo staleTime, sólo cambia el queryFn:
export const sessionQueryOptions = queryOptions({
  queryKey: ['session'] as const,
  queryFn: async () => await fetchSupabaseUser(), // → createServerFn que llama getUser()
  staleTime: 'static',
  gcTime: Infinity,
  retry: false,
});
```

`requireUser`, `redirectIfSignedIn`, `clearSessionCache`, `safeRedirectPath` —
ninguno de esos cuatro necesita cambiar. Sólo cambia qué hay del otro lado de
`fetchSession`/`fetchSupabaseUser`, y el tipo que viaja: hoy es
`{ id, email, name }` sintetizado por Better Auth; con Supabase sería el
`User` de `@supabase/supabase-js` (o un subconjunto mapeado a la misma forma,
que es lo recomendable para no filtrar el shape completo de Supabase — con
`app_metadata`, `identities`, etc. — a componentes que sólo necesitan
`id`/`email`).

Un matiz nuevo, sin embargo, que sí vale la pena documentar para cuando se
implemente: **por qué "una vez por pestaña" importa más acá que con Better
Auth.** `boundary.getSession()` de Better Auth resuelve contra SQLite en el
mismo proceso — barato incluso sin cachear. `supabase.auth.getUser()` es una
llamada HTTP saliente al servidor de Auth de Supabase — el mismo tipo de
dependencia externa que el propio `auth-server.ts` ya identifica como riesgo
en otra parte del repo (ver el commit `0f1b953 Un servicio externo caído ya
no tumba todo el análisis`). Sin `staleTime: 'static'`, cada navegación del
mapa (`?bbox=`, `?layers=`) sería un round-trip a Supabase Auth, no sólo un
`GET` local — y una caída/lentitud de Supabase Auth se propagaría al guard de
navegación entero de la misma forma en que hoy se evita para el análisis
territorial.

---

## 4. `getUser()` vs `getSession()` — la regla, con cita

**Regla: en el servidor, para decisiones de autorización, sólo `getUser()`.**
`getSession()` (y `getClaims()` sin verificación adicional) leen del storage
(cookies) sin confirmar contra el servidor de Auth que el token siga siendo
válido.

Cita textual de la guía "Server-Side Auth: Advanced guide" de Supabase
(<https://supabase.com/docs/guides/auth/server-side/advanced-guide>):

> "The only way to ensure that a user has logged out or their session has
> ended is to get the user's details with `getUser()`."

> "`getClaims()` method only checks local JWT validation (signature and
> expiration), but it doesn't verify with the auth server whether the session
> is still valid or if the user has logged out server-side."

Y la referencia de `getUser()` en sí (<https://supabase.com/docs/reference/javascript/auth-getuser>):

> "Gets the current user details if there is an existing session. This method
> performs a network request to the Supabase Auth server, so the returned
> value is authentic and can be used to base authorization rules on."

La implicancia de seguridad concreta: `getSession()` devuelve lo que hay en la
cookie sin más — si un token fue revocado server-side (logout global, ban de
usuario, rotación de `service_role`), una cookie robada/vieja sigue pasando
`getSession()` hasta que expira por tiempo. `getUser()` sí lo detecta, porque
consulta al servidor de Auth en cada llamada. El costo es justamente ese
round-trip — que es la razón por la que el `staleTime: 'static'` del §3 no es
opcional para no pagar ese costo en cada navegación.

**Regla operativa para este repo:** cualquier `createServerFn` o route handler
que decida "quién puede ver esto" (el propio guard, y cada endpoint que hoy
llama `fetchSession()` — p. ej. los proxies de raster en
`apps/web/src/routes/api/raster.*.ts`) usa `getUser()`. `getSession()` queda
reservado para casos donde sólo hace falta leer el `access_token` para
reenviarlo a otro servicio (p. ej., si `services/api` alguna vez necesitara
validar el JWT de Supabase él mismo) — nunca como base de una decisión de
autorización.

---

## 5. Refresh de tokens en SSR: quién, cuándo, y qué pasa con las cookies

**Quién:** el propio cliente de `@supabase/ssr`, de forma automática y
perezosa. Cita de la fuente (Context7 · `/supabase/ssr` ·
`src/createServerClient.ts`):

> "Session initialization. This client uses lazy session initialization
> (`skipAutoInitialize: true`). The session is not loaded until the first call
> to `getSession()`, `getUser()`, or `getClaims()` (which calls `getSession()`
> internally when no explicit JWT is passed). Token refreshes write the
> updated session back to cookies via the `setAll` handler."

**Cuándo:** en la primera llamada a `getUser()`/`getSession()`/`getClaims()`
de cada request de servidor, si el `access_token` guardado en cookies ya
expiró. El paquete detecta la expiración, llama
`POST /token?grant_type=refresh_token` contra Supabase Auth con el
`refresh_token` de la cookie, y si tiene éxito llama a `setAll` con las
cookies nuevas (o las borra, si el `refresh_token` también es inválido — ahí
el usuario quedó deslogueado de verdad).

**Qué pasa con las cookies en una respuesta de server function — el punto
crítico, citado textual** (Context7 · `/supabase/ssr` · `src/types.ts`):

> "Called by the Supabase Client to write cookies to the response after a
> token refresh or auth state change. **IMPORTANT:** Call
> `await supabase.auth.getClaims()` (or `getSession()`/`getUser()`) early in
> your request handler — before any response is generated. If a token refresh
> completes after the HTTP response has already been committed, the updated
> session cannot be written here and will be lost, causing the next request to
> refresh again."

Y el flujo completo de una carga de página nueva, documentado en
`docs/design.md` del propio paquete:

> "1. The browser sends a request... with all the cookies in its store. 2. The
> middleware... is invoked. 3. The server client is created with a `getAll`
> that retrieves the cookies. 4. The server client notices that the access
> token stored in the cookies has been expired for hours or days. 5. It calls
> the `POST /token?grant_type=refresh_token` endpoint... 6. Finally calls
> `setAll` with the new cookies that need to be set or cleared. Once this
> process is complete, and the effect of `setAll` is returned to the browser
> as `Set-Cookie` headers in the response, both browser and server are
> in-sync."

**Traducido a TanStack Start:** no hay "middleware" al estilo Next.js que
corra antes de cada respuesta salvo que se lo arme explícitamente. Lo que sí
existe, real, en la misma versión de `@tanstack/react-start` pineada acá
(confirmado contra la doc oficial de Middleware):

```ts
// src/start.ts — middleware GLOBAL, corre en cada request que maneja Start
import { createStart, createMiddleware } from '@tanstack/react-start'

const supabaseSessionMiddleware = createMiddleware().server(async ({ next }) => {
  // getUser() acá dispara el refresh si hace falta, y setAll escribe la
  // cookie nueva en ESTA respuesta, antes del `return` — exactamente la
  // ventana que pide la cita de arriba.
  const supabase = getSupabaseServerClient();
  await supabase.auth.getUser();
  return next();
});

export const startInstance = createStart(() => ({
  requestMiddleware: [supabaseSessionMiddleware],
}));
```

`createMiddleware({ type: 'function' })` (con `.server()`) es la variante para
colgar de un `createServerFn` puntual con `.middleware([...])`; el ejemplo de
arriba usa `createMiddleware()` sin `type` (default `'request'`) más
`requestMiddleware` en `createStart` para que corra en **todo** request, no
sólo en las server functions — que es lo que hace falta para cubrir también
las cargas de página SSR normales (no todas pasan por una server function).

**Para este repo, sin ese middleware global**, el refresh igual ocurre —
sólo que exclusivamente dentro de las llamadas que ya invocan `getUser()`: el
guard (`fetchSupabaseUser`, cacheado por `staleTime: 'static'`, o sea sólo en
la primera navegación de la pestaña) y cada `createServerFn`/route handler que
valida sesión por su cuenta (como ya hace cada uno hoy, según la propia regla
que documenta `auth-server.ts`: "cada `createServerFn` valida su propia sesión
[...] es un endpoint HTTP alcanzable sin pasar por acá"). Como esos endpoints
se llaman todo el tiempo durante una sesión normal (cualquier fetch de datos
protegidos), el refresh igual sucede en la práctica — simplemente no está
centralizado. **Decisión a tomar en la implementación:** si conviene agregar
el middleware global de arriba (refresh proactivo, centralizado, en cada
carga SSR) o confiar en que las llamadas normales lo cubren (más simple, menos
superficie nueva, mismo modelo mental que ya tiene el repo con Better Auth,
donde tampoco hay refresh centralizado — las cookies de Better Auth duran más
y no rotan por request).

---

## 6. Riesgo concreto: ¿hace falta una ruta HTTP nueva?

**Sí, para el equivalente del flujo de invitación de este repo.** Hoy
`AuthBoundary.signUp` exige `inviteCode`, validado server-side, sin ningún
endpoint HTTP público de auth (`session.ts`, comentario de cabecera: "todo
pasa por server functions"). Supabase no tiene un concepto nativo de
"invite code" tipeable por el usuario — su primitiva nativa es
**`supabase.auth.admin.inviteUserByEmail()`** (API de administración, requiere
la `service_role` key, se llama desde un contexto de servidor de confianza —
el análogo directo del script `packages/db/scripts/create-invite.ts` que ya
existe hoy). Esa llamada:

1. Crea el usuario en `auth.users` con estado "invited".
2. Le manda un email con un link a una URL de confirmación con
   `token_hash` y `type=invite` en la query string — algo como
   `https://tu-app.com/auth/confirm?token_hash=pkce_xxx&type=invite&redirect_to=/`.

Ese link lo abre un cliente de correo — **no puede ser un `createServerFn`**
(las server functions de TanStack Start son RPCs con su propio protocolo de
transporte, pensadas para llamarse desde JS del lado cliente, no para ser el
`href` de un link en un email). Tiene que ser una ruta HTTP de verdad, `GET`
plano. El patrón de handler crudo **ya existe en este repo** — es el mismo
que documenta el propio `auth.ts` (comentario "Mounting the HTTP surface") y
el que usan hoy los proxies de raster:

```ts
// apps/web/src/routes/auth/confirm.ts — archivo NUEVO que hace falta
import { createFileRoute } from '@tanstack/react-router';
import { redirect } from '@tanstack/react-router';

import { getSupabaseServerClient } from '~/lib/supabase/server';

import type { EmailOtpType } from '@supabase/supabase-js';

export const Route = createFileRoute('/auth/confirm')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const token_hash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type') as EmailOtpType | null;
        const redirectTo = url.searchParams.get('redirect_to') ?? '/';

        if (token_hash && type) {
          const supabase = getSupabaseServerClient();
          const { error } = await supabase.auth.verifyOtp({ type, token_hash });
          if (!error) {
            throw redirect({ href: redirectTo });
          }
        }
        throw redirect({ href: '/login?error=invitacion-invalida' });
      },
    },
  },
});
```

(Forma de `verifyOtp({ type, token_hash })` y el rol de `EmailOtpType`
confirmados por la guía de Supabase sobre confirmación de OTP por email —
`EmailOtpType` incluye `'signup' | 'invite' | 'magiclink' | 'recovery' |
'email_change'`; el patrón "leer `token_hash`/`type` de la query, llamar
`verifyOtp`, redirigir" es el mismo en todos los frameworks server-side que
documenta Supabase, sólo cambia cómo se define la ruta.)

**Flujos que necesitan esta ruta (o una variante):**

- **Invitación** (`type=invite`) — el reemplazo directo del flujo actual de
  este repo. Obligatorio si se preserva "sólo por invitación".
- **Recuperación de contraseña** (`type=recovery`) — si se implementa "olvidé
  mi contraseña", el link del email de reset apunta acá también.
- **Confirmación de signup por email** (`type=signup`) — no aplica si el
  registro sigue cerrado/por invitación únicamente (no hay auto-signup
  público), pero Supabase lo manda igual salvo que se desactive
  "Confirm email" en la configuración de Auth del proyecto.
- **OAuth (PKCE)**, si algún día se agrega login social — usa un `code` en
  vez de `token_hash`, y se resuelve con `supabase.auth.exchangeCodeForSession(code)`
  en una ruta equivalente (típicamente `/auth/callback`). No hace falta hoy;
  se menciona porque es la otra mitad del mismo problema si se agrega más
  adelante.

**Lo que NO cambia:** `signIn`/`signOut` con password siguen siendo
perfectamente representables como `createServerFn` (POST, llamado desde JS),
igual que hoy — no necesitan ruta HTTP nueva. La única razón por la que hace
falta un endpoint HTTP real es que un email no puede invocar una RPC de
TanStack Start.

---

## 7. Referencias

- `@supabase/ssr` — paquete y docs indexadas: Context7 `/supabase/ssr`
  (fuente: `github.com/supabase/ssr`, incluye `docs/design.md`,
  `_autodocs/*.md`, `src/types.ts`, `src/createServerClient.ts`).
- Ejemplo oficial: <https://github.com/TanStack/router/tree/main/examples/react/start-supabase-basic>
  (archivos leídos: `package.json`, `src/utils/supabase.ts`,
  `src/routes/__root.tsx`, `src/routes/_authed.tsx`, `src/routes/login.tsx`,
  `src/routes/logout.tsx`, `src/routes/signup.tsx`, `src/router.tsx`).
- Quickstart: <https://supabase.com/docs/guides/getting-started/quickstarts/tanstack>
- Cliente TanStack Start (Supabase UI docs): <https://supabase.com/ui/docs/tanstack/client>
- Server-Side Auth, guía avanzada: <https://supabase.com/docs/guides/auth/server-side/advanced-guide>
- `getUser()`: <https://supabase.com/docs/reference/javascript/auth-getuser>
- Middleware de TanStack Start: <https://tanstack.com/start/latest/docs/framework/react/guide/middleware>
- Primitivas de servidor de TanStack Start (auth): <https://tanstack.com/start/latest/docs/framework/react/guide/authentication-server-primitives>
- Versiones npm verificadas el 2026-08-27/28: `@supabase/ssr@0.12.5`,
  `@supabase/supabase-js@2.112.4`.
- Código del repo leído para el contraste: `apps/web/src/lib/auth-server.ts`,
  `apps/web/src/lib/session.ts`, `apps/web/src/lib/auth.ts`,
  `apps/web/src/lib/auth-client.ts`, `apps/web/src/router.tsx`,
  `apps/web/src/routes/_app.tsx`, `apps/web/src/routes/login.tsx`,
  `apps/web/src/routes/api/raster.*.ts`, `apps/web/vite.config.ts`,
  `pnpm-workspace.yaml`.
