# Territorio Base

Diagnóstico territorial preliminar de una zona cualquiera, a partir de fuentes
abiertas y sin descargas ni GIS manual: dibujás (o subís) el polígono y la app
devuelve topografía, cobertura y densidad arbórea, hidrología, áreas protegidas
y —dentro de República Dominicana— el contexto de riesgo del MEPyD. Todo con
mapa interactivo, reporte narrativo y descarga de las capas.

No requiere ninguna cuenta ni API key: todas las fuentes son públicas y sin
registro. Lo único que se configura es el acceso a la propia app, que es por
invitación.

---

## Arquitectura

Dos procesos y una regla que decide dónde va cada cosa:

> **Python es dueño de la grilla de píxeles. TypeScript es dueño de todo lo demás.**

```
                    ┌─────────────────────────────────────────┐
   navegador ──────▶│  apps/web — TanStack Start (SSR, :3000) │
        │           │                                         │
        │           │  · sesión (Better Auth + SQLite)        │
        │           │  · TODO lo vectorial: Overpass, WDPA,   │
        │           │    catálogo MEPyD, KML/KMZ/GeoJSON      │
        │           │  · mapa (MapLibre), reporte, ZIP        │
        │           └──────────────────┬──────────────────────┘
        │                              │ HTTP interno
        │                              ▼
        │           ┌─────────────────────────────────────────┐
        └──────────▶│  services/api — FastAPI raster (:8787)  │
        PNG de      │                                         │
        overlay     │  · STAC + firma SAS (Planetary Computer)│
                    │  · odc.stac.load → mosaico → recorte AOI│
                    │  · NDVI, pendiente, WorldCover, Aqueduct│
                    │  · GeoTIFF y overlays PNG               │
                    └─────────────────────────────────────────┘
                                       │
                              volumen compartido /data
                       (territorio.db + GeoTIFF por análisis)
```

### Por qué híbrida y no todo en un lenguaje

La decisión está tomada, medida y escrita en
[`docs/migration/01-engine-decision-memo.md`](docs/migration/01-engine-decision-memo.md).
El resumen, para no tener que releerlo:

- **`odc.stac.load` no tiene equivalente en JavaScript, a ningún nivel de
  madurez.** Es lo que busca escenas, las mosaica, las reproyecta a una grilla
  UTM y las recorta al AOI. Reescribirlo es construir un motor de warp a mano.
- **"Todo en JS" no evita el binario nativo.** La alternativa seria
  (`gdal-async`) es un addon nativo de 215 MB. El supuesto beneficio de
  "un solo lenguaje, sin binarios" no existe.
- **Los números son el producto.** Un NDVI mal calculado no rompe: devuelve otra
  cifra, plausible, en un documento que alguien usa para decidir. En Python hay
  una suite de aceptación contra AOIs reales; en un motor propio no hay red.
- **Lo vectorial sí se verificó ejecutando código** (`@turf/turf` + `proj4`), y
  es la mayoría de las líneas. Por eso se movió entero a TypeScript.

La costura puede moverse a la derecha (más cosas a Python) casi gratis. Ese es
justamente el punto de haberla elegido ahí.

### Mapa del repositorio

```
apps/web              TanStack Start (SSR) · MapLibre · Tailwind v4 — la app
services/api          FastAPI + odc-stac (Python 3.11, uv) — el motor raster
packages/geo          TODO lo vectorial: AOI, Overpass, WDPA, MEPyD, exports
packages/db           Drizzle + SQLite + Better Auth (acceso por invitación)
packages/ui           primitivas de UI compartidas
packages/api-client    cliente tipado del servicio raster, GENERADO desde su OpenAPI
packages/tsconfig      configs de TypeScript compartidas
packages/eslint-config configs planas de ESLint compartidas
docs/migration        inventario del legacy, memo del motor, brief de diseño
```

---

## Puesta en marcha (desarrollo local)

Requisitos: **Node 24** (ver `.nvmrc`), **pnpm 11** (por corepack) y **uv** para
el servicio Python. Con el devcontainer del repo no hace falta instalar nada.

