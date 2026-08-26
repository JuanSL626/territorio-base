# Changelog

Bitácora de decisiones técnicas del proyecto — el porqué detrás del código,
para no volver a redescubrirlo. Formato libre, no sigue semver (esto es una
app, no una librería versionada).

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
