import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));
const here = fileURLToPath(new URL('.', import.meta.url));

/*
  Directorio de salida, parametrizable.

  Los dos halves del plan de validación (`docs/migration/05-validation-plan.md`
  §0.2) corren en paralelo contra dos servidores. Con un `dist/` fijo el
  segundo build pisa el primero a mitad de sesión. `TB_DIST_DIR` le da a cada
  instancia el suyo:

      TB_DIST_DIR=dist-a pnpm --filter @territorio/web build
      TB_DIST_DIR=dist-a PORT=3000 pnpm --filter @territorio/web start

  `server.mjs` lee la MISMA variable, así que build y start siempre coinciden.
  Sin la variable, todo sigue en `dist/` como antes.
*/
const DIST_DIR = process.env.TB_DIST_DIR ?? 'dist';

/*
  ───────────────────────────────────────────────────────────────────────────
  El worker de MapLibre en el build de producción
  ───────────────────────────────────────────────────────────────────────────
  MapLibre 6 arma la URL de su worker así (dist/maplibre-gl.mjs, minificado):

      let t = e.endsWith('-dev.mjs') ? 'maplibre-gl-worker-dev.mjs'
                                     : 'maplibre-gl-worker.mjs';
      return new URL(`./${t}`, import.meta.url).href;

  Es un template literal con una condicional adentro: NINGÚN bundler puede
  analizarlo estáticamente. Rolldown no ve una referencia a un módulo, ve una
  concatenación de strings — así que no emite `maplibre-gl-worker.mjs` ni su
  hermano `maplibre-gl-shared.mjs` (el worker lo importa con
  `from "./maplibre-gl-shared.mjs"`).

  En el bundle, `import.meta.url` del chunk de maplibre es
  `…/assets/maplibre-gl-<hash>.js`, o sea que el runtime pide
  `GET /assets/maplibre-gl-worker.mjs` → 404 → el server SSR contesta con el
  HTML de "no encontrado" → el worker muere al parsearlo.

  Y el modo de falla es mudo: no hay excepción en el hilo principal. Sin worker
  no se tesela ninguna fuente GeoJSON, `map.isStyleLoaded()` se queda en false y
  `queryRenderedFeatures` devuelve `[]`. Observable: sólo se dibujan el basemap
  y los overlays raster (se decodifican en el hilo principal); el borde del AOI,
  hidrología, WDPA, las 39 capas MEPyD y TODO el inspector de features quedan
  muertos en producción.

  Este plugin copia los dos archivos tal cual, con su nombre exacto, dentro de
  `<outDir>/assets/`, que es justo la URL que el runtime va a pedir. Se copian
  verbatim a propósito: el worker y el shared vienen pre-bundleados de MapLibre
  y el par tiene que quedar consistente entre sí.
*/
const MAPLIBRE_WORKER_FILES = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'] as const;

function maplibreWorkerAssets(): Plugin {
  const require_ = createRequire(import.meta.url);
  const distOfMaplibre = join(dirname(require_.resolve('maplibre-gl/package.json')), 'dist');

  return {
    name: 'territorio:maplibre-worker-assets',
    // Sólo el build de cliente: el bundle SSR nunca instancia un Worker.
    applyToEnvironment: (environment) => environment.config.consumer === 'client',
    apply: 'build',
    generateBundle() {
      for (const name of MAPLIBRE_WORKER_FILES) {
        this.emitFile({
          type: 'asset',
          // `fileName` explícito ⇒ Rolldown NO le pone hash. Es obligatorio:
          // el nombre es parte del contrato con el runtime de MapLibre.
          fileName: `${this.environment.config.build.assetsDir}/${name}`,
          source: readFileSync(join(distOfMaplibre, name)),
        });
      }
    },
    /*
      Red de seguridad, y a propósito ruidosa. Si un día `emitFile` deja de
      correr —otro plugin que cortocircuita `generateBundle`, un cambio de API
      de Rolldown, un `assetsDir` distinto— el 404 del worker vuelve a ser
      mudo: la app compila, arranca, dibuja el basemap, y ninguna capa
      vectorial renderiza. Preferimos un build que falla a un mapa vacío.
    */
    writeBundle(options) {
      const outDir = options.dir ?? resolve(here, DIST_DIR, 'client');
      for (const name of MAPLIBRE_WORKER_FILES) {
        const target = join(outDir, 'assets', name);
        if (!existsSync(target)) {
          this.error(
            `El build no emitió ${target}. MapLibre lo pide por URL en runtime; ` +
              `sin él no renderiza NINGUNA capa vectorial en producción. ` +
              `Revisá el plugin territorio:maplibre-worker-assets en vite.config.ts.`,
          );
        }
      }
    },
  };
}

export default defineConfig({
  resolve: {
    alias: { '~': srcDir },
  },
  build: {
    outDir: DIST_DIR,
  },
  /*
    `maplibre-gl` NO puede pasar por el pre-bundler de dependencias de Vite.

    En `pnpm dev` el optimizador reescribe el módulo a `node_modules/.vite/deps/`
    pero no copia al lado los archivos hermanos del worker, así que la URL que
    MapLibre calcula (ver `maplibreWorkerAssets` arriba) apunta a un archivo que
    no existe y el worker da 404 — en silencio. Excluirlo lo deja servido desde
    `node_modules` vía `/@fs`, donde los hermanos SÍ están.

    OJO — corrección de un comentario anterior que decía exactamente lo
    contrario: esto **no** es un problema sólo de desarrollo, y este `exclude`
    **no** arregla producción. El build de producción NO emite el chunk del
    worker: eso lo arregla `maplibreWorkerAssets()`. Son dos mitades del mismo
    bug y hacen falta las dos.
  */
  optimizeDeps: {
    exclude: ['maplibre-gl'],
  },
  ssr: {
    /*
      `better-sqlite3` tiene que quedar FUERA del bundle SSR.

      Inlinearlo arrastra `bindings@1.5.0`, que es CommonJS y referencia
      `__filename` — que en ESM no existe. `getSession` explotaba con
      `ReferenceError: __filename is not defined`, `session.ts` atrapa todo y
      devuelve `null`, y el resultado era una app que arranca, sirve HTML y en
      la que **nadie puede iniciar sesión jamás**, sin un solo error en los logs.

      Externalizado, Node lo resuelve desde `node_modules` igual que en `dev`,
      con su `.node` en su lugar. Esta línea reemplaza al parche que vivía en
      `server.mjs` (definir `globalThis.__filename` + copiar el binding), ya
      borrado.
    */
    external: ['better-sqlite3'],
  },
  plugins: [
    // Orden obligatorio: tanstackStart() SIEMPRE antes de viteReact(), o la
    // generación del árbol de rutas y la compilación de server functions falla.
    tanstackStart(),
    viteReact(),
    tailwindcss(),
    maplibreWorkerAssets(),
  ],
});
