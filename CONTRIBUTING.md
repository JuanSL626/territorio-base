# Contribuir a Territorio Base

Convenciones del workspace. Corto a propósito: lo que hay acá es lo que no se
deduce mirando el código.

---

## Dónde va cada cosa

| Si estás tocando… | Va en… |
|---|---|
| Grilla de píxeles: STAC, mosaico, reproyección, NDVI, pendiente, WorldCover, GeoTIFF, overlays PNG | `services/api` (Python) |
| Cualquier cosa vectorial: Overpass, WDPA, MEPyD, parseo de AOI, turf, proj4, shapefile, ZIP | `packages/geo` (TypeScript) |
| Rutas, componentes, mapa, reporte, server functions | `apps/web` |
| Esquema y queries ownership-scoped (`analysis`, `rate_limit`) | `packages/db` |
| Sesión (Supabase Auth vía `@supabase/ssr`), invitaciones (`inviteUserByEmail`) | `apps/web/src/lib` |
| Migraciones de esquema (SQL generado, `supabase db push`) | `supabase/migrations` |
| Contrato HTTP con el servicio raster | `packages/api-client` |

La regla que resuelve las discusiones: **Python es dueño de la grilla de
píxeles; TypeScript es dueño de todo lo demás**
([memo del motor](docs/migration/01-engine-decision-memo.md) §3).

Dos consecuencias que se olvidan seguido:

- `packages/api-client/src/generated/schema.ts` **se genera**, no se escribe.
  Si cambia la API de Python: `pnpm --filter @territorio/api-client generate`.
- `apps/web/src/routeTree.gen.ts` también se genera (está en `.gitignore`).

---

## Catálogos: ningún paquete escribe una versión

**Un paquete NUNCA pone un rango de versión en su `package.json`.** Pone
`"catalog:"`, y la versión se resuelve en `pnpm-workspace.yaml`. Una línea para
subir, una línea para auditar.

```jsonc
// packages/geo/package.json
"dependencies": {
  "@turf/turf": "catalog:",   // ✅
  "proj4": "^2.21.0"          // ❌ nunca
}
```

Las versiones del catálogo están **fijadas exactas** (sin `^` ni `~`), y
`.npmrc` lleva `save-exact=true` para que un `pnpm add` distraído no meta un
rango por la ventana de atrás.

Agregar una dependencia nueva:

```bash
# 1. agregar la línea en el catalog de pnpm-workspace.yaml, con su versión exacta
# 2. referenciarla desde el paquete que la usa:
pnpm --filter @territorio/geo add nombre-del-paquete@catalog:
```

Varias entradas del catálogo tienen un comentario explicando por qué están
clavadas en esa versión y no en la última (`typescript` por el rango de peers de
typescript-eslint, `proj4` porque `@types/proj4` es un stub deprecado).
**Leelos antes de subir una versión.**

Un binario nativo con script de postinstall no corre solo: pnpm 11 lo exige
declarado en `allowBuilds`, en el mismo archivo. Sumar uno es una decisión
consciente, no un efecto secundario.

---

## Typecheck: tsgo, no tsc

```bash
pnpm typecheck    # → tsgo --noEmit en cada paquete
```

`typescript` está en el catálogo para el language service del editor y como peer
de typescript-eslint. **Nada en este repo se compila con `tsc`**: `apps/web` lo
construye Vite y los paquetes internos se consumen como **fuente TypeScript**
(los `exports` apuntan a `./src/*.ts`). Por eso todas las configs son
`noEmit: true`.

Los tsconfig salen de `@territorio/tsconfig`: `base.json` (bundler-first,
`verbatimModuleSyntax`, `noUncheckedIndexedAccess`), `react-library.json` y
`app.json`. Se extiende; no se escribe uno nuevo desde cero. `types` se declara
siempre explícito, porque TypeScript 6/7 ya no absorbe todo `@types` solo.

---

## ESLint: config plana, por paquete

Cada paquete tiene su `eslint.config.js` y extiende `@territorio/eslint-config`
(`/base` o `/react`). ESLint se corre **con el directorio del paquete como cwd**
—que es lo que hace Turborepo— porque el config usa
`tsconfigRootDir: process.cwd()`. Lintear desde la raíz da resultados
equivocados.

```bash
pnpm lint          # todos
pnpm lint:fix      # con --fix
```

Reglas que sorprenden y son deliberadas:

- **`no-floating-promises` con `checkThenables`.** Todo en esta app es una
  llamada a un upstream lento y frágil; una promesa suelta es una capa que
  falta, en silencio.
- **`no-restricted-imports` prohíbe `geoblaze`, `georaster`, `loam` y
  `geojson-validation`.** No es estilo: `geoblaze.median` es *zonal*, no
  temporal, y quien lo use portando el compuesto de NDVI va a shippear un número
  plausible y equivocado. El razonamiento está en el mensaje de la regla.
- **`switch-exhaustiveness-check`.** Los tipos de capa, las vistas y los
  formatos de export son uniones cerradas: agregar un miembro tiene que romper
  todos los `switch` que lo manejan.

`prettier` formatea; **no** se usa `eslint --fix` para formato.

---

## Python

`services/api` usa **uv** (`uv.lock`, no `requirements.txt` a mano) y **ruff**.
La configuración de ruff vive en `services/api/pyproject.toml` y hoy corre con
el set por defecto más `W` — el comentario de esa sección explica cómo ampliarlo
y cuántos errores cuesta cada paso. Ampliar el set y arreglar el árbol es un
cambio bienvenido; ampliarlo y dejar CI en rojo no.

```bash
cd services/api
uv sync                        # entorno
uvx ruff check .               # lint
uv run pytest -m "not network" # suite offline: la que corre en CI
uv run pytest                  # + la de aceptación contra los servicios reales
```

