# Territorio Base — Plan de validación post-implementación (app nueva)

> **Este documento ES el contrato de validación.** Se derivó leyendo el código real de
> `apps/web/src/routes/**`, `components/**`, `layers/**`, `lib/**`, `packages/geo/src/**`,
> `packages/db/src/**` y `services/api/src/**` en la rama `feat/tanstack-monorepo-migration`.
> No describe intenciones del brief: describe lo que la app **hace hoy**.
>
> Complementa (no reemplaza) `00-legacy-inventory.md` (48 casos legacy, 9 regresiones) y
> `02-design-brief.md` (especificación de UI).
>
> Convención de selectores: se prefiere **texto visible en castellano** o **rol accesible**
> (`aria-label`, `role`, `aria-expanded`, `aria-pressed`, `aria-checked`). Donde un control no
> tiene ninguno de los dos, está listado en **§2.12 «Necesita testid»** y el validador debe
> tratarlo como bloqueante hasta que se agregue.

---

## 0. Preparación del entorno

### 0.1 Arranque

```bash
pnpm install --frozen-lockfile
pnpm --filter @territorio/db db:migrate
ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter @territorio/db db:seed -- --name "Validador"
pnpm --filter @territorio/db db:create-invite            # imprime un código de invitación
# API raster (opcional para la mitad B, obligatorio para overlays raster de la mitad A)
cd services/api && uv run uvicorn territorio_base_api.main:app --port 8787
# Web
pnpm --filter web dev                                    # puerto 3000
```

Variables relevantes (`.env.example`): `BETTER_AUTH_SECRET` (obligatoria, ≥32 chars),
`BETTER_AUTH_URL`, `DATABASE_URL`, `API_URL`. El browser toma la base de overlays de
`VITE_API_URL`, con fallback `http://localhost:8787` **solo en dev** (`raster-base.ts`).

### 0.2 Dos servidores independientes

Los dos halves del §6 corren contra instancias separadas para poder paralelizarse:

| Half | Puerto | Base de datos | Notas |
|---|---|---|---|
| **A** — auth + shell + mapa + inspector | 3000 | `data/territorio-a.db` | necesita `services/api` vivo para overlays raster |
| **B** — reporte + descargas + fuentes + responsive | 3001 (`vite dev --port 3001`) | `data/territorio-b.db` | necesita al menos un análisis sembrado y su `analysisId` |

Cada half usa su propio `DATABASE_URL`, su propio usuario sembrado y su propio código de
invitación. **No comparten estado**: un job de exportación vive en memoria del proceso
(`export-runtime.ts`), así que reiniciar el server pierde los jobs abiertos.

### 0.3 Precondiciones de datos

- **AOI dentro de RD**: polígono de ~200 ha cerca de `-69.571, 18.453` (centro por defecto del mapa,
  `map-canvas.tsx::DEFAULT_CENTER`, zoom 13). Produce MEPyD, hidrología y WDPA.
- **AOI fuera de RD**: para ejercitar `requiresRd`, `in_rd = false`.
- **AOI grande (>500 ha y >2000 ha)**: para los guards de tamaño de análisis y de exportación.
- **Archivos de AOI**: un `.geojson` válido, un `.kml` válido, un `.kmz` válido, un `.geojson`
  corrupto (JSON roto), y un archivo >10 MB.

---

## 1. Mapa de rutas

Árbol real (`routeTree.gen.ts` deriva de `src/routes/`):

| Ruta | Archivo | Auth | `beforeLoad` / `loader` | `validateSearch` / params | Qué renderiza |
|---|---|---|---|---|---|
| *(root)* | `routes/__root.tsx` | — | — | — | `<html lang="es">`, `<title>Territorio Base</title>`, meta `description`, `color-scheme: light dark`, `ToastProvider`, `errorComponent=AppErrorBoundary`, `notFoundComponent=NotFound` |
| `/login` | `routes/login.tsx` | pública | `beforeLoad: redirectIfSignedIn(search.redirect)` | `{ redirect?: string (≤2000) }` | Formulario Email + Contraseña + «Entrar» + link «Creá tu cuenta» |
| `/register` | `routes/register.tsx` | pública | `beforeLoad: redirectIfSignedIn()` | `{ invite?: string (≤64) }` | Formulario Nombre/Email/Contraseña/Código de invitación + «Crear cuenta» + link «Entrá» |
| `/_app` *(layout)* | `routes/_app.tsx` | **protegida** | `beforeLoad: { user: await requireUser(location) }` — corre en SSR **y** en cada navegación cliente; sin sesión lanza `redirect({ to:'/login', search:{ redirect: location.href } })` | — | Solo contexto (`user`); no dibuja nada |
| `/` | `routes/_app/index.tsx` | protegida (heredada) | — (sin loader) | `mapSearchSchema`: `aoi?`, `theme` (enum, default `topografia`, `.catch`), `layers?` csv, `op?` csv `id:opacidad`, `sel?` `layerId:featureId`, `bbox?`, `panel` (`capas`\|`analisis`, default `capas`) | `AppShell` = `Topbar` + `ServiceDownStrip` + `LeftPanel(Capas\|Análisis)` + `MapCanvas` + `MapToolbar` + `BottomCluster` + `Inspector` + `DownloadModal` |
| `/fuentes` | `routes/_app/fuentes.tsx` | protegida | — | — | `head.meta`: title «Fuentes y metodología · Territorio Base». Índice de anclas + una ficha por dataset + «Límites y decisiones de exclusión» (5 ítems) + «Cómo citar» |
| `/reporte/$analysisId` | `routes/_app/reporte.$analysisId.index.tsx` | protegida | `loader`: `queryClient.query(analysisSummaryQueryOptions(id), staleTime:'static')` — **resumen sin geometrías**, resuelto en SSR | param `analysisId` | Header pegajoso + `ReportBody` (story map sidecar) |
| `/reporte/$analysisId/imprimir` | `routes/_app/reporte.$analysisId.imprimir.tsx` | protegida | `loader`: `queryClient.query(analysisQueryOptions(id), staleTime:'static')` — **análisis completo con geometrías** | param `analysisId` | Hoja de impresión (`<style>` con `@page A4 portrait`, thead/tfoot corrientes) + `ReportBody print` |
| `/descargas/$jobId` | `routes/_app/descargas.$jobId.tsx` | protegida | — (sin loader; `useExportJob` poletea 1 200 ms mientras `status==='generando'`) | param `jobId` | Badge de estado, `Progress` determinado, `ExportJobPanel`, botón/enlace de descarga, aviso de expiración |
| `/descargas/$jobId/zip` | `routes/_app/descargas.$jobId.zip.ts` | **auth dentro del handler** (`fetchSession()`, no `beforeLoad`) | `server.handlers.GET` | param `jobId` | `200 application/zip` + `content-disposition: attachment` + `cache-control: no-store, private`; `401` sin sesión; `409` si `generando`; `404` si no existe / no es del usuario / expirado |

**Reglas de auth verificables:**

- El guard vive en `beforeLoad` (servidor durante SSR) → **cero flash** de shell logueado.
- Cada `createServerFn` que devuelve datos privados revalida sesión por su cuenta
  (`analysis-server.ts`, `export-server.ts` llaman `fetchSession()` y devuelven
  `no-autenticado` / `no-encontrado`). El `beforeLoad` protege la navegación, no los datos.
