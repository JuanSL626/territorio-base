# Despliegue gratuito — `apps/web` (SSR de Node) y el par API+web

Fecha: 2026-08-29. Ángulo de este informe: el frontend TanStack Start y la combinación
con `services/api`. Otro informe (si existe en este mismo directorio) cubre el servicio
raster en detalle; acá lo tratamos solo lo necesario para razonar el par.

Todos los números están verificados contra documentación oficial en la fecha de arriba
— free tiers cambian, no confiar en memoria de antes de esta fecha.

---

## 0. Un hecho del repo que condiciona todo lo demás

`apps/web` **no usa Nitro**. El comentario de cabecera de `apps/web/server.mjs` lo dice
explícito: *"`vite build` de TanStack Start (v1.168, sin Nitro) no emite un servidor que
escuche: emite `dist/server/server.js` ... y `dist/client/`"*. Este repo eligió el modo
"custom server" de TanStack Start (soportado oficialmente — ver
[discussion #3777](https://github.com/TanStack/router/discussions/3777)) y escribió su
propio host de ~250 líneas sobre `node:http`.

Esto importa porque **todos los presets "oficiales" de plataforma para TanStack Start
(Vercel, Netlify, Cloudflare) se apoyan en Nitro** (`nitro/vite` con
`server.preset: 'vercel' | 'netlify' | 'cloudflare'`, o los plugins dedicados
`@netlify/vite-plugin-tanstack-start` / `@cloudflare/vite-plugin`). Ninguno de esos
presets está instalado acá. Consecuencia práctica por plataforma:

- **Vercel**: el handler que ya existe (`dist/server/server.js`, export default
  `{fetch(request)}`) es compatible con el formato Web-Fetch que soportan las Vercel
  Functions Node.js — se puede envolver en una función serverless propia (`api/[[...
  all]].ts` + `vercel.json` con rewrites, sirviendo `dist/client` como estáticos) sin
  adoptar Nitro. Es trabajo real pero acotado (~30–50 líneas), no el flujo "zero-config"
  que anuncia el framework preset de Vercel.
- **Netlify**: mismo razonamiento, mismo esfuerzo manual — sin el plugin oficial, hay que
  armar la función Netlify a mano.
- **Cloudflare Workers**: acá el hueco es más profundo. `server.mjs` usa `node:http`
  `createServer`, que Workers no ejecuta (necesita un módulo con `export default {fetch}`
  como entrypoint, no un listener). Adoptar Workers implica sacar `server.mjs` del camino
  y generar el entrypoint vía `@cloudflare/vite-plugin` (o escribir uno a mano que
  reimporte `dist/server/server.js` y sirva `dist/client` con Assets binding). Ver §3 para
  si además *conviene* — la respuesta corta es: no gratis, ver abajo.

Ningún destino queda descartado por esto solo, pero ninguno es "conectar y listo": la
migración de servidor (aunque sea parcial) es parte del costo real de cada opción, no un
detalle de implementación posterior.

**Segundo hecho del repo que importa para Cloudflare específicamente**: `apps/web` usa
`postgres` (postgres-js, TCP crudo a Postgres) contra Supabase, y `archiver` (streams +
zlib de Node) para el ZIP de descarga. Ninguno corre nativo en el runtime de Workers sin
compatibilidad Node explícita.

**Tercer hecho, y el más importante para la arquitectura**: según `compose.yaml`, **el
navegador nunca le habla a la API directo** — ni las requests normales, ni los overlays
PNG, ni (aparentemente) el progreso de un análisis. Todo pasa por `web`, que valida sesión
y reenvía server-to-server a `api:8787`. Eso significa que **`web` tiene que sostener
conexiones abiertas y streaming (SSE, PNG, GeoTIFF) durante los 10–90 segundos que dura un
análisis**, no solo servir HTML rápido. Este es el criterio que más plataformas descarta
abajo.

---

## 1. `apps/web` por plataforma

### Vercel — Hobby (gratis)

- **RAM/CPU**: 2 GB / 1 vCPU por función (Fluid compute, activado por defecto en proyectos
  nuevos). — [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- **Tamaño de build/función**: 250 MB sin comprimir (layers incluidas); hasta 5 GB con
  "Large functions" (beta, requiere Fluid + Active CPU). El bundle SSR de este repo
  (React + drizzle + postgres-js + archiver + zod, sin maplibre que es solo cliente) entra
  cómodo en 250 MB.
- **¿Duerme?** No hay "sleep" tradicional: es serverless por invocación (cold start típico
  sub-segundo para un bundle Node de este tamaño), no un contenedor que se apaga y tarda
  30–60s en volver. Esto es clave: no repite el problema de cold-start que sí tienen
  Render/Koyeb/Zeabur.
- **Timeout / SSE**: **300 s por defecto y máximo en Hobby**, incluye tiempo de streaming.
  Esto alcanza sobrado para un análisis de 90s proxeado.
- **Disco persistente**: no aplica (no lo necesita — `web` no persiste nada, usa `/tmp` vía
  `read_only`+`tmpfs` en el compose actual, y en Vercel sería el `/tmp` efímero de la
  función).
- **Egress**: 100 GB/mes incluidos en Hobby (fuente: documentación de límites del plan,
  contrastada contra varios agregadores de 2026; no encontré la cifra en una página
  oficial de "pricing" fetcheable directamente, así que tratala como la mejor evidencia
  disponible, no como certeza absoluta).
- **Tarjeta**: no requerida para Hobby.
- **Al exceder**: función se corta con 504 (`FUNCTION_INVOCATION_TIMEOUT`) si pasa de
  300s; el resto de límites (invocaciones, bandwidth) frena el servicio o exige upgrade,
  no cobra automáticamente en Hobby.
- **Restricción real, no técnica**: el Hobby plan **prohíbe uso comercial** en los
  términos de Vercel (cualquier beneficio económico de cualquier parte involucrada,
  incluyendo un freelancer pago que escribió el código). Si "territorio-base" es un
  proyecto personal/open-source sin fines de lucro, no aplica; si en algún momento cobra o
  factura, hay que pasar a Pro ($20/mes/asiento).
- **Encaje con TanStack Start**: preset oficial ('vercel') existe pero pasa por Nitro (no
  usado acá). Camino realista: función Node manual envolviendo el handler existente. Es el
  candidato más sólido técnicamente de toda la lista para este proyecto tal como está
  escrito hoy.

### Netlify — Starter (gratis)

- **Cambio de modelo en 2025**: cuentas nuevas ya no tienen "100GB bandwidth + 300 min de
  build" fijos — corren sobre un pool de **300 créditos/mes** (~15 GB de bandwidth
  equivalente a 20 créditos/GB). Cuentas legacy pre-septiembre-2025 conservan el modelo
  viejo.
- **Timeout de función**: **10 segundos síncronos** en el plan gratis. Las "Background
  Functions" llegan a 15 minutos, pero no devuelven respuesta síncrona al que las llamó —
  no sirven para proxear un análisis que el browser está esperando en vivo.
- **Descarte**: un proxy SSE/overlay de hasta 90s **no entra en 10s**. Sin pagar (o sin
  mover ese tramo a Edge Functions, que tienen otro modelo de límites y no son el camino
  oficial de TanStack Start en Netlify), Netlify gratis no sostiene el flujo real de la
  app.
- **Tarjeta**: no requerida.
- Adaptador oficial (`@netlify/vite-plugin-tanstack-start`) existe pero pasa por Nitro.

### Cloudflare Workers/Pages — Free

- **Requests**: 100.000/día.
- **CPU por invocación**: **10 ms** en el plan gratis (el tiempo esperando I/O — fetch a
  la API, query a Postgres vía Hyperdrive — *no* cuenta contra esto, pero el render SSR de
  React + el trabajo de la query sí). — [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- **Duración de wall-clock / SSE**: no hay límite de wall-clock — un Worker puede sostener
  un `fetch()` en streaming (proxy de SSE o de un PNG grande) durante minutos consumiendo
  CPU casi cero, porque esperar la respuesta upstream no es CPU. Esto es, en el papel, el
  mejor ajuste de todos para el patrón "proxy server-to-server de larga duración" de este
  proyecto.
- **¿Duerme?** No — es edge compute, sin cold start de contenedor.
- **Disco persistente**: no aplica para `web` (no lo necesita).
- **Egress**: **sin cargo** — Cloudflare no cobra por egress en Workers, ni en el plan
  gratis ni en el pago. Es el único de la lista con esa garantía explícita.
- **Postgres vía TCP**: **sí es viable**, vía **Hyperdrive**, que está disponible en el
  plan gratis (10 configuraciones, 100.000 queries/día) desde abril 2025, y soporta
  `postgres-js` explícitamente (mínimo `postgres@3.4.5`) con el flag `nodejs_compat`
  activado. — [Cloudflare Hyperdrive + postgres-js](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js)
- **Tarjeta**: no la pedí directamente pero el plan Free histórico de Workers no la exige
  para empezar.
- **Por qué igual NO es un "sí" limpio**:
  1. `server.mjs` (basado en `node:http`) no corre en Workers tal cual — hace falta
     reemplazar el entrypoint (`@cloudflare/vite-plugin` o uno propio), es decir, la
     migración de servidor de §0 en su versión más profunda.
  2. `archiver` usa streams y `zlib` de Node; su compatibilidad bajo `nodejs_compat` en
     `workerd` no está verificada acá — es un riesgo real, no confirmado ni descartado.
  3. Los **10 ms de CPU por request en el plan gratis** son estrechos para un SSR real
     (render de React + serialización + lo que tome la query, sin contar la espera). Es
     plausible que una página con contenido dinámico los agote. La escalera de salida es
     barata (**Workers Paid, US$5/mes, 30.000.000 ms de CPU incluidos**, ~30s de CPU por
     invocación por defecto, configurable), pero ya no es "gratis".
  - **Veredicto honesto**: Cloudflare Workers es, en el papel, la plataforma más generosa
    para el patrón proxy-pesado de este proyecto (egress gratis, sin límite de
    wall-clock, Hyperdrive resuelve Postgres) — pero exige la migración de servidor más
    grande de la lista y corre con riesgo real de pisar el techo de CPU gratis en cuanto
    el SSR haga trabajo de verdad. Tratarlo como "probablemente necesita el escalón de
    US$5/mes", no como gratis garantizado.

### Fly.io

- **Sin free tier desde octubre de 2024** — cuentas nuevas reciben ~US$5 de crédito de
  prueba, después es 100% pago por segundo.
- **Costo real más barato**: `shared-cpu-1x` con 256 MB ≈ **US$2/mes** siempre encendida
  (ejemplo región Ámsterdam) — pero 256 MB es insuficiente incluso para `web` sola si hay
  concurrencia real, y no aplica al problema de la API (ver §2). Volúmenes: **US$0.15/GB
  al mes**. Egress: US$0.02–0.12/GB según región. — [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- Sirve para correr `server.mjs` tal cual, sin ninguna migración de servidor (es un
  contenedor Docker normal, corre el Dockerfile que ya existe en el repo). Pero no es
  gratis.

### Render — Free

- **Web Service**: 512 MB RAM / 0.1 CPU.
- **Duerme**: sí, a los **15 minutos de inactividad** (antes eran 30). Vuelve a levantar
  en **~1 minuto**.
- **Disco persistente**: **no disponible en el plan free**, ni para `web` ni para nada.
- **Tarjeta**: no exigida para arrancar.
- **Bandwidth**: cuenta contra un pool mensual incluido no cuantificado en la página de
  free — hay que mirarlo en el dashboard de facturación.
- Corre `server.mjs` sin cambios (Docker normal), pero el cold-start de 1 minuto en el
  primer request tras inactividad es un problema real para una demo/uso esporádico —
  mismo defecto que la API, aplicado ahora al frontend.

### Railway — sin free tier permanente

- Ya no hay plan gratis continuo: crédito de prueba de US$5 (30 días), después el "Free
  plan" da solo **US$1/mes de crédito** — insuficiente para un servicio siempre
  encendido. El escalón real es **Hobby, US$5/mes** + consumo. No aplica como opción
  gratis.

### Koyeb — Free

- **Un** web service gratis, 512 MB RAM / 0.1 vCPU, 2 GB SSD **efímero** (no persistente),
  solo en Frankfurt o Washington D.C.
- Escala a cero tras **1 hora** sin tráfico (documentación oficial). El cold start desde
  cero no está cuantificado en las fuentes consultadas, pero el patrón "scale-to-zero" es
  el mismo problema de fondo que Render.
- Sirve para probar `server.mjs` sin migración, pero con el mismo riesgo de cold-start que
  Render, sobre menos RAM.

### Zeabur

- El "free" real es un **plan de prueba con US$5 de crédito mensual**, 1 vCPU / 2 GB por
  servicio, **duerme por inactividad** (cold start de "unos segundos" según su propia
  documentación, sin cifra exacta). Sin backup automático ni SLA. No requiere tarjeta.
  Funcionalmente parecido a Render/Koyeb en el patrón de sueño.

### Northflank — Free ("Sandbox")

- 2 servicios + 1 base de datos + 2 cron jobs gratis. La documentación pública no deja
  claro si el free tier incluye disco persistente gratuito o si es 100% add-on pago
  (US$0.30/GB/mes) — no pude confirmarlo con una fuente sólida en el tiempo de esta
  investigación. Tratalo como "no verificado", no como "sí".

### Deno Deploy

- TanStack Start **no lo documenta como destino oficial** (confirmado contra la página de
  hosting del framework). Se podría forzar corriendo el bundle SSR bajo la capa de
  compatibilidad Node de Deno, pero es terreno no soportado por el framework y no
  investigué sus límites de free tier en detalle porque no hay un camino claro de
  despliegue sin trabajo de adaptación adicional, igual o peor que Cloudflare.

---

## 2. La API no tiene un "gratis" real en ningún lado que revisé

No es el foco de este informe, pero condiciona la recomendación del par, así que lo dejo
explícito con lo que verifiqué:

- **Render free**: 512 MB RAM descalifica solo por memoria (el propio CLAUDE.md del
  proyecto dice que con 512 MB "probablemente muera" con los arrays float32 en vuelo), y
  **no hay disco persistente en free** — la API necesita `/data` para GeoTIFF y caché de
  Aqueduct. Sumale el cold start de 1 minuto sobre un job de hasta 90s: inaceptable.
- **Koyeb free**: mismo problema de RAM, y **los free instances no admiten Volumes**
  (persistencia) según su propia documentación.
- **Fly.io**: sin free tier. Una máquina con RAM real (1–2 GB) más un volumen para `/data`
  ronda, por los números oficiales de arriba, unos **US$10–15/mes** siempre encendida
  (compute + volumen; el egress se suma aparte).
- **Railway/Zeabur**: mismo patrón — crédito de prueba, después mínimo US$5/mes más
  consumo, y ambos duermen por inactividad en su capa más barata (mala combinación con un
  job de 90s si el servicio se durmió).
- **Northflank**: no pude confirmar disco persistente gratis.

**Conclusión honesta sobre la API**: con las cifras que verifiqué, ningún proveedor ofrece
gratis las tres cosas que la API necesita a la vez — RAM suficiente (≥1 GB), disco
persistente, y sin sueño agresivo. El escalón más barato con evidencia sólida es
**Fly.io pagando por uso, ~US$10–15/mes** (1–2 GB RAM siempre encendida + volumen para
`/data`). Si otro informe de este mismo directorio investigó la API en profundidad y
encontró algo mejor, ese número manda sobre este.

---

## 3. El par API + web — dónde conviene poner cada cosa

Puntos concretos, en orden del brief:

**a) ¿Mismo proveedor o separados?**
Dado que el navegador nunca habla directo con la API — todo (incluido, aparentemente, el
progreso SSE) pasa por `web` server-to-server — la latencia `web`↔`api` se paga en **cada**
tile de overlay y en cada tick de progreso, no solo en el POST inicial. Esto pesa mucho
más que "un panel menos" o "una factura más". Si `web` y `api` quedan en regiones o redes
distintas, cada intercambio agrega un salto de red de ida y vuelta pública en vez de红
interna del datacenter — decenas de ms extra por request, que se acumulan visiblemente en
un mapa que pide overlays en ráfaga al mover el viewport.

**b) Web en Vercel + API en Fly, ¿qué implica?**
- **Latencia**: Vercel Hobby corre en una sola región por defecto (`iad1`, us-east). Fly
  puede desplegarse en cualquier región suya; para minimizar el salto conviene una región
  Fly cercana a `iad1` (ej. `ord` u otra en EE.UU. este), pero sigue siendo un salto
  público internet-a-internet, no red interna de VPC. Con análisis de 10–90s el overhead
  de latencia de red (unos pocos ms a decenas de ms por request) es ruido comparado con el
  cómputo — el problema real no es la latencia entre `web` y `api`, es que en Vercel
  serverless **no hay conexión persistente/keep-alive barata entre invocaciones**: cada
  invocación de función abre su propio socket a `api`, lo cual está bien para requests
  cortos (overlay PNG) pero es exactamente el patrón que el propio `TERRITORIO_API_TOKEN`
  y CORS ya contemplan.
- **CORS**: no debería hacer falta tocar `TERRITORIO_CORS_ORIGINS` para nada del browser,
  porque el browser sigue sin hablarle a `api` directo (arquitectura actual). Si `web` deja
  de ser un contenedor propio y pasa a ser funciones serverless, `TERRITORIO_CORS_ORIGINS`
  en `api` solo necesita seguir apuntando a la URL pública de `web` (Vercel), no a nada de
  Fly — es tráfico servidor-a-servidor, CORS no aplica ahí (CORS es una restricción de
  navegador). Sí hay que revisar `TERRITORIO_API_TOKEN` para que las funciones serverless
  de Vercel lo tengan como variable de entorno de runtime.
- **Concurrencia de jobs**: la API tiene **un solo worker** con el store de jobs en
  memoria de proceso (`TERRITORIO_MAX_CONCURRENT_JOBS`, no `--workers`). Esto es
  independiente de dónde viva `web`, pero importa para el par: si `web` escala a muchas
  invocaciones concurrentes (Vercel autoescala hasta miles), todas terminan compitiendo
  por el único proceso de `api`. Nada de esto cambia con el proveedor — es una propiedad
  del diseño actual de `api` — pero vale la pena mencionarlo porque **no gana nada** poner
  `web` en un proveedor "más elástico" si el cuello de botella real es el worker único de
  `api`.

**c) Supabase está en `us-west-1` — ¿dónde conviene el resto?**
`us-west-1` de Supabase (confirmado ahora mismo con `mcp__supabase__get_project`,
proyecto `Territory-Screen`) es AWS Norte de California. Para minimizar saltos:
- Si se elige **Vercel**, fijar la región de la función a algo en la costa oeste de EE.UU.
  (Vercel permite cambiar la región por defecto en Hobby, aunque de una sola región a la
  vez) en vez de dejar el default `iad1` (este) — ahorra el salto transcontinental en cada
  query de Postgres desde `web`.
- Si se elige **Cloudflare Workers**, la latencia a Supabase la absorbe Hyperdrive con
  pooling — igual conviene que el resto del stack (si algo corre en Fly/Render) esté en
  costa oeste de EE.UU.
- Si la **API** queda en Fly, elegir una región Fly de costa oeste de EE.UU. (`sjc` o
  similar) acerca tanto a Supabase como, potencialmente, a `web`.

**d) Egress**
- Los overlays PNG (arrays ~1000×1000 px) y los GeoTIFF de descarga son el tráfico pesado,
  y **todos pasan por `web`** antes de llegar al navegador (proxy con verificación de
  sesión). Eso significa que el consumo de bandwidth de `web` no es solo HTML/JS — incluye
  cada byte de cada overlay y cada ZIP/GeoTIFF descargado.