Los tests marcados `network` golpean Planetary Computer y WRI de verdad. Se
excluyen de CI a propósito: un corte de un tercero no debe poner el repo en
rojo. Antes de tocar el pipeline raster, corrélos igual.

---

## Commits

Estilo del repo, en español, imperativo y explicando el **porqué** en el cuerpo:

```
feat(web): mapa MapLibre con inspector, reporte story map y exportación

- Qué cambia y por qué, en viñetas.
- Los números medidos, cuando los hay ("181 pruebas en verde",
  "la clase dominante pasa de 99.7% dispersa a 87.8% muy densa").
- Las decisiones que alguien podría querer revertir, con su razón.
```

Prefijos en uso: `feat`, `fix`, `docs`, `chore`, `refactor`, `test`, `build`,
`ci`. Scope opcional entre paréntesis (`web`, `geo`, `api`, `db`, `migration`).
El asunto va en minúscula, sin punto final y por debajo de ~72 caracteres.

Antes de abrir un PR, en verde:

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
cd services/api && uvx ruff check . && uv run pytest -m "not network"
```

Es exactamente lo que corre `.github/workflows/ci.yml`, más un build de las dos
imágenes Docker y una validación de `compose.yaml`.

---

## Agregar una capa

Es un cambio de **datos**, no de componentes: cuatro pasos, cero archivos de UI
tocados. Está en el [README](README.md#cómo-se-agrega-una-capa) y la regla la
sostiene `apps/web/src/layers/registry.test.ts`, que falla si una capa vectorial
se queda sin alias de popup o una fuente sin licencia.

---

## Despliegue

Objetivo aprobado: **Docker Compose autoalojado**. Los archivos que lo definen
son `compose.yaml`, `apps/web/Dockerfile`, `services/api/Dockerfile`,
`.dockerignore` y `.github/workflows/ci.yml`.

> **Docker es solo para producción.** El desarrollo se hace local con
> `pnpm dev` — es más rápido (HMR de Vite, sin capa de filesystem de Docker) y
> es el flujo que documenta el README.
>
> Por eso **no hay `compose.override.yaml`**. Existió y se borró a propósito:
> Compose aplica ese archivo solo cuando está presente, así que `docker compose
> up` levantaba en realidad la configuración de *desarrollo* — `uvicorn
> --reload`, `TERRITORIO_DEBUG=1`, `src/` montado desde el host y `read_only`
> apagado — y producción exigía acordarse de `-f compose.yaml`. Con el default
> invertido respecto a la única cosa para la que usamos Docker, era cuestión de
> tiempo que algo se desplegara en modo debug. Si alguna vez hace falta un
> override de desarrollo, que sea con otro nombre y `-f` explícito.

Cinco cosas que conviene saber antes de tocarlos:

1. **La imagen de la web se construye desde la raíz del repo**, no desde
   `apps/web`. Una app de un workspace pnpm no es autocontenida: necesita el
   lockfile, `pnpm-workspace.yaml` (donde viven los catálogos) y los manifiestos
   de *todos* los miembros del workspace, o `--frozen-lockfile` aborta. La
   cabecera de `apps/web/Dockerfile` lo explica entero.
2. **`apps/web/server.mjs` es el entrypoint de producción.** Hasta la
   migración a Supabase (Postgres vía `postgres-js`, sin driver nativo)
   llevaba un parche por `better-sqlite3`: el bundle SSR inlineaba el driver
   y `bindings` (CommonJS, referencia `__filename` — inexistente en ESM), y
   el síntoma era una app que arranca, sirve HTML y en la que nadie puede
   iniciar sesión, sin un solo error en los logs. Con `better-sqlite3` fuera
   del workspace por completo, este problema ya no puede volver a pasar —
   pero si ves `ssr: { external: ['better-sqlite3'] }` todavía en
   `apps/web/vite.config.ts`, es un resto sin retirar de esa era: la
   dependencia que externalizaba ya no existe.

3. **`apps/web/vite.config.ts` carga dos arreglos que el build en verde no
   detecta**, los dos documentados en su propio comentario:
   `maplibreWorkerAssets()` (copia `maplibre-gl-worker.mjs` y
   `maplibre-gl-shared.mjs` a `dist/client/assets/`, porque MapLibre arma la URL
   del worker con un template literal que ningún bundler puede analizar — sin
   eso no renderiza NINGUNA capa vectorial en producción) y el
   `optimizeDeps.exclude` de `maplibre-gl` (la mitad equivalente para `dev`).
   El plugin verifica en `writeBundle` que los dos archivos hayan quedado en
   disco y **rompe el build** si falta alguno: el 404 del worker es mudo y no se
   puede dejar librado a que alguien lo note.

4. **`TB_DIST_DIR` cambia el directorio de salida** y lo leen `vite.config.ts` y
   `server.mjs` a la vez, para poder correr dos instancias en paralelo sin que
   una pise el `dist/` de la otra:

   ```bash
   TB_DIST_DIR=dist-a pnpm --filter @territorio/web build
   TB_DIST_DIR=dist-a PORT=3000 pnpm --filter @territorio/web start
   ```

5. **`@territorio/geo` tiene dos puntos de entrada.** El barrel
   (`@territorio/geo`) es isomórfico y lo importan módulos que corren en el
   browser; todo lo Node-only (hoy `export/bundle`, que usa `archiver` y
   `Buffer`) sale por `@territorio/geo/server`. No muevas nada de `server.ts` al
   barrel: el build de producción lo tree-shakea y no te vas a enterar, pero
   `vite dev` explota al evaluar `archiver` en el cliente y `/` dibuja el error
   boundary.
