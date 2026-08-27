import tailwindcss from '@tailwindcss/vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const srcDir = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
  resolve: {
    alias: { '~': srcDir },
  },
  /*
    `maplibre-gl` NO puede pasar por el pre-bundler de dependencias de Vite.

    MapLibre carga su worker con `new Worker(new URL('./maplibre-gl-worker.mjs',
    import.meta.url))`. El optimizador reescribe el módulo a
    `node_modules/.vite/deps/` pero no emite ese archivo, así que en `pnpm dev`
    el worker da 404 — en silencio. Consecuencia observable: los tiles raster
    se ven (se decodifican en el hilo principal) y **ninguna capa GeoJSON
    renderiza**, que es decir el AOI, el dibujo, hidrología, WDPA y las ~39
    capas MEPyD. El síntoma no es un error: es un mapa con fondo y sin datos.

    Sólo afecta a desarrollo — el build de producción emite el chunk del worker
    bien —, y por eso es exactamente la clase de bug que se descubre tarde.
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
  ],
});