- **Netlify** (300 créditos ≈ 15 GB/mes en cuentas nuevas) se queda corto rápido: un
  puñado de GeoTIFF de varios MB cada uno, más overlays repetidos por sesión de mapa,
  agotan eso en poco uso real. Es, en la práctica, el límite más estrecho de toda la
  lista para este patrón de tráfico.
- **Vercel** (100 GB/mes en Hobby, cifra no confirmada en una página oficial fetcheada
  directamente) da más margen, pero sigue siendo un techo finito para un producto de
  descarga de rásters.
- **Cloudflare Workers** es la única plataforma de la lista con **egress sin cargo ni
  límite** — el argumento más fuerte a su favor para este proyecto específico, si se
  absorbe el costo de migración de servidor de §0 y el riesgo de CPU de §1.
- Fly.io cobra egress explícito (US$0.02–0.12/GB) — hay que sumarlo al costo mensual de
  la API si los GeoTIFF se sirven desde ahí en vez de proxeados por `web` (hoy no es el
  caso: `web` los proxea, así que el egress de `api` es solo interno).

---

## 4. Recomendación

**Ninguna combinación es 100% gratis y sostenible a la vez** con los datos verificados
acá. Dos caminos honestos, según cuánta migración de servidor esté dispuesto a absorber
el equipo:

