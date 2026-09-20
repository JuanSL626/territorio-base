# Piloto de fuentes gratuitas de teledetección

## Alcance y decisión arquitectónica

Este piloto inspecciona **un dato reciente por fuente**. No descarga colecciones
masivas ni reemplaza el NDVI existente. La integración actual de Microsoft
Planetary Computer sigue en `sources/stac.py`; los adaptadores piloto viven en
`sources/remote_sensing.py` y se exponen por endpoints internos:

- `GET /remote-sensing/pilot/sources`: capacidades y credenciales.
- `POST /remote-sensing/pilot/inspect`: consulta, normaliza y cachea una ficha.
- `POST /remote-sensing/pilot/landsat`: solicita B4, B5 y QA_PIXEL de una sola
  escena Landsat, recorta el AOI y produce un NDVI verificable.
- `GET /remote-sensing/pilot/landsat/{clave}/preview.png` y `ndvi.tif`: artefactos
  locales autenticados; el frontend los sirve por un proxy que no expone el
  token interno del servicio raster.

La caché se identifica por AOI, fuente, colección, fecha de consulta y versión
del algoritmo. Se escribe bajo `TERRITORIO_DATA_DIR/remote-sensing-pilot`. Antes
de serializar cualquier asset se elimina su query string, por lo que un SAS,
token OAuth o API key no puede terminar en disco ni en el cliente.

Ejemplo:

```json
{
  "source": "cdse-sentinel-2-l2a",
  "aoi": {
    "type": "Polygon",
    "coordinates": [[[-69.95, 18.45], [-69.90, 18.45], [-69.90, 18.50], [-69.95, 18.50], [-69.95, 18.45]]]
  },
  "lookback_days": 21,
  "max_cloud_cover": 30
}
```

La fecha principal es siempre `acquisition_datetime`. La respuesta distingue
`last_scene_available`, `last_valid_cloud_free_scene` y `last_scene_used`, y
calcula `observation_age_hours`. Una escena reciente nublada conserva estado
`cloudy`; no convierte una escena anterior en “actual”. Sentinel-1 se declara
como SAR para inundación/cambios, nunca como sustituto de índices ópticos.

## Contrato técnico

Cada escena declara proveedor, misión, sensor, colección, nivel, identificador,
fechas, nubes, licencia, atribución, assets, bandas y origen del metadato. Cada
asset declara tamaño, formato, dimensiones, EPSG, proyección, datum, dtype,
resolución radiométrica efectiva y bandas cuando el proveedor los publica.

Un `null` significa **no publicado**, no cero. No se deriva la resolución
radiométrica desde `uint16`: capacidad del contenedor y resolución efectiva no
son equivalentes. Los rangos espectrales solo se calculan cuando el proveedor
declara longitud central y ancho de banda, y quedan marcados como derivados.
El NDVI Landsat adjunta fórmula, escala (`0.0000275`), offset (`-0.2`), bits
excluidos de `QA_PIXEL`, versión del algoritmo, escena y bandas de origen. Las
URLs de descarga de M2M solo viven en memoria: ni siquiera su versión sin query
se persiste, porque son temporales.

## Comparación y recomendación

| Fuente | Integración | Actualización esperada | Resolución útil | Límites/dificultades | Recomendación |
|---|---|---|---|---|---|
| Planetary Computer · Sentinel-2 L2A | Fácil; STAC estable y ya usado | Días; depende de órbita/procesamiento | 10/20/60 m según banda | Assets pueden necesitar firma SAS; se conserva el flujo actual | **Producción**, sin regresiones |
| CDSE · Sentinel-2 L2A | Fácil-media; STAC 1.1 público | Cercana al catálogo Copernicus | 10/20/60 m | Algunos accesos a assets pueden requerir OAuth; validar descarga COG | **Siguiente candidata** |
| CDSE · Sentinel-1 GRD | Media; STAC público, procesamiento SAR especializado | Días | ~10 m según modo/producto | No produce NDVI; requiere calibración, speckle y geometría radar | **Producción acotada** para inundación/cambios |
| USGS M2M · Landsat 9 C2 L2 | Media-alta | ~16 días por satélite/pasada; publicación posterior | 30 m reflectancia; térmica remuestreada según producto | Cuenta/token configurados; la cuenta aún requiere aprobación gratuita del alcance M2M de descarga | **Lista técnicamente; esperar aprobación M2M** para validar el artefacto real |
| NASA Earthdata · VIIRS NRT | Media; CMR público | Horas en productos NRT | ~375 m en bandas imagen VIIRS | Descarga puede pedir Earthdata Login; metadatos varían por DAAC | **Producción** como contexto regional/NRT |
| NASA GIBS · WMTS | Fácil para visualización | Diario/subdiario según capa | Dependiente de capa/teselado | Render visual, no apto para análisis cuantitativo | **Producción** solo como overlay |

