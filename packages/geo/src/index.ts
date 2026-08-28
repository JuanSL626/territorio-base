// @territorio/geo — dueño de TODO el trabajo vectorial (memo §3):
// fetching de Overpass / WDPA / MEPyD, parseo de AOI (KML/KMZ/GeoJSON),
// matemática con turf, y exportación a shapefile + ZIP.
// Nada de raster vive acá: el raster vive en services/api (Python).
//
// Las tres correcciones que este paquete existe para no perder
// (`docs/migration/03-critique-2.md`):
//   H6  → export/dbf-fields.ts  (colisión de nombres DBF: pérdida silenciosa de columnas)
//   H7  → export/shapefile.ts   (.prj derivado del CRS real, no una constante)
//   H8  → geometry.ts           (distancia segmento a segmento, no vértice a vértice)
//   H9  → geometry.ts           (intersección con booleanIntersects, nunca `distancia === 0`)
//   H10 → geometry.ts           (buffer plano en UTM, no azimutal esférico)
//
// ⚠️ ESTE BARREL ES ISOMÓRFICO: lo importan módulos que corren en el browser.
// Nada que toque `node:*`, `archiver` o `Buffer` puede exportarse desde acá —
// va a `./server.ts`, que se importa como `@territorio/geo/server`.
// Ver el encabezado de ese archivo: dejar `export/bundle` colgando de acá
// arrastraba `archiver` al grafo del cliente y tumbaba `vite dev` en `/`.

export * from './geojson';
export * from './crs';
export * from './geometry';
export * from './concurrency';
export * from './http';
export * from './aoi';
export * from './analysis';
export * from './sources/overpass';
export * from './sources/wdpa';
export * from './sources/mepyd';
export * from './export/dbf-fields';
export * from './export/shapefile';
export * from './export/sources';
// `export/bundle` NO va acá: es Node-only (archiver + Buffer). → './server'.
