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
  plugins: [
    // Orden obligatorio: tanstackStart() SIEMPRE antes de viteReact(), o la
    // generación del árbol de rutas y la compilación de server functions falla.
    tanstackStart(),
    viteReact(),
    tailwindcss(),
  ],
});
