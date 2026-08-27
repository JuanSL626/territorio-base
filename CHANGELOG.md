# Changelog

Bitácora de decisiones técnicas del proyecto — el porqué detrás del código,
para no volver a redescubrirlo. Formato libre, no sigue semver (esto es una
app, no una librería versionada).

## 2026-08-27

### Contexto RD (MEPyD): colores por capa individual en el mapa

- El toggle de mapa por grupo (ej. "Amenazas") pintaba todas sus capas del
  mismo color — con varias amenazas superpuestas (sísmica, tsunami,
  inundación, ciclón, licuefacción...) el AOI terminaba cubierto por un
  único bloque de color, sin poder distinguir una amenaza de otra.
- `mapview.add_mepyd_group_layer` ahora asigna un color distinto por capa
  dentro del grupo (paleta cualitativa de 12 colores, reciclada por grupo),
  y `mapview.mepyd_legend_items(group, layers)` genera una leyenda con una
  línea por capa en vez de una sola línea por grupo.

### Hidrología (OSM) más resiliente a caídas de Overpass

- El mirror principal de Overpass (`overpass-api.de`) empezó a devolver
  504 Gateway Timeout de forma intermitente en producción (Streamlit
  Community Cloud) — es un servicio público compartido y se satura seguido
  en horas pico, no es algo que dependa de nuestro código.
- `sources/osm.py` ahora prueba una lista de mirrors públicos alternativos
  en orden (`overpass.kumi.systems`, `overpass.private.coffee`) antes de
  fallar, en vez de pegarle siempre al mismo endpoint. Ninguno requiere
  cuenta ni token.

### Contexto República Dominicana (MEPyD)