Los valores exactos de resolución, tamaño, proyección, bandas y latencia de una
escena se toman de STAC/CMR/capabilities; la tabla es orientación de producto,
no sustituye la ficha devuelta por la API.

### Estado para promoción

- Pueden pasar a una integración de producción acotada: Planetary Computer
  Sentinel-2 (ya productiva), CDSE Sentinel-2 como fallback de catálogo, CDSE
  Sentinel-1 solo para un producto SAR explícito, NASA CMR/VIIRS como contexto
  NRT y NASA GIBS solo como visualización.
- Requieren credencial gratuita para descargar el dato: USGS M2M (credenciales
  configuradas, aprobación del alcance de descarga pendiente) y NASA Earthdata
  cuando se pase de descubrir metadatos CMR a descargar el gránulo. CDSE puede
  requerir OAuth gratuito al descargar ciertos assets, aunque su STAC público
  funciona sin credenciales.
- Ninguna fuente se amplía masivamente en esta fase. La promoción significa
  conservar el adaptador y hacer la siguiente validación acotada, no ingerir
  catálogos completos.

## Autenticación, licencias y endpoints

- Planetary Computer: catálogo público
  `https://planetarycomputer.microsoft.com/api/stac/v1`; el código actual firma
  assets temporalmente en memoria.
- CDSE: STAC público `https://stac.dataspace.copernicus.eu/v1`; aviso legal de
  datos Sentinel enlazado por la colección. El endpoint legado fue deprecado en
  2025 y no se usa.
- USGS M2M: `https://m2m.cr.usgs.gov/api/docs/`; el usuario se configura en
  `TERRITORIO_USGS_M2M_USERNAME` y el Application Token gratuito en
  `TERRITORIO_USGS_M2M_TOKEN`. El backend usa `login-token` para obtener una
  API key temporal y nunca la persiste. La autenticación y `scene-search` ya se
  validaron con una escena real; `download-options` responde 403 hasta que USGS
  apruebe **ERS Profile → Request Access → M2M API**. USGS indica normalmente
  entre 24 y 48 horas laborables para revisar el acceso.
- NASA CMR: búsqueda pública
  `https://cmr.earthdata.nasa.gov/search/granules.umm_json`; para futuras
  descargas protegidas faltaría `TERRITORIO_EARTHDATA_TOKEN` de Earthdata Login.
- NASA GIBS: capabilities WMTS público
  `https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml`.

La atribución específica se conserva en cada escena. Sentinel usa Copernicus/
ESA/Comisión Europea; Landsat, USGS/NASA; y VIIRS/GIBS, NASA EOSDIS/LANCE. Si el
catálogo enlaza una licencia se conserva ese enlace sin parámetros.

## Validación y fase siguiente

Prioridad propuesta:

1. Ejecutar las pruebas de red sobre el AOI de Santo Domingo y congelar un único
   fixture saneado por PC, CDSE S2, CDSE S1, CMR y GIBS.
2. Cuando USGS apruebe M2M, repetir `Generar NDVI Landsat` para validar en red
   el flujo ya implementado `download-options` → `download-request` →
   `download-retrieve`, la lectura COG por ventana y el artefacto real.
3. Promover CDSE S2 como fallback óptico y GIBS como overlay temporal.
4. Implementar un producto SAR de inundación explícito antes de exponer S1 en UI.
5. Tras validar el único artefacto real, decidir si Landsat pasa a producción;
   no ampliar todavía a descargas masivas ni a otras colecciones.

Las pruebas offline están en `tests/test_remote_sensing_pilot.py` y
`tests/test_landsat_pilot.py`. Las llamadas
reales deben ejecutarse en un entorno con salida de red; no forman parte de CI
para evitar que una caída de proveedor rompa la suite determinista.