```bash
# 1. Toolchain
corepack enable && corepack prepare --activate

# 2. Dependencias (workspace TypeScript + servicio Python)
pnpm install
pnpm --filter @territorio/api-service sync        # = uv sync en services/api

# 3. Entorno
cp .env.example .env
openssl rand -base64 32                            # → BETTER_AUTH_SECRET

# 4. Base de datos y primer usuario
#    Completá ADMIN_EMAIL y ADMIN_PASSWORD en .env antes del seed.
pnpm --filter @territorio/db db:migrate
pnpm --filter @territorio/db db:seed -- --name "Tu Nombre"

# 5. Arrancar los dos servicios (Turborepo los levanta en paralelo)
pnpm dev
```

- App: <http://localhost:3000>
- Servicio raster: <http://localhost:8787/docs> · `/openapi.json` · `/healthz`

El seed **no** escribe el usuario a mano: emite una invitación a nombre de
`ADMIN_EMAIL` y la canjea por el mismo camino que cualquier otra persona. No hay
puerta trasera, ni siquiera para el primer usuario. Es idempotente.

### Los comandos que se usan todos los días

```bash
pnpm dev            # web + api en paralelo
pnpm lint           # eslint en cada paquete
pnpm typecheck      # tsgo --noEmit
pnpm test           # vitest (TS) — los tests de Python se corren aparte
pnpm build          # build de producción de todo el workspace
pnpm format         # prettier

pnpm --filter @territorio/db db:create-invite     # invitar a alguien
pnpm --filter @territorio/api-client generate     # regenerar tipos del OpenAPI

cd services/api && uv run pytest -m "not network" # suite offline (la de CI)
cd services/api && uv run pytest                  # incluye la de aceptación real
```

---

## Puesta en marcha (Docker Compose, autoalojado)

El único objetivo de despliegue soportado. Dos contenedores, un volumen, sin
base de datos externa.

**Docker es solo para producción.** Para desarrollar, usá `pnpm dev` (sección
anterior): es más rápido y no tiene la capa de filesystem de Docker en el medio.
No hay `compose.override.yaml` — `docker compose up` levanta producción y nada
más.

```bash
cp .env.example .env
# Completá BETTER_AUTH_SECRET (openssl rand -base64 32), ADMIN_EMAIL y
# ADMIN_PASSWORD. El resto tiene defaults que sirven.

docker compose build

# Esquema y primer usuario (una sola vez; ambos son idempotentes)
docker compose run --rm migrate
docker compose run --rm migrate node /app/packages/db/scripts/seed.ts --name "Tu Nombre"

docker compose up -d
docker compose ps          # `api` tiene que quedar en (healthy)
docker compose logs -f web
```

| Servicio  | Puerto host                | Qué es |
|---|---|---|
| `web`     | `${WEB_PORT:-3000}`        | El servidor SSR. El ÚNICO servicio que el navegador necesita alcanzar. |
| `api`     | — (sin publicar)           | El servicio raster. Interno: `web` le habla por `api:8787` en la red de compose y proxea los PNG/GeoTIFF de overlay al navegador (`apps/web/src/routes/api/raster.*.ts`). |
| `migrate` | —                          | Utilidad de un solo uso detrás del profile `tools`. `up` la ignora. |

Compose pisa `API_URL` (a `http://api:8787`) y `DATABASE_URL` (a
`file:/data/territorio.db`) con los valores que corresponden dentro de la red de
contenedores: no hay que editarlos en el `.env` para desplegar.

El navegador no necesita ninguna variable de build para llegar al servicio
raster — no existe un `VITE_API_URL` que hornear. Todo el tráfico de overlay
pasa por `web` en el mismo origen que el resto de la app, con sesión y
verificación de dueño de por medio. Para debuggear `api` directo desde el
host, ver el comentario del servicio en `compose.yaml` (agregar un `ports:`
temporal).

### Detrás de un proxy inverso