- Se integró como insumo adicional el "Sistema de Información para la GRD y
  la AC" del Ministerio de Economía, Planificación y Desarrollo
  (https://riesgos.mepyd.gob.do), un portal ArcGIS Hub con datos de riesgo
  de desastres específicos de República Dominicana que nuestras fuentes
  globales (WorldCover, WDPA, Aqueduct) no cubren.
- En vez de descargar los shapefiles estáticos del catálogo de datos
  abiertos del portal, se encontró (inspeccionando la configuración del
  Experience Builder de su "Explorador de Riesgo 2.1" vía
  `arcgis.com/sharing/rest/content/items/{id}/data`) que esas mismas capas
  están servidas como ~35 FeatureServers públicos de ArcGIS Online, sin
  token, con soporte de consulta espacial directa — mismo patrón que ya
  usábamos para WDPA en `sources/protected_areas.py`. Se optó por consultar
  esos servicios en vivo (`sources/mepyd_rd.py`) en vez de bajar/cachear
  shapefiles.
- Las ~35 capas se agruparon exactamente igual que en el árbol de capas de
  ese Explorador de Riesgo (mismos nombres de grupo: División
  Político-Administrativa, Amenaza sísmica por nivel censal, Amenazas,
  Agua, Infraestructuras y edificaciones, Vías, Áreas protegidas), para que
  el resultado sea reconocible por alguien que ya conoce ese portal. Se
  excluyeron del mismo mapa los feeds que no son datos propios de
  MEPyD/RD: imágenes satelitales GOES en vivo, huracanes activos de NOAA
  (feed global efímero) y cobertura Sentinel-2 (ya cubierta por nuestra
  propia fuente ESA WorldCover).
- Como son datos de alcance nacional (RD), esta fuente se activa solo si
  el AOI cae dentro de un bbox aproximado del país (`mepyd_rd.is_in_rd`) —
  para cualquier otra zona del mundo se omite sin costo.
- Las consultas se paralelizan (`ThreadPoolExecutor`, 10 workers) porque
  son ~35 servicios de terceros con latencia variable; una capa que falla
  se descarta en silencio en vez de tumbar el análisis completo. Se
  implementó paginación por `resultOffset` respetando el flag
  `exceededTransferLimit` de ArcGIS REST — sin esto, capas densas (ej.
  "Infraestructura de salud", con miles de puntos a nivel nacional)
  truncaban resultados en `maxRecordCount` sin avisar.
- Probado end-to-end contra un polígono real en Santo Domingo (vía la app
  en el navegador): aparece como pestaña "Contexto RD (MEPyD)" (solo
  cuando el AOI está en RD), como capas togglables más en el mapa
  interactivo (un color por grupo, para no saturar el mapa con ~35
  colores), y como sección en el reporte Markdown descargable.

## 2026-08-26

### Fuentes de datos

- Todo el análisis (topografía, vegetación, hidrología, áreas protegidas)
  se construyó sobre fuentes **abiertas y sin registro**: STAC de Microsoft
  Planetary Computer (DEM, Sentinel-2, ESA WorldCover), Overpass API de
  OpenStreetMap, y el FeatureServer público de UNEP-WCMC para WDPA (en vez
  de la Protected Planet API oficial, que pide token).
- Para inundación costera se evaluó usar el mapa de Climate Central
  (coastal.climatecentral.org), pero su CoastalDEM es un dataset propietario
  sin API pública (solo acceso por solicitud para investigadores). Se
  integró en cambio **WRI Aqueduct Floods v2** (CC-BY, sin registro) como
  reemplazo abierto — con menor resolución (~927m) y proyecciones solo
  hasta 2080, documentado como limitación conocida.
  - La URL pública "conocida" de Aqueduct
    (`wri-projects.s3.amazonaws.com/AqueductFloodTool`) está muerta (devuelve
    delete markers). La vigente, verificada, es
    `https://aqueduct.wridata.org/AqueductFloods20/`.
  - Los GeoTIFFs son globales (~45MB c/u); se leen por HTTP con lectura por
    ventana (GDAL `/vsicurl/`) para no descargar el archivo completo.

### Bugs corregidos

- `load_aoi_from_bytes` (carga de KML/KMZ subidos desde la app) dependía de
  `fiona`, que no es dependencia del proyecto (se usa `pyogrio`) — fallaba
  con `ModuleNotFoundError` al subir un archivo. Corregido usando `zipfile`
  (stdlib) para extraer el KML de un KMZ, y `geopandas.read_file(...,
  driver="KML")` para ambos casos.
- Las capas del mapa interactivo aparecían volteadas norte-sur: se aplicaba
  `np.flipud` de más sobre arrays que ya vienen con fila 0 = norte (orden
  estándar de raster), que es justo lo que un PNG espera para calzar con
  `bounds=[[south,west],[north,east]]` en un `ImageOverlay` de folium.

### Mapa interactivo

- Se agregó `mapview.py`: cada capa (DEM, pendiente, NDVI, densidad de
  vegetación clasificada, WorldCover, hidrología, áreas protegidas,
  inundación costera) se puede prender/apagar y ajustar su opacidad, con
  leyenda propia. Las leyendas se apilan calculando su alto real
  (`legend_height_px`) en vez de usar offsets fijos a mano, que no escalaba
  a tener muchas capas encendidas a la vez.

### Distribución

- Se agregó `Iniciar_App.bat` para que alguien sin experiencia técnica
  pueda usar la app en Windows con un doble click (instala `uv` solo si
  falta, sincroniza dependencias, levanta la app).
- **Limitación real encontrada:** en una PC de trabajo con políticas de IT
  (Windows Defender for Endpoint / Group Policy), instalar o ejecutar
  programas nuevos puede quedar bloqueado con el mensaje *"This program is
  blocked by group policy"* — confirmado en la práctica al intentar correr
  `uv.exe` recién instalado. No tiene solución posible desde el script, es
  una política a nivel de sistema operativo.
- Por eso se preparó el repo para **desplegar en Streamlit Community
  Cloud** (`requirements.txt` generado desde `uv.lock` vía `uv export`,
  `runtime.txt` fijando Python 3.11): un link que se abre en el navegador
  sin instalar nada, evitando el problema anterior. Verificado con
  `pip install -r requirements.txt` en un entorno limpio (sin `uv`) que la
  app corre igual — importante porque el proyecto usa layout `src/`, así
  que necesita el propio paquete instalado (`-e .` en requirements.txt)
  para que `territorio_base` sea importable.
- Al conectar el repo en share.streamlit.io dio "This repository does not
  exist": la cuenta tenía a Streamlit conectado como **OAuth App clásica**
  de GitHub (permiso "Access public repositories" nada más), no como el
  modelo más nuevo de "GitHub App" con selección de repos privados. Con una
  OAuth App clásica no hay forma de darle acceso a un repo privado
  puntual — por eso el repo pasó a público (se revisó antes que el código
  no tuviera datos de ningún cliente).
