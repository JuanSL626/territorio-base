# Territorio Base

App para obtener un diagnóstico territorial preliminar de una zona
cualquiera a partir de fuentes abiertas, sin descargas ni GIS manuales:
dibujás (o subís) el polígono y te devuelve topografía, cobertura y
densidad arbórea, hidrología y áreas protegidas.

## Fuentes de datos (todas sin registro)

| Análisis | Fuente | Resolución |
|---|---|---|
| Topografía (elevación, pendiente) | Copernicus DEM GLO-30 (vía Microsoft Planetary Computer) | 30 m |
| NDVI / densidad de vegetación | Sentinel-2 L2A, mediana de las escenas menos nubladas de los últimos 180 días (vía Planetary Computer) | 10 m |
| Cobertura de suelo / % cobertura arbórea | ESA WorldCover 2021 (vía Planetary Computer) | 10 m |
| Hidrología | OpenStreetMap (Overpass API) — ríos, cuerpos de agua, humedales | vectorial |
| Áreas protegidas | WDPA (World Database on Protected Areas), vía el FeatureServer público de UNEP-WCMC | vectorial |
| Inundación costera (opcional, on-demand) | WRI Aqueduct Floods v2 (CC-BY) — profundidad de inundación por escenario climático/período de retorno | ~927 m |

No requiere ninguna cuenta ni API key. Si en el futuro se quiere sumar
Google Earth Engine (para series históricas tipo Hansen Global Forest
Change), eso sí requiere una cuenta de GEE aprobada.

## Uso

### Windows, sin usar la terminal

1. Descargá el repositorio (botón verde "Code" → "Download ZIP" en GitHub, o `git clone`) y descomprimilo.
2. Hacé doble click en **`Iniciar_App.bat`**.
3. La primera vez instala automáticamente `uv` (el gestor de Python que usa
   el proyecto) y las dependencias — puede tardar varios minutos. Las
   siguientes veces arranca directo.
4. Se abre solo en el navegador. Para cerrar la app, cerrá esa ventana negra
   (la consola) o presioná Ctrl+C en ella.

Requiere conexión a internet (para instalar dependencias la primera vez y
para bajar las imágenes satelitales en cada análisis). No hace falta tener
Python instalado de antes.

### Mac/Linux, o desde la terminal en Windows

```bash
uv run streamlit run app.py
```

Se abre en el navegador. Ahí:
1. Dibujás el polígono sobre el mapa (o subís un KML/KMZ/GeoJSON existente).
2. Click en "Analizar zona".
3. Se muestran métricas, mapas y tablas por pestaña (Mapa interactivo,
   Topografía, Vegetación, Hidrología/Áreas protegidas, Reporte), y se puede
   descargar el reporte en Markdown y las capas (DEM, pendiente, NDVI,
   WorldCover) como GeoTIFF.
4. En "Mapa interactivo" se puede prender/apagar cada capa y ajustar su
   opacidad, incluida una capa opcional de inundación costera (WRI Aqueduct)
   con varios escenarios climáticos/períodos de retorno para elegir.

## Probar el pipeline sin la interfaz (más rápido para depurar)

```bash
uv run python scripts/smoke_test.py /ruta/a/un/poligono.geojson
```

## Estructura

```
Iniciar_App.bat                     # doble click en Windows: instala todo y abre la app
app.py                              # interfaz Streamlit
src/territorio_base/
  aoi.py                            # carga/normaliza el polígono (dibujo, KML, KMZ, GeoJSON) y calcula su UTM
  sources/
    stac.py                         # DEM, Sentinel-2/NDVI y WorldCover vía Planetary Computer
    osm.py                          # hidrología vía Overpass API
    protected_areas.py              # WDPA vía UNEP-WCMC FeatureServer
    aqueduct.py                     # inundación costera vía WRI Aqueduct Floods (on-demand)
  analysis/
    topography.py                   # pendiente, orientación, estadísticas
    vegetation.py                   # estadísticas de NDVI, cobertura de suelo y clasificación de densidad
    report.py                       # orquesta todo lo anterior y arma el reporte
  mapview.py                        # capas del mapa interactivo (ImageOverlay + leyendas)
```

## Notas / límites conocidos

- La hidrología depende de qué tan mapeada esté la zona en OpenStreetMap —
  que no aparezca un curso de agua no es garantía absoluta de que no exista
  (para confirmar del todo conviene cruzar con INDRHI/Ministerio de Medio
  Ambiente si el proyecto lo amerita).
- El NDVI usa una mediana de varias escenas Sentinel-2 recientes para evitar
  nubes; en zonas muy nubladas puede no encontrar suficientes escenas
  (`max_cloud_cover`/`lookback_days` en `sources/stac.py:fetch_sentinel2_ndvi`
  son ajustables).
- Pensado para polígonos del orden de decenas a cientos de hectáreas; áreas
  mucho más grandes van a tardar más en descargar/procesar.
- La capa de inundación costera (WRI Aqueduct) es un screening, no un estudio
  de detalle: resolución ~927 m (varios pixeles pueden cubrir todo el
  polígono), proyecciones solo hasta 2080, metodología de 2020 basada en RCPs.
  Climate Central (coastal.climatecentral.org) usa un DEM propietario de mayor
  detalle y llega hasta 2150, pero no tiene API pública — solo mapa
  interactivo, sin datos descargables para integrar acá.
