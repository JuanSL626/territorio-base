/*
  De dónde saca el BROWSER los PNG y GeoTIFF de overlay: siempre del mismo
  origen, vía el proxy de `apps/web/src/routes/api/raster.*.ts`.

  Antes esto leía `VITE_API_URL` (horneada en el bundle) y le daba al browser
  la URL DESNUDA del servicio raster. Eso tenía dos problemas: con
  `TERRITORIO_API_TOKEN` configurado, una URL desnuda daba 401 (el servicio
  exige `Authorization`, que el browser no tiene); y sin token, cualquiera que
  llegara al puerto del servicio (publicado en `compose.yaml` para esto mismo)
  podía leer el overlay de CUALQUIER análisis con sólo adivinar un id — acá
  "análisis" es un recurso de usuario en todo el resto de la app, y ese puerto
  lo servía sin comparar dueño.

  El proxy resuelve las dos cosas: agrega el token server-side (`~/lib/api.ts`,
  `rasterAuthHeaders()`) y exige sesión + dueño antes de pedirle nada al
  servicio (`~/lib/raster-proxy.ts`). Por eso esta función ya no depende del
  entorno ni puede devolver "no hay base pública": SIEMPRE hay una base, es
  del mismo origen que la app, y el servicio raster ni siquiera necesita un
  puerto publicado al host (`compose.yaml` ya no lo publica).

  Se mantiene como función (no una constante importada directo) porque los dos
  consumidores — el mapa (`map-canvas.tsx`, vía `overlays.ts`) y la descarga de
  GeoTIFF del reporte (`report/sections.tsx`) — llaman `publicRasterBaseUrl()`
  exactamente como antes; ninguno de los dos necesitó cambiar de forma.
*/

/** Prefijo servido por `apps/web/src/routes/api/raster.*.ts`. */
const RASTER_PROXY_BASE = '/api/raster';

export function publicRasterBaseUrl(): string {
  return RASTER_PROXY_BASE;
}
