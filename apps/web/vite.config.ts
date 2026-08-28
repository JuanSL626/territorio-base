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
  Directorio de salida parametrizable: el plan de validación
  (docs/migration/05-validation-plan.md §0.2) corre dos builds en paralelo
  contra dos servidores, y con `dist/` fijo el segundo pisa al primero.
  `TB_DIST_DIR` le da a cada instancia el suyo; `server.mjs` lee la misma
  variable para que build y start coincidan. Sin ella, todo va a `dist/`.
*/
const DIST_DIR = process.env.TB_DIST_DIR ?? 'dist';

/*
  MapLibre 6 arma la URL de su worker con un template literal condicional
  (`new URL(`./${cond ? a : b}`, import.meta.url)`): ningún bundler la resuelve
  estáticamente, así que Rolldown no emite `maplibre-gl-worker.mjs` ni
  `maplibre-gl-shared.mjs` (que el worker importa). En runtime el chunk pide
  `GET /assets/maplibre-gl-worker.mjs`, recibe 404 → HTML de "no encontrado" →
  el worker muere al parsearlo, sin ninguna excepción visible: sólo quedan el
  basemap y los rasters (se decodifican en el hilo principal); AOI, hidrología,
  WDPA, las 39 capas MEPyD y el inspector de features quedan muertos.

  Este plugin copia ambos archivos, verbatim y con su nombre exacto (deben
  quedar consistentes entre sí), a `<outDir>/assets/`.
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
      Red de seguridad, a propósito ruidosa: si `emitFile` alguna vez no
      corre (otro plugin, cambio de API de Rolldown, `assetsDir` distinto) el
      404 del worker vuelve a ser mudo. Preferimos un build que falla a un
      mapa vacío.
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
    `maplibre-gl` no puede pasar por el pre-bundler de Vite: en `pnpm dev` el
    optimizador lo reescribe a `node_modules/.vite/deps/` sin copiar los
    archivos hermanos del worker, así que la URL que calcula MapLibre (ver
    `maplibreWorkerAssets` arriba) apunta a un archivo inexistente y el
    worker da 404 en silencio. Excluirlo lo deja servido desde `node_modules`
    vía `/@fs`, donde los hermanos sí están.

    Esto es sólo de desarrollo — no arregla producción, que depende de
    `maplibreWorkerAssets()`. Son dos mitades del mismo bug.
  */
  optimizeDeps: {
    exclude: ['maplibre-gl'],
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