- `safeRedirectPath` descarta todo lo que no sea path absoluto same-origin (`//`, `/\`, URLs
  completas → `/`). Defensa contra open redirect.
- Si `@territorio/db` no exporta `webAuthBoundary`, `resolveAuthBoundary()` devuelve `null` y
  **todo falla cerrado**: sin sesión, redirect a `/login`, y el formulario muestra `servicio`.

---

## 2. Inventario de controles, pantalla por pantalla

Leyenda de la columna «Selector»: `text=` texto visible exacto · `aria=` `aria-label` · `role=`
rol accesible · `❗` = **no tiene selector estable, necesita `data-testid`** (ver §2.12).

### 2.1 `/login`

| # | Control | Tipo | Selector | Estado / efecto |
|---|---|---|---|---|
| L-1 | Título | `h1` | `text=Territorio Base` | — |
| L-2 | Subtítulo | `p` | `text=Entrá con tu cuenta para abrir el mapa.` | — |
| L-3 | Email | `input[type=email][name=email]` | `aria`/label `Email`, `autocomplete=email`, `required` | `aria-invalid` al fallar credenciales |
| L-4 | Contraseña | `input[type=password][name=password]` | label `Contraseña`, `autocomplete=current-password` | idem |
| L-5 | Entrar | `button[type=submit]` | `text=Entrar` | `loading` → `disabled` + `aria-busy=true` + spinner |
| L-6 | Mensaje de error | `p[role=alert]` | `role=alert` | texto de `AUTH_ERROR_MESSAGES` |
| L-7 | Link a registro | `a` | `text=Creá tu cuenta` → `/register` | — |

Formulario con `noValidate`: la validación es del servidor, no del navegador.

### 2.2 `/register`

| # | Control | Tipo | Selector | Estado / efecto |
|---|---|---|---|---|
| R-1 | Título / bajada | `h1` / `p` | `text=Crear cuenta` / `text=El acceso es por invitación: necesitás un código para registrarte.` | — |
| R-2 | Nombre | `input[name=name]` | label `Nombre` | `required` |
| R-3 | Email | `input[type=email][name=email]` | label `Email` | `aria-invalid` con `email-en-uso` |
| R-4 | Contraseña | `input[type=password][name=password]` | label `Contraseña`, hint `Mínimo 8 caracteres.`, `minLength=8` | `aria-invalid` con `password-debil` |
| R-5 | Código de invitación | `input[name=inviteCode]` | label `Código de invitación`, hint `Te lo pasa quien te invitó. Cada código sirve una sola vez.` | prellenado desde `?invite=`; `aria-invalid` con `invitacion-invalida` / `invitacion-usada` |
| R-6 | Crear cuenta | `button[type=submit]` | `text=Crear cuenta` | `loading` |
| R-7 | Error | `p[role=alert]` | `role=alert` | — |
| R-8 | Link a login | `a` | `text=Entrá` → `/login` | — |

Copy de error verificable (`session.ts::AUTH_ERROR_MESSAGES`): `Email o contraseña incorrectos.` ·
`El código de invitación no existe.` · `Ese código de invitación ya fue usado.` ·
`Ya hay una cuenta con ese email.` · `La contraseña tiene que tener al menos 8 caracteres.` ·
`No se pudo contactar el servicio de cuentas. Probá de nuevo en un momento.`

### 2.3 `/` — Topbar (`components/layout/topbar.tsx`)

| # | Control | Tipo | Selector | Estado / efecto |
|---|---|---|---|---|
| T-1 | Marca | `span` | `text=Territorio Base` | — |
| T-2 | Vistas (≥1024px) | `div[role=radiogroup]` con 5 `button[role=radio]` | `aria=Vista`; radios `text=Topografía`, `Vegetación`, `Hidrología`, `Áreas protegidas`, `Riesgo RD` | `aria-checked`; **← / →** cambian de vista; `title` = `hint` de la vista; `Riesgo RD` **se oculta** (no se deshabilita) si `!inRd` |
| T-3 | Vistas (768–1023px) | `select` | label `Vista:` | mismas 5 opciones |
| T-4 | Chip AOI | `button` + `Popover` | `text=Sin AOI` o `text=AOI: {ha}`; `aria-haspopup=dialog`, `aria-expanded` | **`disabled` cuando `areaHa === null`** |
| T-5..T-8 | Acciones AOI (dentro del popover `aria=Acciones del AOI`) | `button` ×4 | `text=Ver límites` / `Reemplazar` / `Descargar AOI` / `Borrar` | **hoy son no-op** (`onAoiAction: () => undefined` en `index.tsx`) → ver D-04 |
| T-9 | Reporte | `button` | `text=Reporte`, `title=Dibujá o subí un AOI primero` cuando deshabilitado | **siempre `disabled`** hoy y `onReport` es no-op → ver D-02 |
| T-10 | Exportar | `button` | `text=Exportar` | **siempre `disabled`** hoy (mismo motivo) → ver D-02 |
| T-10b | Chip de exportación | `button` con `Exportando… n/m` o `Descargar (x MB)` | `text=Exportando…` | solo si `exportJob !== null`; la ruta pasa `exportJob={null}` → inalcanzable |

### 2.4 `/` — Franja de servicio caído (`states/service-strip.tsx`)

| # | Control | Selector | Notas |
|---|---|---|---|
| S-1 | Franja | `div[role=status]` con `{servicio} no responde — reintentando (n/m)` | ámbar, 28 px |
| S-2 | Descartar | `button[aria-label="Descartar aviso"]` | limpia `incidents` |

`index.tsx` inicializa `incidents = []` y nunca lo llena → **hoy la franja nunca aparece** (D-06).

### 2.5 `/` — Panel izquierdo (`layout/left-panel.tsx`)

| # | Control | Selector | Notas |
|---|---|---|---|
| P-1 | Pestañas | `div[role=tablist][aria-label="Panel izquierdo"]`, `button[role=tab]` `text=CAPAS` / `text=ANÁLISIS` (uppercase por CSS; el texto del DOM es `Capas` / `Análisis`) | `aria-selected`; **← / →** navegan; escribe `?panel=` con `replace:true` |
| P-2 | Colapsar panel | `button[aria-label="Colapsar panel"]` | pasa a riel de 48 px |
| P-3 | Expandir panel (riel) | `button[aria-label="Expandir panel"]` o `aria-label="Expandir panel (se colapsó solo)"` | el segundo texto aparece cuando el colapso fue automático (1280–1439 px con inspector abierto) |
| P-4 | Riel → Capas | `button[aria-label="Capas"]` | expande + cambia pestaña |
| P-5 | Riel → Análisis | `button[aria-label="Análisis"]` | idem |
| P-6 | Riel (contenedor) | `nav[aria-label="Panel de capas colapsado"]` | — |
| P-7 | Panel expandido | `aside[aria-label="Panel de capas y análisis"]` | ancho `w-90` (360 px) |

### 2.6 `/` — Pestaña CAPAS (`layers/layer-panel.tsx`, `layer-row.tsx`)

Se construye **entera** desde `LAYER_REGISTRY` (50 capas: 1 AOI + 4 topografía + 3 vegetación +
1 hidrología + 1 WDPA + 1 Aqueduct + **39 MEPyD**), agrupada por `GROUP_ORDER`:
`Área de estudio · Topografía · Vegetación · Hidrología · Áreas protegidas · Riesgo costero ·
Contexto RD (MEPyD)`. MEPyD anida un segundo nivel con 7 subgrupos:
`División Político-Administrativa · Amenaza sísmica (por nivel censal 2010) · Amenazas · Agua ·
Infraestructuras y edificaciones · Vías · Áreas protegidas (MEPyD)`.

| # | Control | Selector | Notas |
|---|---|---|---|
| C-1 | Buscar capa | `input[type=search][aria-label="Buscar capa"]`, `placeholder=Buscar capa…` | filtra por `label`/`group`/`subgroup`; sin coincidencias → `text=Ninguna capa coincide con «…».`; con query los acordeones se abren |
| C-2 | Aviso de tope | `p` `text=Tope de 4 capas de datos visibles alcanzado. Apagá una para prender otra.` | aparece con `countVisibleDataLayers >= 4` (el AOI `alwaysOn` no consume cupo) |
| C-3 | Acordeón de grupo | `button[aria-expanded]` con el nombre del grupo | `aria-controls` apunta al contenido (`hidden` cuando cerrado) |
| C-4 | Pastilla de conteo | `span[aria-label="{n} capas activas en {grupo}"]` | solo se dibuja con `n > 0` |
| C-5 | Acordeón de subgrupo MEPyD | `button[aria-expanded]` con el subgrupo, indentado `pl-7` | `aria-label` de la pastilla: `{n} capas activas en {subgrupo}` |
| C-6 | Encabezado de rol | `h4` `text=Mediciones (generan datos en el reporte)` / `text=Contexto (solo visualización)` | split medición/contexto rotulado (§4.4) |
| C-7 | Checkbox de capa | `input[type=checkbox]` dentro de `label` con el `label` de la capa | `disabled` si `status ∈ {error, skipped}` o `alwaysOn` (el AOI). Toggle → reescribe `?layers=` con `replace:true` |
| C-8 | Icono «medición» | `span[title="Medición: genera datos en el reporte"]` | solo en `role==='medicion'` |
| C-9 | Alfiler de contexto | `span[title="Prendida a mano: sobrevive el cambio de vista"]` | `isPinnedContext` |
| C-10 | Conteo de features | `span` numérico | solo con `status==='ok'` y `featureCount != null` |
| C-11 | Chip de estado | `span[title="{detalle}"]` con `Badge` | textos: `calculando` · `sin datos` · `error` · `omitida`, o `reason`: `sin AOI`, `sin escenas S2`, `Overpass caído`, `WDPA caído`, `MEPyD caído`, `servicio caído`, `fuera de RD`, `sin geometrías`, `elegí escenario`, `no la produce` |
| C-12 | Reintentar | `button` `text=reintentar` | solo con `status==='error'` |
| C-13 | ⓘ Información | `button[aria-label="Información de {capa}"]` → `div[role=dialog][aria-label="Información de {capa}"]` | contiene leyenda, Fuente (link `target=_blank`), Proveedor, Vigencia, Resolución, Licencia, método, caveat |
| C-14 | Descargar capa recortada | `button` `text=Descargar esta capa recortada al AOI` (dentro de C-13) | `disabled` sin AOI, `title=Dibujá o subí un AOI primero`; abre el `DownloadModal` |
| C-15 | ◐ Opacidad | `button[aria-label="Opacidad de {capa}"]`, `aria-expanded` | despliega sub-fila con slider |
| C-16 | Slider de opacidad | `input[type=range][aria-label="Opacidad de {capa}"]`, min 0 max 1 step 0.05 | **`disabled` si el checkbox está apagado**; escribe `?op=` |
| C-16b | Stepper − / + | `button[aria-label="Bajar Opacidad de {capa}"]` / `"Subir …"` | solo con `touch` (breakpoints `mobile` y `tablet`) |
| C-17 | ✕ Quitar capa | `button[aria-label="Quitar {capa}"]` | solo con `layer.removable === true` (Aqueduct + las 39 MEPyD) |
| C-18 | Cortes de clase | `button[aria-expanded]` `text=Editar cortes de clase` / `text=Ocultar cortes de clase` | solo en `slope-classes` y `ndvi-density` |
| C-19 | Sliders de corte | `input[type=range][aria-label="Cortes de clase (%) — corte {n}"]` (pendiente: 0–100, step 1) y `"Cortes de clase (NDVI) — corte {n}"` (−1–1, step 0.05) | el `help` se imprime debajo. **No re-lanzan el análisis** y hoy **no reclasifican el mapa** → ver D-08 |
| C-20 | Handle de reordenar | `span[title="Arrastrar para reordenar (z-order)"]` | `aria-hidden`, **decorativo: no hay drag implementado** → ver D-09 |
| C-21 | Huellas Sentinel-2 | `input[type=checkbox]` en `label` `text=Ver huellas de escenas Sentinel-2` (barra oscura fija de 40 px) | el estado se guarda pero **no llega al mapa** → ver D-10 |

### 2.7 `/` — Pestaña ANÁLISIS (`analysis/analysis-panel.tsx`)

Estado real hoy: `index.tsx` pasa `phase = hasAoi ? 'listo' : 'sin-aoi'`, `cards={[]}`,
`progress={[]}`, `areaHa={null}`, `elapsedMs={0}`. Las ramas `analizando` y las tarjetas de métrica
**no son alcanzables** desde `/` (D-01, D-03).

**Rama `sin-aoi` — `EmptyAoiState`** (alcanzable):

| # | Control | Selector |
|---|---|---|
| A-1 | Título | `h2` `text=Definí la zona de estudio` |
| A-2 | Bajada | `text=El análisis arranca solo, apenas se cierra el polígono.` |
| A-3 | Dibujar en el mapa | `button` `text=Dibujar en el mapa` + `text=Polígono o rectángulo` |
| A-4 | Subir un archivo (dropzone) | `label` `text=Subir un archivo` + `text=máx. 10 MB · KML, KMZ, GeoJSON, SHP zipeado · un solo polígono`; input `input[type=file].sr-only` con `accept=".kml,.kmz,.geojson,.json,.zip"` ❗ |
| A-5 | Estado arrastrando | borde punteado `border-accent` ❗ |

> ⚠️ **Inconsistencia de copy verificable**: el dropzone de `EmptyAoiState` ofrece *SHP zipeado* y
> acepta `.zip`, pero el parser real (`@territorio/geo::parseAoiFile`, expuesto por
> `AoiUpload.ACCEPTED_AOI_EXTENSIONS = '.kml,.kmz,.geojson,.json'` y
> `AOI_LIMITS_LINE`) **no acepta SHP**. Ofrecer un formato que el backend rechaza es exactamente
> el antipatrón que el propio archivo documenta. → D-11.

**Rama `analizando` — `AnalyzingState` + `AoiSizeGuard`** (hoy inalcanzable; validar por unit/inyección):

| # | Control | Selector |
|---|---|---|
| A-6 | Título | `h2` `text=Analizando la zona` |
| A-7 | Cronómetro | `span[aria-label="Tiempo transcurrido"]` |
| A-8 | Tarjeta por tema | `article[aria-busy]` con `h3` = nombre del tema y `ol` de pasos con glifo `running/done/error/pending` |
| A-9 | Cancelar | `button` `text=Cancelar análisis` |
| A-10 | Guard 500–2000 ha | `text=AOI grande ({ha})` + `text=El análisis Sentinel-2 a 10 m puede tardar ~4 min.` + botones `Analizar igual`, `Bajar NDVI a 20 m` |
| A-11 | Guard >2000 ha | `text=AOI muy grande ({ha})` + botones `Bajar NDVI a 20 m`, `Dividir el AOI` (sin «Analizar igual») |

**Rama `listo`** (alcanzable con `?aoi=`, pero siempre vacía hoy):

| # | Control | Selector |
|---|---|---|
| A-12 | Fuera de RD | `text=Contexto RD no aplica: el AOI está fuera de República Dominicana.` |
| A-13 | Sin tarjetas | `text=Todavía no hay resultados para la vista {Vista}.` |
| A-14 | Tarjeta `no-data` | `article` con `h3` + razón + `text=Servicio: {nombre}` + `button` `text=Reintentar` |

### 2.8 `/` — Mapa y sus controles

**Contenedor**: `div[role=application][aria-label="Mapa de la zona de estudio"]`, descrito por
`#tb-map-help` (`sr-only`) con las instrucciones de teclado.

**Toolbar vertical** (`div[role=toolbar][aria-label="Herramientas del mapa"][aria-orientation=vertical]`, arriba a la derecha):

| # | Control | Selector | Notas |
|---|---|---|---|
| M-1 | Dibujar AOI | `button[aria-label="Dibujar AOI"]`, etiqueta visible `Dibujar AOI` | `aria-pressed`; segundo click apaga |
| M-2 | Subir AOI | `button[aria-label="Subir AOI"]`, etiqueta visible | dispara `input[aria-label="Subir archivo de AOI"]` (`.sr-only`) |
| M-3 | Medir | `button[aria-label="Medir"]` | `aria-pressed`; **sin implementación**: activa `tool='medir'` y nada más → D-12 |
| M-4 | Comparar capas | `button[aria-label="Comparar capas"]` | idem → D-12 |
| M-5 | Cambiar mapa base | `button[aria-label="Cambiar mapa base"]` | abre el panel `role=dialog` |
| M-6 | Zoom al AOI | `button[aria-label="Zoom al AOI"]` | `disabled` sin AOI; llama `controller.zoomToAoi()` |

**Selector de mapa base** (`div[role=dialog][aria-label="Mapa base"]`): 3 `button[aria-pressed]`:
`Claro (OpenStreetMap)` · `Relieve (OpenTopoMap)` · `Satélite (Esri World Imagery)`, cada uno con
su línea de atribución. **Ninguno requiere API key.**

**HUD de dibujo** (`div[role=status][aria-live=polite]`, arriba al centro):
`text=Dibujando polígono` / `text=Dibujando rectángulo` (+ ` — {ha}`), hint
`Clic para agregar vértices · clic en el primer punto o Enter para cerrar` (polígono) o
`Arrastrá para definir el rectángulo`, más `Esc cancela · Retroceso deshace el último vértice`.
Rótulo flotante de área junto al cursor ❗ (`aria-hidden`).

**Gestos de dibujo** (`map/draw.ts`): click agrega vértice · click sobre el primer vértice (≤12 px)
cierra · doble click cierra (≥3 vértices) · **Enter** cierra · **Escape** cancela (llama `onCancel`) ·
**Backspace/Delete** deshace el último vértice · rectángulo = mousedown + drag + mouseup (un click
sin arrastre se ignora) · el primer vértice pulsa (480 ms) salvo `prefers-reduced-motion`.

**Drag & drop de AOI**: los listeners `dragover/dragleave/drop` viven en el **contenedor del mapa**;
al arrastrar aparece un overlay punteado con `text=Soltá el archivo para usarlo como zona de estudio`
y la línea de límites `máx. 10,0 MB · KML, KMZ, GeoJSON · un solo polígono (varias geometrías se unen)`.

**Leyenda apilada** (arriba a la derecha, sobre el mapa):
`button[aria-expanded]` `text=Leyenda`; una entrada por capa visible con `<span class="sr-only">`
que describe la leyenda en texto. Colapsada por defecto en `compact` (móvil).

**Lectura del mapa** (`MapReadout`, abajo a la derecha, oculta en móvil): barra de escala +
`sr-only` `Coordenadas del cursor:` + `sr-only` `· nivel de zoom {z}`.

**Cúmulo inferior izquierdo** (`BottomCluster`):

| # | Control | Selector | Notas |
|---|---|---|---|
| B-1 | Leyenda compacta | `button[aria-expanded]` `text=Leyenda compacta` | al abrir lista las capas visibles no-`alwaysOn`, o `text=No hay capas de datos visibles.` |
| B-2 | Escala | `span` | **hardcodeada a `— m`** por `index.tsx` (`scaleLabel="— m"`) → D-13 |
| B-3 | Atribución | `span` con `ATTRIBUTION_LINE` | — |

**Interacción con features** (`map-canvas.tsx`):
click sobre capas vectoriales visibles → si pega en **una sola** capa entra directo al feature y
escribe `?sel=layerId:featureId`; si pega en **más de una capa** NO elige ganador: abre el inspector
con la pila de resultados y `sel` queda sin escribir. Hover pinta `feature-state {hover:true}` y
cambia el cursor a `pointer` (o `crosshair` dibujando).

### 2.9 `/` — Inspector (`layout/inspector.tsx`)

`aside[aria-label="Detalle del elemento"]`, 380 px (`w-95`).

| # | Control | Selector | Notas |
|---|---|---|---|
| I-1 | Cerrar | `button[aria-label="Cerrar detalle"]` | limpia `?sel=` |
| I-2 | Encabezado de pila | `p` `text=Resultados` | solo con `candidates.length > 1` |
| I-3 | Candidato | `button` con `{etiqueta de capa}` + conteo | drill-down: `controller.pickLayer(layerId)` |
| I-4 | Volver a los resultados | `button` `text=Volver a los resultados` | `controller.back()` |
| I-5 | Título del feature | `h2` | plantilla del `PopupConfig` de la capa; fallback `Sin nombre`, o la etiqueta de la capa en MEPyD |
| I-6 | Subtítulo | `p` | plantilla `subtitle` |
| I-7 | Pestañas | `div[role=tablist][aria-label="Detalle del elemento"]`, `button[role=tab]` `text=Atributos` / `text=Fuente` | pestaña inicial = `vista.inspectorDefaultTab` (`atributos` en las 5 vistas) |
| I-8 | Atributos | `dl` con `dt`=alias y `dd`=valor | alias **opt-in**; valor vacío → `—` |
| I-9 | Fuente | link `target=_blank` + método + `vigencia · resolución · licencia` + cita | — |
| I-10 | Zoom a la geometría | `button` `text=Zoom a la geometría` | `controller.zoomToSelection()` |
| I-11 | Descargar | `button` `text=Descargar` | abre el `DownloadModal` |
| I-12 | Link a tabla de capa | `button` `text=Capa: {etiqueta} — {n} elementos` | **no-op hoy** (`onOpenTable: () => undefined`) → D-05 |
| I-13 | Vacío | `p` `text=Clickeá un elemento del mapa para ver sus atributos.` | — |

**Atributos por capa (contrato de alias, `layers/registry.ts`):**

- `osm-hydro` — título `{name}`, subtítulo `{kind} · OSM {osm_id}`; campos `Nombre`, `Tipo`
  (`Curso de agua` / `Cuerpo de agua` / `Humedal`); derivado `Distancia al AOI`
  (`0 m (intersecta)` cuando ≤0).
- `wdpa` — título `{name}`, subtítulo `{desig}`; campos `Nombre`, `Designación`,
  `Categoría UICN` (expandida: `II · Parque nacional`, etc.), `Estado`; derivados
  `Solape con el AOI`, `Solape (% del AOI)`, `Distancia al AOI`.
- `aoi` — título `Zona de estudio`; campo `Área`; derivado `Zona UTM` = `EPSG:{n}`.
- **MEPyD (39 capas)** — `allowDynamicFields: true`: título por heurístico
  `{MUN_NOM|NOMBRE|nombre|name}` (fallback = etiqueta de la capa), subtítulo = etiqueta,
  campo aliaseado `Nombre`, **y todas las demás columnas que devolvió el servicio con su nombre
  de columna crudo como etiqueta** (excluyendo `__tbid`, `geometry`, `bbox`).

### 2.10 `/` — Modal de exportación (`download/download-modal.tsx`)

`div[role=dialog][aria-modal=true][aria-label="Exportar"]`, 520 px, con focus trap y cierre por
Escape / click en el scrim / `button[aria-label="Cerrar"]`.

| # | Control | Selector | Notas |
|---|---|---|---|
| E-1 | Pestañas | `div[role=tablist][aria-label="Formato de exportación"]`: `text=Rápido`, `text=Datos`, `text=Impresión` | pestaña inicial **`Datos`** |
| E-2 | Sin análisis | `text=Todavía no hay nada que exportar` | cuando no hay `analysisId` ni `aoiSlug` |
| E-3 | Cargando plan | `text=Leyendo lo que produjo el análisis…` | — |
| E-4 | Plan rechazado | `text=No se pudo leer el análisis` + badge `sin plan de exportación` | — |
| **Rápido** | | | |
| E-5 | Fallback sin captura | `text=La imagen se saca desde el mapa` | **estado permanente hoy**: `index.tsx` no pasa `onCaptureMap` → D-07 |
| E-6..E-9 | Toggles (si hubiera captura) | `text=Incluir leyenda` · `Incluir escala` · `Incluir el límite del AOI` · `Recortar al AOI` | — |
| E-10 | Formato | `div[role=radiogroup][aria-label="Formato de la imagen"]`: `PNG` / `JPG` | — |
| E-11 | Descargar imagen | `button` `text=Descargar imagen` | `disabled` sin preview |
| **Datos** | | | |
| E-12 | Grupo de artefactos | `button[aria-expanded]` con nombre del grupo + `n/m` | grupos >8 artefactos arrancan **colapsados** (MEPyD) |
| E-13 | Todas / Ninguna | `button` `text=Todas` / `text=Ninguna` | solo con ≥2 seleccionables |
| E-14 | Artefacto seleccionable | `input[type=checkbox]` con `{etiqueta}` + meta `{formatos} · {n} elementos · ~{tamaño}` | — |
| E-15 | Artefacto obligatorio | fila con badge `text=siempre` y sin checkbox | `doc:leeme`, `doc:fuentes`, `vector:aoi` |
| E-16 | Artefacto no disponible | fila gris con badge `text=no disponible` + **el motivo escrito** | ver §5 R-3 |
| E-17 | CRS de salida | `select` con `EPSG:4326 — WGS84 (grados)` / `EPSG:{utm} — UTM local del AOI (metros)` | — |
| E-18 | Recortar vectores | `input[type=checkbox]` `text=Recortar los vectores al AOI` (default **ON**) | — |
| E-19 | Pie de selección | `text={n} capa(s) · ~{tamaño} estimados` | — |
| E-20 | Cancelar | `button` `text=Cancelar` | — |
| E-21 | Exportar | `button` `text=Exportar` | `disabled` si `plan === null` o `dataCount === 0`; éxito → navega a `/descargas/{jobId}` |
| E-22 | Aviso de tamaño | `text=Esto va a tardar` (warn) o `text=Selección demasiado grande` (block) | solo warn ofrece `button` `text=Exportar igual` |
| **Impresión** | | | |
| E-23 | Secciones | 8 `input[type=checkbox]`: `Portada y resumen del AOI`, `Topografía`, `Vegetación`, `Hidrología`, `Áreas protegidas`, `Riesgo costero`, `Contexto RD (MEPyD)`, `Fuentes y licencias` | todas marcadas por defecto |
| E-24 | Abrir vista de impresión | `a` `text=Abrir vista de impresión` (`target=_blank`) → `/reporte/{id}/imprimir` | — |
| E-25 | Descargar reporte (Markdown) | `button` `text=Descargar reporte (Markdown)` | crea un blob y dispara `<a download>` |
| E-26 | Atribución (siempre visible) | `h3` `text=Atribución y licencias` + `a` `text=Ver el catálogo completo de fuentes` → `/fuentes` | con selección vacía: `text=Todavía no tildaste ninguna capa de datos.` |

### 2.11 Resto de rutas

**`/fuentes`**: `a` `text=← Volver al mapa` · `h1` `text=Fuentes y metodología` ·
`nav[aria-label="Índice de fuentes"]` con un ancla por dataset · una `article#fuente-{slug}` por
dataset con badge de licencia (`CC BY 4.0` / `ODbL 1.0` / `Uso con condiciones` / `Tuyo` /
`Abierta`), `dl` (`Resolución espacial`, `Vigencia / versión`, `Cobertura`, `Capas que la usan`),
`Endpoint`, `Método`, `Licencia`, `Cita`, `Límite conocido` cuando hay caveat, y
`details > summary` `text=Ver las {n} capa(s) que salen de esta fuente` ·
`h2` `text=Límites y decisiones de exclusión` con **5 ítems** (mirror `overpass.osm.ch`, URL muerta
de Aqueduct, Climate Central descartado, Protected Planet vs. FeatureServer UNEP-WCMC, paginación
MEPyD) · `h2` `text=Cómo citar`.

**`/reporte/$analysisId`**: header `a text=← Volver al mapa` · `span text=Reporte territorial` ·
`a text=Fuentes y metodología` · `a text=Vista de impresión`.
Cuerpo: `nav[aria-label="Secciones del reporte"]` con un ancla por sección
(`Resumen`, `Topografía`, `Vegetación`, `Hidrología`, `Áreas protegidas`, `Riesgo costero`†,
`Contexto RD`†, `Fuentes`) — `aria-current="true"` en la activa — más
`button text=Cambiar de lado` (invierte narrativa/mapa).
Por sección: `section#seccion-{id}[data-step-id={id}]`, `h2#titulo-{id}`, conclusiones,
`MetricCard` con `h3` + `button[aria-label="Fuente y método de {capa}"]` (ⓘ) +
`button[aria-label="Ver {título} en el mapa"]` (⤢) + `a[aria-label="Descargar {archivo}"]` o
`span[aria-label="{motivo}"]` deshabilitado (⤓), `figcaption.sr-only` con el equivalente de texto
del gráfico, y `SectionCitations` (`h4 text=Fuente de esta sección`).
Acciones de prosa: `button[aria-pressed][aria-label="Encuadrar el mapa en el elemento de agua más
cercano, a {n} metros del polígono"]` (`text=ver el cauce más cercano`) y
`button[aria-pressed][aria-label="Resaltar en el mapa las áreas protegidas que se solapan con el
polígono"]` (`text=ver el solape`).
Mapa: `aside[aria-label="Mapa del reporte"]` con `svg[role=img][aria-label={caption}]`, caption
visible y leyenda; mientras cargan geometrías: `text=Cargando las geometrías del análisis…`.
Sección `Fuentes`: tabla con columnas `Dataset · Cita · Resolución espacial · Vigencia/versión ·
Cobertura · Licencia`, más el bloque `h4 text=No disponibles en esta corrida` cuando corresponde.
† condicionales: `riesgo-costero` solo si `analysis.coastal != null`; `contexto-rd` solo si
`analysis.mepyd_rd.in_rd`.

**`/reporte/$analysisId/imprimir`**: `a text=← Volver al reporte` ·
`span text=Vista de impresión · los mapas son figuras estáticas, no el mapa interactivo` ·
`button text=Imprimir o guardar como PDF` (llama `window.print()`).

**`/descargas/$jobId`**: `a text=← Volver al mapa` · `h1 text=Exportación` · badge de estado
(`generando` · `listo` · `listo con faltantes` · `falló` · `cancelado` · `expirado`) ·
`div[role=progressbar][aria-label="Progreso de la exportación"]` con `Exportando… n/m` y cronómetro ·
aviso `text=El bundle está incompleto` en estado `parcial` ·
`ExportJobPanel` (una fila por artefacto con badge `en cola`/`generando`/`listo`/`no incluido`/`error`
y `button text=Reintentar` solo en `error`) ·
`a text=Descargar bundle ({tamaño})` (real `<a href>`, no `<Link>`) o `button` deshabilitado
`text=Descargar bundle` · `button text=Cancelar` mientras genera ·
estado vacío `text=No encontramos ese trabajo` + `a text=Ir al mapa`.

**Errores globales**: `AppErrorBoundary` (`h1 text=Algo se rompió`, `button text=Reintentar`,
`a text=Volver al mapa`) · `NotFound` (`h1 text=Esta página no existe`, `a text=Volver al mapa`).

### 2.12 Necesita `testid`

Controles sin texto visible **ni** rol/`aria-label` estable. El validador debe pedirlos antes de
automatizar el caso correspondiente:

| Control | Ubicación | Testid propuesto |
|---|---|---|
| Input de archivo del dropzone de `EmptyAoiState` | `states/empty-aoi.tsx` (`input.sr-only` sin `aria-label`) | `data-testid="aoi-file-input-panel"` |
| Zona de arrastre de `EmptyAoiState` (`label`) y su estado «arrastrando» | `states/empty-aoi.tsx` | `data-testid="aoi-dropzone-panel"` |
| Overlay «Soltá el archivo…» del mapa | `map/aoi-upload.tsx` | `data-testid="aoi-drop-overlay"` |
| Rótulo flotante de área junto al cursor (dibujo) | `map/map-hud.tsx` (`aria-hidden`) | `data-testid="draw-area-badge"` |
| Canvas de MapLibre y sus capas de estilo (`tb-fill:*`, `tb-outline:*`, `tb-line:*`, `tb-point:*`, `tb-raster:*`, `tb-draw-*`) | `map/layer-style.ts`, `map/draw.ts` | inspeccionar vía `puppeteer_evaluate` con la instancia del mapa; **exponer `window.__tbMap`** en dev |
| Fila de capa (contenedor) — hoy solo se puede localizar por el texto del checkbox | `layers/layer-row.tsx` | `data-testid="layer-row-{layerId}"` |
| Fila de artefacto en el modal y en `/descargas` | `download/artifact-picker.tsx`, `download/export-job-panel.tsx` | `data-testid="artifact-row-{artifactId}"` |
| Miniatura de la captura rápida (`img alt="Vista previa de la imagen del mapa"` existe, pero el contenedor de estado no) | `download/quick-snapshot.tsx` | `data-testid="snapshot-preview"` |
| Ficha de fuente en `/fuentes` (tiene `id="fuente-{slug}"`, sirve como selector — **no necesita testid**) | `routes/_app/fuentes.tsx` | — |
| Barra de escala del `MapReadout` (`span aria-hidden`) | `map/map-hud.tsx` | `data-testid="scale-bar"` |
| Panel del mapa del reporte cuando está pegajoso vs. en línea | `report/report-map.tsx` | `data-testid="report-map-sticky"` / `"report-map-inline"` |
| Hoja inferior móvil (`div[role=dialog][aria-label="Detalle"|"Capas"|"Análisis"]` — **el aria-label sirve**) | `ui/sheet.tsx` | — |
| Manija de la hoja inferior (`button[aria-label="Expandir panel"|"Contraer panel"]` — **sirve**) | `ui/sheet.tsx` | — |

---

## 3. Matriz de trazabilidad TC-01 … TC-48

Estados: **= igual** · **≈ cambiado** (mismo objetivo, otro mecanismo/otra pantalla) ·
**⊘ descartado a propósito** · **✗ NUEVAMENTE FALTANTE** (defecto para el orquestador).

| TC legacy | Estado | Equivalente en la app nueva | Cómo se valida |
|---|---|---|---|
| **TC-01** «Analizar zona» deshabilitado sin AOI | ≈ | No existe el botón: el análisis arranca solo al cerrar el polígono (`acceptAoi` en `index.tsx`). Lo que queda deshabilitado sin AOI: chip AOI (T-4), `Reporte` (T-9), `Exportar` (T-10), `Zoom al AOI` (M-6), tab móvil `Reporte`, y el botón `Descargar esta capa recortada al AOI` (C-14) | `/` sin `?aoi=`: verificar `disabled` en los 5 controles y `text=Sin AOI` |
| **TC-02** dibujar → banner «Polígono dibujado: {ha} ha» | ✗ | Se dibuja y se lanza el análisis (URL gana `?aoi=`), pero **no hay confirmación de área**: `index.tsx` pasa `areaHa={null}` al Topbar, así que el chip sigue diciendo `Sin AOI` después de dibujar | → **D-02** |
| **TC-03** subir GeoJSON válido → banner «Polígono cargado» | ✗ | Igual que TC-02: sube y analiza, sin confirmación de área | → **D-02** |
| **TC-04** archivo corrupto → traceback crudo | ⊘ **arreglado** | `AoiParseError` con mensaje en castellano → toast `title=No se pudo leer el archivo` + descripción. Nunca una excepción sin manejar | subir `.geojson` roto y verificar el toast |
| **TC-05** progreso secuencial + 4 métricas | ✗ | `AnalysisPanel` recibe `progress={[]}` y `cards={[]}`; la fase `analizando` nunca se activa. `useAnalysisProgress` / `useCancelAnalysis` existen y **nadie los llama** | → **D-01** y **D-03** |
| **TC-06** fallo de análisis → error + resultados previos visibles | ≈ | Refusal → toast `No se pudo analizar` con el mensaje del servidor. La regla «resultados previos siguen visibles» está **descartada a propósito** (el análisis es un objeto identificado por URL: no puede quedar desincronizado) | forzar rechazo (AOI >2000 ha sin confirmar) y verificar el toast |
| **TC-07** WDPA `available=false` → error | = | `SOURCE_DOWN_MESSAGES['areas-protegidas']` vía `protectedBanner` en `/reporte/{id}`, y chip `WDPA caído` en la fila de la capa | half B, sección `Áreas protegidas` |
| **TC-08** intersecta WDPA | = | `⚠️ El polígono SÍ intersecta un área de la WDPA:` + lista nombre · designación · solape ha/% | half B |
| **TC-09** WDPA cerca sin intersección | = | `No hay intersección, pero hay N área(s) WDPA a X m del polígono.` | half B |
| **TC-10** cero WDPA | = | `No se encontraron áreas protegidas (WDPA) cerca del polígono.` | half B |
| **TC-11** hidrología `available=false` | = | `SOURCE_DOWN_MESSAGES.hidrologia` vía `hydrologyBanner` | half B |
| **TC-12** hidrología intersecta | = | `⚠️ Hay un curso/cuerpo de agua de OSM que intersecta el polígono.` | half B |
| **TC-13** hidrología cerca | = | `No hay intersección, pero hay N elemento(s) de hidrología a X m.` | half B |
| **TC-14** cero hidrología | = | `No se encontró hidrología mapeada en OSM cerca del polígono.` | half B |
| **TC-15** prender DEM → overlay + slider habilitado | ≈ | Checkbox `Elevación (DEM)`; el slider vive detrás de ◐ (C-15) y está `disabled` si el checkbox está apagado | half A |
| **TC-16** «Opacidad DEM» deshabilitado por default | ≈ | Mismo comportamiento, con el slider colapsado | half A |
| **TC-17..20** repetir para Pendiente, NDVI, Densidad NDVI (default ON), WorldCover | ≈ | Etiquetas nuevas: `Pendiente (%)`, `NDVI (continuo)`, `Densidad de vegetación (clasificada)`, `Cobertura de suelo (WorldCover)`. **Qué capa arranca ON lo decide la VISTA**, no el registro: `topografia` → `Clases de pendiente`; `vegetacion` → `Densidad de vegetación (clasificada)` | half A, recorriendo las 5 vistas |
| **TC-21** hidro/AP se togglean, **sin** slider | ⊘ **mejorado a propósito** | Ahora **todas** las capas tienen control de opacidad (C-15/C-16). El caso legacy se invierte: verificar que el slider **existe** para `Hidrología (OSM)` y `Áreas protegidas (WDPA)` | half A |
| **TC-22** AOI fuera de RD → 5 tabs, sin MEPyD | ≈ | No hay tabs. Fuera de RD: la vista `Riesgo RD` **se oculta** del control segmentado, las 39 capas MEPyD (`requiresRd`) se filtran del panel, la sección `Contexto RD` no se construye en el reporte y `AnalysisPanel` imprime `Contexto RD no aplica: …`. **OJO**: `inRd` se calcula de `search.bbox`, que nunca se escribe → siempre `true` hoy (D-14) | half A + half B |
| **TC-23** AOI dentro de RD → 6 tabs | ≈ | Vista `Riesgo RD` presente, grupo `Contexto RD (MEPyD)` con 7 subgrupos y 39 capas, sección `Contexto RD` en el reporte | half A + half B |
| **TC-24** toggles MEPyD por capa, client-side, sin recarga | = | Checkbox por capa dentro del subgrupo; escribe `?layers=` con `navigate(replace:true)` — navegación de router, sin round-trip de datos. **Guard de regresión #6** | half A, §5 R-6 |
| **TC-25** todas las MEPyD vacías → «Sin resultados…» | = | `Sin resultados (servicios sin respuesta o sin elementos cerca del AOI).` en `ContextoRdSection` y en `mepydConclusions` | half B |
| **TC-26** costera off → «Escenario» y opacidad deshabilitados | ✗ | **No existe ninguna UI de escenario costero.** La capa `Inundación costera (WRI Aqueduct)` está en el registro y su fila muestra el chip `elegí escenario`, pero no hay `select` de preset ni forma de dispararlo. `useRequestCoastal` / `useCoastalPresets` existen y **nadie los llama** | → **D-15** |
| **TC-27** prender costera, preset nuevo → spinner | ✗ | idem | → **D-15** |
| **TC-28** `has_data=false` → warning sin overlay | ✗ (en el mapa) / ≈ (en el reporte) | El texto `No hay cobertura de datos de Aqueduct para esta zona.` existe en `coastalConclusions` y sale en `/reporte` **si el análisis ya tiene costera adjunta** — pero no hay forma de adjuntarla desde la UI | → **D-15** |
| **TC-29** `pct_area_flooded=0` → success con resolución | ≈ | `Sin inundación proyectada en el AOI para «{preset}» (resolución ~X m).` en `coastalConclusions` | half B, con costera sembrada en la base |
| **TC-30** `pct>0` → warning + overlay Blues + leyenda | ≈ | Conclusión `El escenario «{preset}» proyecta inundación sobre X % …` + `MetricCard` `Inundación proyectada — {preset}` | half B |
| **TC-31** preset ya visitado → sin spinner (cache) | ✗ | Sin UI de preset no hay cache que ejercitar. `useRequestCoastal` sí implementa `setQueryData` para evitar el round-trip | → **D-15** |
| **TC-32** barras de clases de pendiente con 4 etiquetas exactas | ≈ | `/reporte/{id}` sección `Topografía` → `MetricCard Clases de pendiente` → `DistributionChart` con `SLOPE_CLASSES` | half B |
| **TC-33** dos gráficos de vegetación, WorldCover disperso | ≈ | Sección `Vegetación`: `DistributionChart` de densidad (`sparse:false`) + de cobertura (`sparse:true` → clases ausentes **no** se listan) | half B |
| **TC-34** tabla de hidrología con osm_id/kind/name/distance | ≈ | Sección `Hidrología`, tabla con `OSM id · Tipo · Nombre · Distancia`; `Sin nombre en OSM` como fallback; `0 m (intersecta)` cuando ≤0 | half B |
| **TC-35** sin hidrología → «Sin elementos.» | = | `text=Sin elementos.` | half B |
| **TC-36** sin WDPA → «Sin áreas encontradas.» | = | `text=Sin áreas encontradas.` | half B |
| **TC-37** expander MEPyD `{label} ({count})` con columnas variables | = | `details > summary` con `{label} ({count})`; tabla de columnas dinámicas; tope de **10 filas** + `Mostrando N de M elementos. La tabla completa viaja en la exportación.` | half B |
| **TC-38** rama muerta «Sin atributos.» | = **preservada** | `columns.length === 0 → text=Sin atributos.` sigue existiendo defensivamente | half B (unit) |
| **TC-39** reporte Markdown con todos los headers | ≈ | El reporte es una **ruta**, no un tab: `/reporte/{id}` con 6–8 secciones. El Markdown se genera en `fetchReportMarkdown` con las secciones tildadas en el modal | half B |
| **TC-40** descargar `reporte_territorial.md` | ≈ | `Exportar → Impresión → Descargar reporte (Markdown)`; el nombre lo decide el servidor (`result.filename`), ya no es fijo | half B |
| **TC-41..44** 4 descargas GeoTIFF | ≈ | Dos caminos: (a) ⤓ por `MetricCard` en `/reporte` (`downloadForLayer` → `entry.raster_url` + `download_filename`); (b) `Exportar → Datos` → artefactos `raster:*` dentro del ZIP. Verificar firma `II*\0` / `MM\0*` | half B |
| **TC-45** **no** existe descarga de `aspect` | ⊘ **invertido a propósito** | `Orientación` es una capa del registro y un artefacto exportable (`raster:aspect`), **no preseleccionado** (`NOT_SELECTED_BY_DEFAULT`). El caso se invierte: verificar que aparece en `Exportar → Datos → Topografía` con el checkbox **apagado** | half B |
| **TC-46** sin resultados → solo caption de estado vacío | ≈ | `/` sin `?aoi=`: pestaña `Análisis` muestra `EmptyAoiState`; el mapa está vivo igual (el mapa **es** la página) | half A |
| **TC-47** desincronización AOI/resultados al redibujar | ⊘ **arreglado por diseño** | El mapa pinta `analysis.aoi_geometry` del análisis identificado en `?aoi=`. Redibujar lanza un análisis nuevo y cambia el id. Verificar que nunca conviven borde nuevo + overlays viejos | half A |
| **TC-48** cambiar de modo recuerda el AOI | ⊘ **N/A** | No hay radio de modo. Equivalente: recargar `/` con `?aoi=&theme=&layers=&op=&sel=` reconstruye exactamente el mismo mapa (§1.1 del brief) | half A |

### 3.1 Defectos derivados (lista para el orquestador)

| Id | Severidad | Defecto | Evidencia |
|---|---|---|---|
| **D-01** | **alta** | La fase `analizando` nunca se muestra: `index.tsx:187` pasa `phase={hasAoi ? 'listo' : 'sin-aoi'}` y `progress={[]}`. `useAnalysisProgress`, `useCancelAnalysis` y `AoiSizeGuard` quedan sin consumidor. Rompe TC-05 y todo el §8 «Analyzing» del brief | `routes/_app/index.tsx:185-207` |
| **D-02** | **alta** | `Topbar` recibe `areaHa={null}` siempre → el chip dice `Sin AOI` incluso con AOI, y **`Reporte` y `Exportar` quedan permanentemente deshabilitados** (`hasAoi = areaHa !== null`). Rompe TC-02, TC-03 y el acceso al reporte desde el mapa | `routes/_app/index.tsx:223-229`, `layout/topbar.tsx:48` |
| **D-03** | **alta** | `cards={[]}`: la pestaña `Análisis` nunca muestra métricas; siempre imprime `Todavía no hay resultados para la vista …` aunque el análisis haya terminado | `routes/_app/index.tsx:191` |
| **D-04** | media | Las 4 acciones del AOI (`Ver límites`, `Reemplazar`, `Descargar AOI`, `Borrar`) son no-op | `routes/_app/index.tsx:225` |
| **D-05** | media | `onOpenTable` es no-op: el link `Capa: {x} — N elementos` del inspector no lleva a ninguna tabla (§5.3 del brief) | `routes/_app/index.tsx:267` |
| **D-06** | media | `ServiceDownStrip` nunca se muestra: `incidents` se inicializa en `[]` y solo se limpia | `routes/_app/index.tsx:73, 175-177` |
| **D-07** | media | La pestaña `Rápido` del modal siempre muestra el fallback: `index.tsx` no pasa `onCaptureMap` | `routes/_app/index.tsx:329-339` |
| **D-08** | media | Los cortes de clase editables (C-18/C-19) guardan estado local pero **no reclasifican nada**: `thresholds` no llega al mapa ni al servicio | `routes/_app/index.tsx:178-180`; ver también la nota de `layer-runtime.ts` sobre `slope-classes` |
| **D-09** | baja | El handle `⠿` promete reordenar z-order y no hay drag implementado | `layers/layer-row.tsx:82-88` |
| **D-10** | baja | `Ver huellas de escenas Sentinel-2` guarda estado y no dibuja nada | `routes/_app/index.tsx:70, 181` |
| **D-11** | media | El dropzone del panel ofrece «SHP zipeado» y acepta `.zip`, formato que `parseAoiFile` rechaza (contradice `aoi-upload.tsx`, que solo ofrece KML/KMZ/GeoJSON) | `states/empty-aoi.tsx` vs `map/aoi-upload.tsx:30-31` |
| **D-12** | media | `Medir` y `Comparar capas` existen en la toolbar, se marcan `aria-pressed` y no hacen nada | `layout/map-toolbar.tsx:53-72`, sin consumidor en `map-canvas.tsx` |
| **D-13** | baja | La escala del cúmulo inferior izquierdo está hardcodeada a `— m` | `routes/_app/index.tsx:324` |
| **D-14** | media | `inRd` se deriva de `search.bbox`, pero `onBboxChange` es no-op → `bbox` nunca se escribe → `inRd` es siempre `true`. La vista `Riesgo RD` y las 39 capas MEPyD se ofrecen aun con AOI fuera de RD | `routes/_app/index.tsx:77, 293` |
| **D-15** | **alta** | **No existe UI de inundación costera**: sin checkbox de escenario, sin `select` de preset, sin disparo de `useRequestCoastal`. Rompe TC-26..TC-31 y deja la capa `aqueduct` inalcanzable | ningún componente importa `useRequestCoastal` / `useCoastalPresets` |
| **D-16** | **alta** | **No hay «Cerrar sesión» en ninguna pantalla.** `signOut` existe en `lib/session.ts` y en `webAuthBoundary`, y ningún componente lo llama | `grep -rn signOut apps/web/src/components` → 0 resultados |
| **D-17** | media | `sections.map(async (section) => await renderSection(section))` en `report-body.tsx:327` renderiza **Promises** como hijos de React. Puede romper el render del reporte en cliente. **Verificar en runtime antes que nada en el half B** | `report/report-body.tsx:327` |
| **D-18** | baja | `LegendStack` declara la prop `renderedLayers` (documentada como esencial para no mostrar leyenda sin píxeles) y **no la usa**: dibuja leyenda de toda capa visible | `layers/legend-stack.tsx:41-48` |
| **D-19** | baja | `ExportChip` es un componente muerto: nadie lo importa (el chip del topbar se dibuja inline con `exportJob`, que siempre es `null`) | `download/export-chip.tsx` |
| **D-20** | baja | El tab móvil `Reporte` cambia `mobileTab` pero no navega a `/reporte/{id}` | `layout/app-shell.tsx:103-112` |

---

## 4. Casos de prueba nuevos (comportamiento que el legacy no tenía)

### 4.1 Autenticación y protección SSR

| # | Precondición | Pasos | Esperado |
|---|---|---|---|
| **N-01** | Sin sesión | `GET /` con JS deshabilitado | **HTTP 302/307** a `/login?redirect=%2F`. **Cero HTML de shell logueado** en el cuerpo de la respuesta |
| **N-02** | Sin sesión | Navegar a `/` con JS | Se pinta `/login` directo; **nunca** aparece el topbar `Territorio Base` + `Vista` y luego desaparece (sin flash). Comprobar con `puppeteer_evaluate` sobre `MutationObserver` o screenshot en `domcontentloaded` |
| **N-03** | Sin sesión | `GET /reporte/abc123` | Redirect a `/login?redirect=%2Freporte%2Fabc123`; tras loguearse aterriza en `/reporte/abc123` |
| **N-04** | Sin sesión | `/login?redirect=https://evil.example` → login | Aterriza en `/`, **no** en el host externo (`safeRedirectPath`) |
| **N-05** | Sin sesión | `/login?redirect=//evil.example` y `/login?redirect=/\evil.example` | Idem N-04 |
| **N-06** | Sin sesión | Login con contraseña incorrecta | `p[role=alert]` con `Email o contraseña incorrectos.`; los dos campos con `aria-invalid` |
| **N-07** | Con sesión | Navegar a `/login` | Redirect inmediato a `/` (`redirectIfSignedIn`) |
| **N-08** | Con sesión | Navegar a `/register` | Redirect a `/` |
| **N-09** | Sin sesión, código válido | `/register` con Nombre/Email/Contraseña ≥8/Código → `Crear cuenta` | Cuenta creada, sesión iniciada, aterriza en `/` |
| **N-10** | Código ya usado | Reintentar con el mismo código | `Ese código de invitación ya fue usado.`; el campo del código con `aria-invalid` |
| **N-11** | Código inexistente | `Crear cuenta` | `El código de invitación no existe.` |
| **N-12** | Código válido con formato «humano» | Tipearlo en minúsculas, con guiones, y con `I`/`O`/`L`/`U` en lugar de `1`/`0`/`1`/`V` | Se acepta igual (`normalizeInviteCode` pliega los confusables de Crockford) |
| **N-13** | Email ya registrado | `Crear cuenta` | `Ya hay una cuenta con ese email.` |
| **N-14** | Contraseña de 7 chars | `Crear cuenta` | `La contraseña tiene que tener al menos 8 caracteres.` |
| **N-15** | `?invite=CODIGO` en la URL | Abrir `/register?invite=XXXX` | El campo `Código de invitación` llega **prellenado** |
| **N-16** | Con sesión de usuario A | Abrir `/reporte/{analysisId de B}` | `No existe ese análisis, o no es tuyo.` — nunca el análisis ajeno (`readOwned` scopea por `user_id`) |
| **N-17** | Con sesión de A | `GET /descargas/{jobId de B}/zip` | **404** con texto plano, no el bundle |
| **N-18** | Sin sesión | `GET /descargas/{jobId}/zip` | **401** `Iniciá sesión para descargar este bundle.` |
| **N-19** | Job `generando` | `GET /descargas/{jobId}/zip` | **409** (reintentable), distinto del 404 |
| **N-20** | — | Buscar cualquier control de cierre de sesión | **Falla hoy** → D-16 |

### 4.2 Inspector de features

| # | Pasos | Esperado |
|---|---|---|
| **N-21** | Vista `Hidrología`, click sobre un río | Inspector abre con el **nombre del río** en `h2`, subtítulo `{Tipo} · OSM {id}`, campos `Nombre`, `Tipo` (traducido a `Curso de agua`/`Cuerpo de agua`/`Humedal`, **nunca** `waterway`), `Distancia al AOI`. URL gana `?sel=osm-hydro:osm-{id}` |
| **N-22** | Río sin `name` en OSM | `h2` = `Sin nombre` (texto exacto) |
| **N-23** | Click donde se solapan ≥2 capas (p. ej. `wdpa` + una MEPyD de `Amenazas`) | Inspector muestra `Resultados` con **una fila por capa** y su conteo, **sin elegir ganador**, y `?sel=` **no** se escribe |
| **N-24** | Desde la pila, click en un candidato | Entra al feature de esa capa; aparece `Volver a los resultados`; `?sel=` se escribe |
| **N-25** | `Volver a los resultados` | Vuelve a la pila; `?sel=` se limpia |
| **N-26** | Vista `Áreas protegidas`, click en un polígono WDPA | `Categoría UICN` muestra la etiqueta expandida (`II · Parque nacional`), **nunca** `II` crudo; `Solape con el AOI`, `Solape (% del AOI)` y `Distancia al AOI` presentes |
| **N-27** | Click en una capa MEPyD (atributos dinámicos) | Además del campo aliaseado `Nombre`, se listan **todas** las columnas que devolvió el FeatureServer con su nombre crudo como etiqueta. `__tbid` **no** aparece. Enteros sin separador de miles (`OBJECTID 1240`, no `1 240`); decimales con formato español |
| **N-28** | Pestaña `Fuente` del inspector | Link a la fuente (`target=_blank rel="noreferrer noopener"`), método, `vigencia · resolución · licencia`, cita |
| **N-29** | `Zoom a la geometría` | El mapa encuadra el feature seleccionado con el padding del layout (no lo deja bajo un panel) |
| **N-30** | Copiar la URL con `?sel=` y abrirla en una pestaña nueva | El inspector abre **en el mismo feature** sin haber hecho click (reconstrucción desde el GeoJSON en memoria) |
| **N-31** | `?sel=` con un `layerId` inexistente | `parseSelection` devuelve `null`: el inspector no abre y la app no rompe |
| **N-32** | Cerrar con `button[aria-label="Cerrar detalle"]` | `?sel=` desaparece de la URL |

### 4.3 Estado en la URL

| # | Pasos | Esperado |
|---|---|---|
| **N-33** | Prender 3 capas, bajar una opacidad, cambiar de vista | `?layers=` con los ids csv, `?op=` solo con las opacidades **distintas del default**, `?theme=` con la vista |
| **N-34** | Copiar la URL completa y abrirla en otra pestaña | El mapa se reconstruye idéntico: mismas capas, mismas opacidades, misma vista, mismo panel |
| **N-35** | Toggle de capa | La navegación usa `replace:true` → el botón **Atrás** del navegador no recorre toggle por toggle |
| **N-36** | Id MEPyD en `?op=` (contiene `:` interno, p. ej. `mepyd:agua/rios-y-arroyos:0.4`) | Se parsea bien (split por el **último** `:`) |
| **N-37** | `?theme=basura` | `.catch(DEFAULT_VISTA)` → cae a `topografia` sin romper |
| **N-38** | `?layers=` con un id inexistente | El id se descarta silenciosamente; el resto se aplica |
| **N-39** | Cambiar de vista con una capa de **contexto** prendida a mano | La capa sobrevive y muestra el alfiler `Prendida a mano: sobrevive el cambio de vista`; las capas de **medición** de la vista anterior se apagan |
| **N-40** | Prender 5 capas de datos | Solo entran 4 (`MAX_VISIBLE_DATA_LAYERS`); aparece `Tope de 4 capas de datos visibles alcanzado. Apagá una para prender otra.`; el AOI **no** consume cupo |

### 4.4 Story map (`/reporte/$analysisId`)

| # | Pasos | Esperado |
|---|---|---|
| **N-41** | Cargar con JS deshabilitado | El reporte se pinta **completo** desde SSR (portada, conclusiones, tablas, fuentes). El mapa muestra su esqueleto (`Cargando las geometrías del análisis…`) |
| **N-42** | Scrollear hasta cruzar el 55 % del viewport con la sección `Vegetación` | La píldora `Vegetación` del `nav` gana `aria-current="true"` y el mapa pegajoso cambia de capas/encuadre/basemap (a `satellite`) |
| **N-43** | Scrollear hacia **arriba** | El estado del mapa **vuelve** al de la sección anterior sin desincronizarse (coreografía declarativa, no órdenes imperativas) |
| **N-44** | Scroll rápido saltando 3 secciones | Gana la **última** sección en orden de documento que cruza la línea; nunca queda un estado intermedio pegado |
| **N-45** | `prefers-reduced-motion: reduce` | El paso cambia **de golpe** (sin `transition-opacity`), pero las mismas capas y el mismo encuadre: la coreografía es contenido, no animación |
| **N-46** | Click en `ver el cauce más cercano` | `aria-pressed=true`; el mapa encuadra el elemento de agua más cercano y el caption dice `Encuadre en el elemento de agua más cercano (…)`. Segundo click revierte |
| **N-47** | Click en `ver el solape` | `aria-pressed=true`; caption `Áreas protegidas que se solapan con el polígono, resaltadas.` |
| **N-48** | El override queda fijado y se scrollea a otra sección | El override **caduca** al cambiar de paso (se guarda junto al paso donde se fijó) |
| **N-49** | Click en ⤢ de una `MetricCard` | El mapa pegajoso salta al estado de esa sección |
| **N-50** | `Cambiar de lado` | Narrativa y mapa intercambian columnas (`md:flex-row-reverse`) |
| **N-51** | Análisis con ≥1 fuente caída | Arriba de la narrativa aparece `Reporte parcial: N fuente(s) no respondieron.` con la lista servicio → error |
| **N-52** | Sección `Fuentes` | Tabla con **una fila por dataset efectivamente usado** (no el catálogo completo) + bloque `No disponibles en esta corrida` con motivos |
| **N-53** | `analysisId` inexistente | `NoDataCard` `Reporte no disponible` con `No existe ese análisis, o no es tuyo.` y botón `Volver a intentar` |
| **N-54** | Análisis todavía corriendo | `El análisis todavía no terminó` |
| **N-55** | Análisis fuera de RD | **No** existe `section#seccion-contexto-rd`; el `nav` tiene una píldora menos |
| **N-56** | Análisis sin costera | **No** existe `section#seccion-riesgo-costero` |
| **N-57** | — | Verificar D-17: que el reporte efectivamente renderice las secciones en cliente y no un árbol vacío/roto por el `map(async …)` |

### 4.5 Vista de impresión

| # | Pasos | Esperado |
|---|---|---|
| **N-58** | Abrir `/reporte/{id}/imprimir` | Cada mapa es un **SVG estático** (`svg[role=img]`), **sin canvas WebGL**: `document.querySelectorAll('canvas').length === 0` |
| **N-59** | `puppeteer_evaluate` con `matchMedia('print')` / emular media `print` | La barra superior (`.no-print`) desaparece; `thead.print-running-header` y `tfoot.print-running-footer` pasan a `display: table-header-group/footer-group` |
| **N-60** | Emular `print` con el sistema en **modo oscuro** | Fondo blanco y tinta oscura: los tokens se redefinen en los tres selectores (`:root`, `:root:not([data-theme=light])`, `:root[data-theme=dark]`) |
| **N-61** | Emular `print` | `#seccion-fuentes` tiene `break-before: page` |
| **N-62** | Emular `print` | Los `details` de MEPyD se imprimen **abiertos** (`open={print}` + `details > div { display: block }`) |
| **N-63** | Emular `print` | Ninguna tabla se recorta: los contenedores `overflow-x-auto` pasan a `overflow: visible` |
| **N-64** | Emular `print` | Los links externos muestran su URL entre paréntesis; los anclas internos (`href^="#"`) **no** |
| **N-65** | `button text=Imprimir o guardar como PDF` | Dispara `window.print()` (interceptable con `puppeteer_evaluate` reemplazando `window.print`) |
| **N-66** | Membrete y pie | `Territorio Base — Reporte territorial · {ha} · EPSG:{n} · análisis {id}` y `Generado el {dd/mm/aaaa} · Fuentes y licencias en la última sección · territorio-base` |

### 4.6 Exportación asíncrona y contenido del bundle

| # | Pasos | Esperado |
|---|---|---|
| **N-67** | Abrir el modal (vía ⓘ → `Descargar esta capa recortada al AOI`, o vía el inspector) | Se abre en la pestaña **`Datos`**; título `Exportar`; descripción `{aoiName} · {ha} · EPSG:{utm}` |
| **N-68** | Ver la lista de artefactos | Grupos en el orden `Documentos · Área de estudio · Topografía · Vegetación · Hidrología · Áreas protegidas · Riesgo costero · Contexto RD (MEPyD)`; MEPyD (>8 filas) arranca **colapsado** |
| **N-69** | Ver `Documentos` | `LEEME.txt` y `FUENTES.txt` con badge `siempre` y **sin checkbox**; `reporte.md` y `resumen.csv` tildados y destildables |
| **N-70** | Ver `Área de estudio` | `Límite del AOI` con badge `siempre` y razón `Va siempre: sin el polígono, ningún otro archivo del ZIP se puede ubicar.` |
| **N-71** | Análisis con Overpass caído | Fila `Hidrología (OSM)` **gris, sin checkbox, con badge `no disponible`** y el motivo escrito. **No se filtra de la lista** |
| **N-72** | Análisis sin costera explorada | `Inundación costera (WRI Aqueduct)` gris con `Todavía no se exploró la inundación costera en este análisis: prendé la capa en el mapa y elegí un escenario.` (que hoy es imposible → D-15) |
| **N-73** | AOI fuera de RD | Una sola fila `Contexto RD (MEPyD)` con `El AOI está fuera de República Dominicana: no se consultaron los servicios MEPyD.` |
| **N-74** | `Todas` / `Ninguna` en un grupo | Tilda/destilda todos los seleccionables de ese grupo; el contador `n/m` se actualiza |
| **N-75** | Cambiar `CRS de salida` a UTM | La leyenda explica que los `.geojson` van **siempre** en EPSG:4326 (RFC 7946) y los GeoTIFF en la UTM local |
| **N-76** | Destildar todo lo seleccionable | `Exportar` queda `disabled` (`dataCount === 0`) |
| **N-77** | Seleccionar las 39 capas MEPyD sobre un AOI grande | Aviso `Esto va a tardar` o `Selección demasiado grande`; solo el primero ofrece `Exportar igual` |
| **N-78** | `Exportar` | Navega a `/descargas/{jobId}`; el modal se cierra |
| **N-79** | En `/descargas/{jobId}` mientras genera | Badge `generando`; `div[role=progressbar]` con `aria-valuenow` que **avanza**; `Exportando… n/m`; cronómetro corriendo; botón `Descargar bundle` **deshabilitado**; botón `Cancelar` presente |
| **N-80** | Recargar `/descargas/{jobId}` a mitad de camino | El progreso se reconstruye desde el servidor: nada vive en memoria del cliente |
| **N-81** | Job terminado | Badge `listo`; el polling **se detiene** (verificar con `puppeteer_evaluate` contando requests, o `read_network_requests`); aparece `a text=Descargar bundle ({tamaño})` |
| **N-82** | Job con un artefacto en error | Badge `listo con faltantes`; aviso `El bundle está incompleto`; la fila roja tiene `Reintentar`; **el resto de las filas sigue en verde** y el ZIP se puede bajar igual |
| **N-83** | `Reintentar` en esa fila | La fila pasa a `generando` y luego a `listo`; el `LEEME.txt` se **reescribe** (ya no puede decir que esa capa falta) |
| **N-84** | Artefacto `omitido` | **No** tiene botón `Reintentar` (reintentar daría lo mismo) |
| **N-85** | `Cancelar` | Badge `cancelado` |
| **N-86** | Descargar el ZIP | `content-type: application/zip`, `content-disposition: attachment; filename="territorio-base_{slug}_{aaaa-mm-dd}.zip"`, `cache-control: no-store, private`, **sin `content-length`** (es un stream) |
| **N-87** | Abrir el ZIP | Contiene como mínimo `LEEME.txt`, `FUENTES.txt`, `vector/{aoi}.geojson` + `.shp/.shx/.dbf/.prj/.cpg`; con selección de rasters, `raster/*.tif`; con `reporte.md` y `resumen.csv` si se tildaron; `vector/campos_shapefile.csv` si hubo truncado de nombres DBF |
| **N-88** | `LEEME.txt` | Lista **archivo por archivo** su descripción y su CRS (`EPSG:4326 (WGS84)` para geojson, `EPSG:{utm}` para tif, el CRS elegido para shapefiles), los parámetros de la corrida (resolución NDVI, ventana S2, nubosidad, CRS de vectores, recorte al AOI) **y las omisiones con su motivo** |
| **N-89** | `FUENTES.txt` | Cita, licencia, endpoint y fecha de consulta de cada dataset incluido, más las omisiones |
| **N-90** | Bundle expirado (>1 h) | Badge `expirado`; `GET .../zip` da 404; la pantalla dice cómo volver a exportar |
| **N-91** | `jobId` inventado | `No encontramos ese trabajo` + `Ir al mapa` |
| **N-92** | `Impresión → Descargar reporte (Markdown)` | Se descarga un `.md` con las secciones tildadas; destildar `Contexto RD (MEPyD)` lo saca del archivo |

### 4.7 `/fuentes`

| # | Pasos | Esperado |
|---|---|---|
| **N-93** | Abrir `/fuentes` | `<title>` = `Fuentes y metodología · Territorio Base`; una ficha por **dataset** (no por capa): DEM, Sentinel-2, WorldCover, OSM/Overpass, WDPA, Aqueduct, MEPyD, AOI |
| **N-94** | Ficha del MEPyD | `Capas que la usan` = **39** (las 39 comparten fuente); `details` abre la lista completa de etiquetas |
| **N-95** | Ficha con caveat | Bloque ámbar `Límite conocido: …` |
| **N-96** | Índice de anclas | Cada chip del `nav[aria-label="Índice de fuentes"]` salta a su `article#fuente-{slug}` |
| **N-97** | Sección de exclusiones | Los **5** ítems, incluyendo `Mirror de Overpass overpass.osm.ch — excluido a propósito` y `URL muerta de Aqueduct` |
| **N-98** | Links de fuente | `target="_blank" rel="noreferrer noopener"` |
| **N-99** | Agregar una capa al registro (unit) | La fila nueva aparece en `/fuentes` **sin tocar** `fuentes.tsx` (§11) |

### 4.8 Responsive y hoja inferior

Cortes (`use-media-query.ts`): `mobile ≤767` · `tablet 768–1023` · `compact 1024–1279` ·
`standard 1280–1439` · `wide ≥1440`.

| # | Viewport | Esperado |
|---|---|---|
| **N-100** | 1440×900 (`wide`) | Panel izquierdo fijo 360 px + mapa + inspector acoplado 380 px, los tres a la vez |
| **N-101** | 1320×860 (`standard`) con inspector abierto | El panel izquierdo **se colapsa solo** a riel de 48 px; el botón dice `Expandir panel (se colapsó solo)`; al cerrar el inspector **se restaura** |
| **N-102** | 1320×860, colapsar a mano y cerrar el inspector | Sigue colapsado (el colapso manual gana) |
| **N-103** | 1150×800 (`compact`) | Panel izquierdo como `SideDrawer` con scrim **parcial**; botón flotante `Capas y análisis`; abrir el inspector **cierra** el drawer (un panel por vez) |
| **N-104** | 900×700 (`tablet`) | Drawer de 340 px con scrim **completo**; las vistas colapsan a `select` con label `Vista:`; los sliders muestran stepper `−`/`+` |
| **N-105** | 390×844 (`mobile`) | `nav[aria-label="Secciones"]` inferior de 56 px con `Capas · Análisis · Mapa · Reporte`; `Reporte` **deshabilitado** sin AOI |
| **N-106** | mobile, tap `Capas` | `BottomSheet` `role=dialog aria-label="Capas"` a `45vh`, **no modal**: el mapa de fondo sigue paneándose |
| **N-107** | mobile, tap en la manija | `aria-expanded` pasa a `true` y la hoja crece a `92vh`; `aria-label` cambia a `Contraer panel` |
| **N-108** | mobile, hoja `Capas` abierta y click en un feature del mapa | La hoja `Capas` **se reemplaza** por la hoja `Detalle`: **nunca hay dos hojas apiladas** |
| **N-109** | mobile | La hoja tiene manija **Y** `button[aria-label="Cerrar"]` de 44×44 px (nunca solo swipe) |
| **N-110** | mobile | La leyenda del mapa arranca **colapsada** y no hay `MapReadout` (coordenadas) |
| **N-111** | mobile, `/reporte/{id}` | **No** hay mapa pegajoso: cada sección lleva su mapa **en línea** arriba (`md:hidden`). Nunca dos mapas simultáneos |
| **N-112** | cualquier viewport | El `body` **no** scrollea horizontalmente; las tablas anchas scrollean dentro de su contenedor |

### 4.9 Accesibilidad por teclado

| # | Pasos | Esperado |
|---|---|---|
| **N-113** | Tab desde el inicio en `/` | Orden lógico: topbar → panel → mapa → toolbar. Todo control alcanzable tiene nombre accesible (`IconButton` exige `label`) |
| **N-114** | Foco en el control segmentado de vistas, `→` / `←` | Cambia de vista; solo el radio seleccionado tiene `tabIndex=0` (roving tabindex) |
| **N-115** | Foco en las pestañas `Capas`/`Análisis`, `→` / `←` | Cambia de pestaña; mismo patrón roving |
| **N-116** | Foco en las pestañas del inspector, `→` / `←` | Cambia entre `Atributos` y `Fuente` |
| **N-117** | Foco en el mapa (`role=application`) | El lector anuncia `#tb-map-help`; **flechas** desplazan y **+ / −** hacen zoom (`keyboard: true` en MapLibre, `maxPitch: 0`) |
| **N-118** | Modo dibujo, `Enter` con ≥3 vértices | Cierra el polígono sin tener que apuntarle al primer vértice |
| **N-119** | Modo dibujo, `Escape` | Cancela y limpia; la herramienta se desactiva |
| **N-120** | Modo dibujo, `Backspace` / `Delete` | Deshace el último vértice |
| **N-121** | Modal de exportación abierto, `Tab` repetido | El foco **no sale** del diálogo (`useFocusTrap`) |
| **N-122** | Modal abierto, `Escape` | Cierra |
| **N-123** | Popover ⓘ abierto, `Escape` / click afuera | Cierra y **devuelve el foco al disparador**; el foco **no** queda atrapado (es popover, no modal) |
| **N-124** | Checkbox de capa con `Espacio` | Togglea (es un `input` nativo con el cuadro pintado por `peer`) |
| **N-125** | Slider de opacidad con `←`/`→` | Cambia de a `step` (0,05) |
| **N-126** | Acordeón de grupo con `Enter`/`Espacio` | `aria-expanded` cambia y el contenido deja de estar `hidden` |
| **N-127** | Toast de error | `output[aria-live="assertive"]`; los demás `polite`; `button[aria-label="Descartar notificación"]` |
| **N-128** | Gráficos del reporte | Cada uno trae su `figcaption.sr-only` con el equivalente de texto completo (`chartTextEquivalent`) |
| **N-129** | Leyenda del mapa | Cada bloque tiene un `span.sr-only` con `describeResolvedLegend`; los swatches son `aria-hidden` |
| **N-130** | Contraste | Verificar los pares token/token en modo claro **y** oscuro (`styles.css`); ningún color es el único portador de información (siempre hay texto/badge al lado) |

---

## 5. Guardas de regresión (inventario §9)

Nueve regresiones, con una comprobación concreta y ejecutable cada una.

### R-1 — Orientación del raster: **fila 0 = NORTE, sin flip**

*Dónde vive*: `components/map/overlays.ts` (`coordinatesFromBounds`, `coordinatesOf`),
`services/api/src/territorio_base_api/render/overlay.py`.

**Comprobaciones:**

1. **Contrato**: `GET {API_URL}/analysis/{id}/overlay/dem.json` → verificar
   `coordinates[0] === [bounds[0], bounds[3]]` (oeste, **norte**) y
   `coordinates[2] === [bounds[2], bounds[1]]` (este, sur). El orden es **TL, TR, BR, BL**.
2. **Cliente**: en el browser, `coordinatesFromBounds([w,s,e,n])` debe dar exactamente lo mismo que
   `X-Overlay-Coordinates`. Ningún `reverse()`, ningún `flipud` en el camino.
3. **Visual**: sobre un AOI con desnivel real (≥300 m), prender `Elevación (DEM)` al 100 % sobre el
   basemap `Relieve (OpenTopoMap)` y confirmar que los valles del PNG caen sobre los valles del
   basemap. **Trampa documentada**: comparar la luminancia de la primera fila contra la última
   **no sirve** — la rampa `terrain` no es monótona en luminancia y da un signo arbitrario.
4. **Fallo esperado si se rompe**: correlación DEM↔PNG de −0,54 en vez de +1,00.

### R-2 — Overpass: fallback multi-mirror con proveedores independientes

*Dónde vive*: `packages/geo/src/sources/overpass.ts`.

1. `OVERPASS_MIRRORS` tiene **5** URLs: `overpass-api.de`, `z.overpass-api.de`,
   `lz4.overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee` — **dos proveedores
   genuinamente independientes**.
2. `EXCLUDED_MIRRORS` contiene `overpass.osm.ch` con su motivo, y ese motivo se **publica** en
   `/fuentes` (`text=Mirror de Overpass \`overpass.osm.ch\` — excluido a propósito`).
3. Un mirror que responde **200 con 0 resultados** no puede tratarse como éxito.
4. Con los 5 caídos: `hydrology.available = false` y **el resto del análisis se completa**.

### R-3 — Aislamiento de fallas: «no se pudo consultar» **nunca** se lee como «no hay»

*Dónde vive*: `report/narrative.ts` (`branchOf`, `hydrologyBanner`, `protectedBanner`),
`layers/layer-runtime.ts`, `lib/export-contract.ts`, `report/report-model.ts::datasetUsage`.

Con `available: false` (fuente caída) vs. `found: 0` (consultó y no hay), en **cinco lugares**:

| Lugar | `available: false` | `found: 0` |
|---|---|---|
| Banner del reporte | tono **danger** + `SOURCE_DOWN_MESSAGES.*` | tono **success** + `No se encontró hidrología mapeada en OSM cerca del polígono.` / `No se encontraron áreas protegidas (WDPA) cerca del polígono.` |
| Conclusiones | «Es una falta de dato, no una ausencia de agua» | «Overpass respondió correctamente y no hay hidrología…» |
| Resumen ejecutivo (portada) | valor literal **`No se pudo consultar`** + nota `Overpass sin respuesta` | `Sin elementos en 500 m` / `Sin áreas en 1 km` |
| Fila del panel de capas | chip **rojo** `Overpass caído` / `WDPA caído` / `MEPyD caído` + `reintentar` | chip **gris** `sin datos` con `title=El servicio respondió, y dentro de este AOI no hay nada de esta capa.` |
| Modal de exportación | fila gris con el motivo del servicio, `no disponible` | fila gris con `Se consultó Overpass y no hay hidrología cerca del AOI.` |

**Además**: la tabla de fuentes del reporte lista los caídos bajo `No disponibles en esta corrida`
con la frase `Lo que no aparece en el reporte por su ausencia es un dato faltante, no una ausencia
de elementos en el terreno.`; y el `LEEME.txt` del ZIP repite las omisiones con su motivo.

**Test negativo**: buscar en toda la UI de un análisis con Overpass caído la cadena `0` o
`Sin elementos` presentada como resultado de hidrología. **Debe fallar** — no debe encontrarse.

### R-4 — Relleno bajo + borde fuerte en polígonos de amenaza superpuestos

*Dónde vive*: `components/map/layer-style.ts` (`fillFactorOf`, `outlineWidth`),
`layers/mepyd.ts::fillFactorFor`.

1. `fillFactorFor('vector-polygon') === 0.12` para las 39 capas MEPyD; WDPA usa `0.5`; el AOI usa
   `0` (es borde, no mancha).
2. El borde se dibuja **en una capa aparte** (`tb-outline:{id}`, `line-width: 2.5`,
   `line-opacity: {opacity}` completa), **nunca** con `fill-outline-color` — que heredaría la
   opacidad del relleno y desaparecería justo cuando hace falta.
3. **Prueba visual**: prender a la vez `Amenaza de deslizamiento`, `Área propensa a inundación` y
   `Área propensa a tsunami` (los tres presets de la vista `Riesgo RD`). Los tres bordes deben
   distinguirse y cada color debe corresponder a **una** entrada de leyenda. No debe verse un blob
   de un solo color.
4. **Sin closure tardío**: cada capa se construye desde su propio `LayerDef` pasado por argumento;
   no hay loop que capture variables. Verificar que los colores del mapa coinciden **uno a uno** con
   los swatches del panel (no todos iguales al de la última capa).

### R-5 — Puntos como **círculos**, nunca pines

*Dónde vive*: `components/map/layer-style.ts` (`case 'vector-point'`).

1. La única capa de estilo emitida es `{ type: 'circle', id: 'tb-point:{layerId}' }`. **Cero**
   `type: 'symbol'`, **cero** `new maplibregl.Marker`, **cero** `<img>` de pin en el DOM del mapa.
2. `circle-radius` interpola por zoom (2,5 → 4 → 6) y `circle-color` sale de la capa.
3. **Prueba de densidad**: prender `Infraestructuras y edificaciones → Infraestructura de salud`
   (~1600 puntos) y `Vías → Puentes`. El mapa debe seguir siendo legible y fluido; los dos colores
   deben ser distintos entre sí.
4. Comprobación en runtime:
   `map.getStyle().layers.filter(l => l.id.startsWith('tb-point:')).every(l => l.type === 'circle')`.

### R-6 — Toggle de capas **100 % del lado del cliente**

*Dónde vive*: `components/map/layer-sync.ts`, `routes/_app/index.tsx::handleToggle`.

1. Prender/apagar una capa MEPyD **no** dispara ninguna petición al servidor: capturar la red con
   `read_network_requests` alrededor del click y verificar **cero** requests a `/_serverFn/*`,
   cero navegación de documento (`performance.getEntriesByType('navigation').length` no aumenta).
2. Los tiles del basemap **no** se vuelven a pedir (el estilo no se recrea).
3. El toggle es **por capa**, no por grupo: tildar `Amenaza de deslizamiento` no tilda el resto de
   `Amenazas`.
4. La URL cambia con `replace:true` (no crece el historial).

### R-7 — Un color **por capa**, no por grupo

*Dónde vive*: `layers/palettes.ts::mepydColor`, `layers/mepyd.ts` (`MEPYD_LAYERS.map((row,index)=>…)`).

1. La paleta `MEPYD_QUALITATIVE` tiene **12** colores y se cicla por **índice plano** sobre las 39
   capas → capas **adyacentes** (dentro del mismo subgrupo) **siempre** tienen colores distintos.
2. En el panel: los swatches de las 10 capas de `Amenazas` deben ser 10 colores distintos.
3. En el mapa: los `line-color` de sus `tb-outline:*` deben coincidir uno a uno con esos swatches.
4. Repetición aceptada: los índices 0 y 12 comparten color, pero caen en subgrupos distintos.

### R-8 — Parser KML/KMZ como dependencia **explícita**

*Dónde vive*: `packages/geo/package.json`, `packages/geo/src/aoi.ts`.

1. `dependencies` declara `@tmcw/togeojson`, `@xmldom/xmldom` y `jszip` (todas por `catalog:`).
2. Subir un `.kml` válido → AOI cargado. Subir un `.kmz` válido → AOI cargado.
   **Nunca** un `ModuleNotFoundError` equivalente ni un error de import en consola.
3. Subir un archivo corrupto → `AoiParseError` con mensaje en castellano en un toast; **cero**
   excepciones sin manejar en la consola del browser.
4. Subir un archivo >10 MB → `El archivo pesa X y el máximo es 10,0 MB.` **antes** de parsear.

### R-9 — Dependencias desde una sola fuente de verdad

1. `pnpm install --frozen-lockfile` en limpio: **sin drift**.
2. Las versiones se declaran con el protocolo `catalog:` en `pnpm-workspace.yaml`; ningún paquete
   fija una versión suelta que pueda divergir.
3. `pnpm typecheck && pnpm lint && pnpm test && pnpm build` en verde antes de dar por buena la
   validación funcional.

---

## 6. Orden de ejecución para el validador Puppeteer

Regla del inventario, mantenida: **cada caso se valida dos veces antes de pasar al siguiente**.
Ante un fallo, capturar screenshot + consola (`read_console_messages`) + red
(`read_network_requests`) antes de seguir.

Los dos halves son independientes y se pueden correr en paralelo contra dos servidores distintos
(§0.2). Dentro de cada half, el orden es de precondición a dependiente.

### Half A — auth + shell + mapa + inspector (servidor `:3000`)

| Fase | Bloque | Casos | Bloquea a |
|---|---|---|---|
| **A0** | Humo y build | R-9 · `/` sin sesión responde redirect | todo |
| **A1** | Protección SSR (sin JS) | N-01, N-03, N-04, N-05 | A2 |
| **A2** | Registro con invitación | N-09, N-15, N-10, N-11, N-12, N-13, N-14 | A3 |
| **A3** | Login / logout | N-02 (sin flash), N-06, N-07, N-08, **N-20 (D-16)** | A4 |
| **A4** | Shell vacío | TC-01, TC-46, N-100 (layout `wide`), A-1..A-5, P-1..P-7 | A5 |
| **A5** | Dibujo del AOI | TC-02, N-118, N-119, N-120, rectángulo, `Esc`, cierre por primer vértice y por doble click | A6 |
| **A6** | Subida del AOI | TC-03, TC-04, R-8 (KML/KMZ/>10 MB/corrupto), drag & drop sobre el mapa, D-11 | A7 |
| **A7** | Fase de análisis | **TC-05 (falla → D-01)**, TC-06, A-6..A-11 (inalcanzables → D-01), guards de tamaño | A8 |
| **A8** | Panel de capas | C-1..C-21, TC-15..TC-20, TC-21, N-40 | A9 |
| **A9** | Vistas y presets | TC-22, TC-23 (**+ D-14**), N-39, T-2/T-3 | A10 |
| **A10** | Estado en la URL | N-33..N-38, TC-48 | A11 |
| **A11** | MEPyD en el mapa | TC-24, **R-6**, **R-4**, **R-5**, **R-7** | A12 |
| **A12** | Overlays raster | **R-1** (contrato + visual), TC-47, leyenda dinámica de WorldCover e hidrología, D-18 | A13 |
| **A13** | Inspector | N-21..N-32 | A14 |
| **A14** | Mapa base y HUD | M-1..M-6 (**D-12**), selector de basemap ×3, `Leyenda compacta`, D-13, MapReadout | A15 |
| **A15** | Topbar y modal desde el mapa | **T-9/T-10 (D-02)**, T-5..T-8 (**D-04**), I-12 (**D-05**), E-5 (**D-07**), S-1 (**D-06**), **D-15 (costera ausente)** | — |
| **A16** | Teclado (mapa/panel) | N-113..N-120, N-124..N-127, N-129 | — |

### Half B — reporte + descargas + fuentes + responsive (servidor `:3001`)

Precondición: sembrar en `data/territorio-b.db` **cuatro** análisis terminados y anotar sus ids:
`B-ok` (dentro de RD, todo disponible) · `B-caido` (Overpass + WDPA `available:false`) ·
`B-vacio` (0 features en todo) · `B-fuera` (fuera de RD, sin costera). Opcionalmente `B-costera`
(con `coastal` adjunta) para TC-29/TC-30, ya que **la UI no puede generarla** (D-15).

| Fase | Bloque | Casos | Bloquea a |
|---|---|---|---|
| **B0** | Humo del reporte | **N-57 (D-17)** — si el reporte no renderiza, todo el half B queda bloqueado | todo |
| **B1** | Reporte SSR | N-41, N-53, N-54 | B2 |
| **B2** | Banners de 4 estados | **TC-07..TC-14** sobre `B-ok`, `B-caido`, `B-vacio` | B3 |
| **B3** | Conclusiones y R-3 | **R-3** (los 5 lugares), N-51, N-52 | B4 |
| **B4** | Secciones y tablas | TC-32, TC-33, TC-34, TC-35, TC-36, TC-37, TC-38 | B5 |
| **B5** | Secciones condicionales | TC-22/TC-23 en el reporte, N-55, N-56, TC-25 | B6 |
| **B6** | Coreografía del scroll | N-42..N-50 | B7 |
| **B7** | Descargas por tarjeta | TC-41..TC-44 (⤓ de `MetricCard`, firma GeoTIFF), estado deshabilitado con su motivo | B8 |
| **B8** | Vista de impresión | N-58..N-66 | B9 |
| **B9** | Modal de exportación | N-67..N-77, **TC-45** (aspect presente y **no** preseleccionado) | B10 |
| **B10** | Job de exportación | N-78..N-86, N-90, N-91 | B11 |
| **B11** | Contenido del bundle | N-87, N-88, N-89 | B12 |
| **B12** | Markdown y secciones | TC-39, TC-40, N-92 | B13 |
| **B13** | `/fuentes` | N-93..N-99, **R-2** (exclusión publicada) | B14 |
| **B14** | Responsive | N-101..N-112 | B15 |
| **B15** | Autorización cruzada | N-16, N-17, N-18, N-19 (requiere un segundo usuario en `:3001`) | — |
| **B16** | Teclado (reporte/modal) | N-121, N-122, N-123, N-128, N-130 | — |

### 6.1 Criterio de salida

La validación se considera **completa** cuando:

1. Los 48 TC legacy tienen veredicto explícito (`=`, `≈`, `⊘` o `✗` confirmado en runtime).
2. Las 9 regresiones (R-1..R-9) están verificadas con evidencia (screenshot, dump de estilo del
   mapa, o traza de red), no por lectura de código.
3. Los 130 casos nuevos (N-01..N-130) están ejecutados dos veces.
4. Los defectos D-01..D-20 están **confirmados o refutados en runtime** — la lista de §3.1 se
   derivó del código y el validador debe cerrarla con evidencia.

### 6.2 Bloqueantes conocidos antes de arrancar

Estos cuatro impiden ejecutar bloques enteros y conviene resolverlos (o aceptarlos como fallo
esperado) antes de gastar pasadas:

- **D-02** deja `Reporte` y `Exportar` permanentemente deshabilitados en el topbar → el half A no
  puede llegar al modal por el camino natural. **Workaround del validador**: abrir el modal por
  ⓘ → `Descargar esta capa recortada al AOI` (C-14) o por el inspector (I-11), y llegar al reporte
  navegando a `/reporte/{analysisId}` a mano.
- **D-01/D-03** hacen que la pestaña `Análisis` no muestre nunca progreso ni métricas.
- **D-15** hace imposible ejercitar TC-26..TC-31 desde la UI.
- **D-17** puede tumbar el reporte entero en cliente: es el primer caso del half B por eso.