Compose no incluye proxy ni TLS. Para publicar en internet va un Caddy / nginx /
Traefik delante apuntando a `web:3000`. Dos cosas tienen que ser ciertas:

1. `BETTER_AUTH_URL` = la URL **pública** (`https://…`). De ahí salen los
   orígenes de confianza y el flag `Secure` de la cookie de sesión.
2. El proxy manda `X-Forwarded-Proto` y `X-Forwarded-Host`. `apps/web/server.mjs`
   los usa para reconstruir el origen real; sin ellos Better Auth ve `http://`
   y el login falla con un error de origen, no de configuración.

### Respaldo

Todo lo que sobrevive a un `docker compose down` está en un volumen con nombre
`<proyecto>_territorio-data` — `territorio-base_territorio-data` si desplegaste
sin `-p` (el `name:` de la cabecera de `compose.yaml` es `territorio-base`), o
`<lo-que-hayas-pasado-a--p>_territorio-data` si usaste `-p`. Para confirmarlo:
`docker compose config | grep -A2 '^volumes:'`, o `docker volume ls`.

```
/data/territorio.db      usuarios, invitaciones y análisis (SQLite, modo WAL)
/data/analyses/<job>/    GeoTIFF y PNG de cada análisis
/data/coastal/           caché de los COG de WRI Aqueduct
```

Respaldar es copiar ese volumen. Por WAL, para una copia consistente en caliente
usá `sqlite3 /data/territorio.db ".backup /data/backup.db"` en vez de `cp`.

### Migrar el volumen de datos (despliegues anteriores a este cambio)

`compose.yaml` solía fijar el volumen con `name: territorio-data`, sin prefijo
de proyecto. Un `name:` explícito le gana al namespacing de Compose, así que
**todo despliegue de ese archivo en un mismo host escribía el mismo volumen
físico** — dos entornos (o dos `-p` distintos) sobre la misma base SQLite, sin
ningún aviso más que un warning de Compose fácil de no ver. Ahora el volumen no
lleva `name:` fijo, así que Compose lo namespacea por proyecto:
`<proyecto>_territorio-data`.

Esto significa que **un despliegue que ya tenía el volumen viejo
(`territorio-data`, sin prefijo) no lo va a encontrar más**: el próximo
`docker compose up` crea `territorio-base_territorio-data` vacío y arranca sin
usuarios ni análisis, en silencio. Si tenías un despliegue de antes de este
cambio, migrá el volumen ANTES de levantar la versión nueva:

```bash
docker compose down     # con la versión vieja de compose.yaml, todavía

# Nombre del volumen nuevo: <proyecto>_territorio-data (sustituí <proyecto>
# por el nombre que uses; por defecto es "territorio-base")
docker volume create territorio-base_territorio-data

# Copia byte a byte del volumen viejo al nuevo, vía un contenedor descartable
docker run --rm \
  -v territorio-data:/from \
  -v territorio-base_territorio-data:/to \
  alpine sh -c "cd /from && cp -a . /to"

# A partir de acá ya podés usar la versión nueva de compose.yaml
docker compose up -d
docker compose ps        # confirmá que sigan los usuarios y análisis de antes
```

El volumen viejo (`territorio-data`) queda intacto durante la migración —
`docker volume rm territorio-data` recién cuando confirmes que el nuevo
funciona.

---

## Fuentes de datos

Todas públicas y sin registro. La tabla sale del inventario
([§5](docs/migration/00-legacy-inventory.md)) y es la misma que el reporte cita
por capa.