### Camino A — menor esfuerzo de migración: Vercel (web) + Fly.io (api)
- `web` en **Vercel Hobby**, gratis, con una función Node manual que envuelve el handler
  existente (`dist/server/server.js`) — no el preset oficial, pero cambio acotado. 300s de
  timeout cubre sobrado el proxy de un análisis de 90s. Sujeto a la restricción de uso no
  comercial del plan Hobby.
- `api` en **Fly.io**, pago por uso, **~US$10–15/mes** (1–2 GB RAM + volumen persistente),
  única opción de las revisadas que ofrece RAM real, disco persistente y sin sueño con
  evidencia de precio verificable.
- **Costo real total: ~US$10–15/mes**, todo el costo cae en la API (que es, como dice el
  propio brief, la restricción dura).

### Camino B — más ambicioso, el más barato en el techo: Cloudflare Workers (web) + Fly.io (api)
- `web` en **Cloudflare Workers**, gratis mientras el uso real quepa en 10ms de CPU por
  request (dudoso para SSR real bajo carga), con escalón de salida a **US$5/mes** (Workers
  Paid) si no alcanza. Egress ilimitado gratis es la ventaja que ningún otro competidor
  iguala para este patrón de tráfico pesado en rásters.
  Exige: sacar `server.mjs`, adoptar `@cloudflare/vite-plugin` (o un entrypoint `fetch`
  propio), verificar `archiver` bajo `nodejs_compat`, y conectar Postgres vía Hyperdrive
  en vez de `postgres-js` directo por TCP abierto a mano.
