// @territorio/geo/server — la mitad de este paquete que SÓLO corre en Node.
//
// Por qué existe un punto de entrada aparte:
//
// `export/bundle.ts` importa `archiver` y usa `Buffer`. Los dos son de Node.
// Mientras eso colgaba del barrel (`@territorio/geo`), CUALQUIER módulo de
// browser que importara del barrel — y `lib/analysis-contract.ts` importa de
// ahí `hydrologySummarySchema`, que es un valor, no un tipo — arrastraba
// `archiver` al grafo del cliente. En `vite dev` eso explota al evaluarse
// (`TypeError: Cannot read properties of undefined (reading 'slice')`) y `/`
// termina dibujando el error boundary en vez de la app.
//
// El build de producción lo tree-shakea y el síntoma desaparece: por eso
// `pnpm build` pasaba en verde con `pnpm dev` roto. La frontera tiene que estar
// en el paquete, no en la suerte del tree-shaking.
//
// Regla, entonces: nada que importe de `node:*`, `archiver` o `Buffer` puede
// salir por `./src/index.ts`. Sale por acá, y los consumidores server-only
// (`apps/web/src/lib/export-runtime.ts`) hacen `from '@territorio/geo/server'`.
//
// El resto del paquete —geometría, CRS, parseo de AOI, las tres fuentes,
// shapefile (que escribe con `DataView`/`ArrayBuffer`, no con `Buffer`)— es
// isomórfico y sigue viviendo en el barrel.

export * from './export/bundle';