| Análisis | Fuente | Proveedor / endpoint | Resolución | Caveats |
|---|---|---|---|---|
| Topografía (elevación, pendiente, orientación) | Copernicus DEM GLO-30 | ESA, vía Microsoft Planetary Computer (STAC `cop-dem-glo-30`) | 30 m | — |
| NDVI / densidad de vegetación | Sentinel-2 L2A | ESA Copernicus, vía Planetary Computer (STAC `sentinel-2-l2a`) | 10 m | Mediana de las escenas menos nubladas de los últimos 180 días (`eo:cloud_cover < 30`, top 6, máscara SCL {4,5,6,7,11}). Puede quedarse sin escenas en zonas persistentemente nubladas |
| Cobertura de suelo / % arbóreo | ESA WorldCover 2021 | ESA, vía Planetary Computer (STAC `esa-worldcover`) | 10 m | — |
| Hidrología | OpenStreetMap (`waterway`, `natural=water`, `natural=wetland`) | Overpass API, 5 mirrors en cascada | vectorial | Que no aparezca un curso de agua no prueba que no exista. `overpass.osm.ch` está **excluido a propósito**: responde 200 con 0 resultados en todo el Caribe |
| Áreas protegidas | WDPA — World Database on Protected Areas | UNEP-WCMC FeatureServer público | vectorial | Se usa este endpoint y no la API de Protected Planet porque aquella pide token |
| Inundación costera (opcional) | WRI Aqueduct Floods v2 (Ward et al., 2020) | World Resources Institute, COG por `/vsicurl/` | ~927 m | **CC-BY.** Screening, no estudio de detalle. Proyecciones hasta 2080, metodología 2020 basada en RCPs |
| Contexto de riesgo en RD (~35 capas: sísmica, tsunami, inundación, ciclón, deslizamiento, infraestructura, vías, división político-administrativa) | Sistema de Información para la GRD y la AC | MEPyD, FeatureServers públicos de ArcGIS Online | vectorial | Solo si el AOI intersecta República Dominicana; si no, se omite entero. Una capa que falla se omite sola, sin tumbar el análisis |

Si algún día se quisiera sumar series históricas tipo Hansen Global Forest
Change vía Google Earth Engine, **eso sí** requiere una cuenta de GEE aprobada.
Es la única fuente evaluada que no es abierta.

---

## Cómo se agrega una capa

Es un **cambio de datos, no de componentes** — la regla de escalabilidad del
brief de diseño ([§11](docs/migration/02-design-brief.md)). Agregar la capa 40
son cuatro pasos y cero archivos de UI tocados:

1. Una entrada `LayerDef` en `apps/web/src/layers/registry.ts` (o una fila en
   `MEPYD_TABLE`, en `layers/mepyd.ts`, si es del catálogo MEPyD): id, etiqueta,
   grupo, vistas, tipo, rol, leyenda, fuente **con licencia** y exports.
2. Si es vectorial, un `PopupConfig` con alias de campos. **No es opcional:**
   `registry.test.ts` falla si una capa vectorial no lo tiene.
3. Un adaptador de fetch en el motor, con el **mismo id**.
4. Opcionalmente `metrics: [...]`, y la capa produce tarjetas del reporte sola.

`apps/web/src/layers/registry.test.ts` es el que sostiene la regla: verifica que
toda `LayerDef` tenga `source.license`, que toda capa vectorial tenga al menos
un alias de popup, que ninguna vista pase el tope de capas prendidas por defecto
y que toda métrica referenciada exista. Si el paso 1 o el 2 se hacen a medias,
falla en CI, no en producción.

---

## Cómo se agrega un servicio al workspace

1. Crearlo bajo `apps/`, `packages/` o `services/` — los tres globs ya están en
   `pnpm-workspace.yaml`.
2. Darle un `package.json` con `"name": "@territorio/<algo>"` y `"private": true`.
   **Ningún paquete escribe un rango de versión:** escribe `"catalog:"` y la
   versión sale de `pnpm-workspace.yaml`. Si la dependencia es nueva, primero se
   agrega ahí.
3. Si NO es JavaScript, igual lleva `package.json` — solo con `scripts` que
   invoquen su herramienta. Es lo que hace `services/api`, cuyo `test` es
   `uv run pytest`: así Turborepo lo orquesta como a cualquier otro miembro.
4. Los scripts se llaman igual en todos lados (`lint`, `typecheck`, `test`,
   `build`, `dev`); `turbo.json` ya sabe qué hacer con esos nombres.