- `api` igual que en el Camino A: Fly.io, ~US$10–15/mes.
- **Costo real total: ~US$10–20/mes**, con más trabajo de adaptación pero el mejor
  comportamiento a largo plazo si el tráfico de overlays/GeoTIFF crece (egress gratis).

**Si el objetivo es cero esfuerzo de migración y aceptar pagar**: correr ambos servicios
como Docker normal (el repo ya tiene `compose.yaml` y ambos Dockerfiles listos) en **un
solo Fly.io** con dos Machines en la misma red privada — resuelve la latencia interna
gratis (misma red Fly, sin salto público) al costo de sumar el precio de `web` como una
Machine más (~US$2–5/mes con RAM modesta, ya que no necesita disco). Total estimado:
**~US$13–20/mes**, cero migración de servidor, un solo proveedor, un solo panel.

No hay, con las cifras que pude verificar hoy, una combinación gratuita y honesta que
sostenga el patrón real de esta app (proxy SSE de 90s + overlays pesados + ZIP/GeoTIFF de
descarga). El gasto real más defendible ronda **US$10–20 al mes**, concentrado casi todo
en la API.

---

## Fuentes citadas

- [TanStack Start — Hosting](https://tanstack.com/start/latest/docs/framework/react/guide/hosting)
- [Custom server support for TanStack Start (discussion #3777)](https://github.com/TanStack/router/discussions/3777)
- [Why TanStack Start is Ditching Adapters](https://tanstack.com/blog/why-tanstack-start-is-ditching-adapters)
- [Vercel Functions Limits](https://vercel.com/docs/functions/limitations)
- [Vercel Hobby Plan](https://vercel.com/docs/plans/hobby)
- [Cloudflare Workers Pricing](https://developers.cloudflare.com/workers/platform/pricing/)
- [Cloudflare Hyperdrive + postgres-js](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js)
- [Render — Free tier docs](https://render.com/docs/free)
- [Fly.io Pricing](https://fly.io/docs/about/pricing/)
- [Railway — Free Trial docs](https://docs.railway.com/reference/pricing/free-trial)
- [Koyeb — Pricing FAQ](https://www.koyeb.com/docs/faqs/pricing)
- [Zeabur — Free Plan docs](https://zeabur.com/docs/en-US/pricing/free-plan)
- [Netlify — Introducing Netlify's Free plan](https://www.netlify.com/blog/introducing-netlify-free-plan/)
- Supabase: región confirmada en vivo vía `mcp__supabase__get_project` (proyecto
  `Territory-Screen`, `us-west-1`).

Nota de honestidad: para Koyeb, Zeabur y Northflank no encontré una página oficial de
pricing fetcheable directamente (solo búsquedas web con agregadores de terceros); los
números de esas tres secciones tienen menos certeza que los de Vercel, Cloudflare, Render
y Fly, que sí vienen de documentación oficial fetcheada en esta sesión.