5. Extender `@territorio/tsconfig` y `@territorio/eslint-config` en vez de
   escribir configs nuevas.
6. Si necesita imagen propia: un `Dockerfile` en su carpeta, un servicio en
   `compose.yaml` y una entrada en la matriz `docker` de
   `.github/workflows/ci.yml`.

Los detalles de convenciones están en [`CONTRIBUTING.md`](CONTRIBUTING.md).

---

## Límites conocidos

Los que venían del stack anterior y **siguen siendo verdad**, porque son
límites de los datos, no del código:

- **La hidrología depende de qué tan mapeada esté la zona en OpenStreetMap.**
  Que no aparezca un curso de agua no es garantía de que no exista. Para
  confirmar de verdad hay que cruzar con INDRHI / Ministerio de Medio Ambiente.
- **El NDVI usa una mediana de varias escenas Sentinel-2 recientes** para evitar
  nubes. En zonas persistentemente nubladas puede no encontrar suficientes
  escenas y el análisis lo reporta en vez de inventar un número.
- **Pensado para polígonos de decenas a cientos de hectáreas.** Áreas mucho
  mayores tardan más en descargar y procesar; hay un guardarraíl de tamaño de
  AOI antes de arrancar cualquier job.
- **La inundación costera (WRI Aqueduct) es un screening, no un estudio.**
  ~927 m de resolución significa que unos pocos píxeles pueden cubrir el
  polígono entero; las proyecciones llegan hasta 2080 con metodología de 2020
  basada en RCPs. Climate Central llega a 2150 con mejor DEM, pero es
  propietario y **no tiene API pública**: no hay forma de integrarlo.
- **El catálogo MEPyD solo aporta datos dentro de República Dominicana.** Fuera
  del país se omite entero, a propósito.
- **Una fuente externa caída degrada, no tumba.** Cada fuente se aísla y
  distingue "no pude consultar" de "consulté y no hay nada": el reporte y la UI
  los muestran distinto. Es la regresión #3 del inventario y no se repite.

Límites que **ya no aplican** y por qué, para quien venga del README viejo:

- *"Requiere instalar Python en la PC / `Iniciar_App.bat` / IT bloquea `uv.exe`"*
  → ya no. La app es un servidor: se despliega una vez y se usa con un link, sin
  instalar nada en la máquina de quien la usa.
- *"Desplegar en Streamlit Community Cloud"* → ya no existe. La interfaz
  Streamlit fue reemplazada por TanStack Start + MapLibre y el objetivo de
  despliegue aprobado es Docker Compose autoalojado.
- *"`requirements.txt` hay que regenerarlo desde `uv.lock`"* → ya no es una
  trampa de despliegue. Las imágenes instalan con `uv sync --frozen` y
  `pnpm install --frozen-lockfile`: si el lockfile y el manifiesto divergen, el
  build **falla** en vez de desplegar otras versiones en silencio (regresión #9).

---

## Documentación de referencia

| Documento | Qué contiene |
|---|---|
| [`docs/migration/00-legacy-inventory.md`](docs/migration/00-legacy-inventory.md) | Comportamiento del sistema anterior, contrato de datos, catálogo de capas, 48 casos de prueba y las 9 regresiones a no repetir |
| [`docs/migration/01-engine-decision-memo.md`](docs/migration/01-engine-decision-memo.md) | Por qué la arquitectura es híbrida y dónde va exactamente la costura |
| [`docs/migration/02-design-brief.md`](docs/migration/02-design-brief.md) | Especificación de la UI: rutas, vistas, panel de capas, reporte, exports |
| [`docs/migration/04-correctness-fixes.md`](docs/migration/04-correctness-fixes.md) | H1 (offset BOA de Sentinel-2), H2 (época de WorldCover), H3 (máscara compartida elevación/pendiente) |
| [`services/api/README.md`](services/api/README.md) | Qué es y qué no es del servicio raster, sus variables y sus tests |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | Convenciones del workspace: catálogos, tsgo, ESLint plano, commits |
