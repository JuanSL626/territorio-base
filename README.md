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

No requiere ninguna cuenta ni API key. Si en el futuro se quiere sumar
Google Earth Engine (para series históricas tipo Hansen Global Forest
Change), eso sí requiere una cuenta de GEE aprobada.

## Uso

```bash
uv run streamlit run app.py
```

Se abre en el navegador. Ahí:
1. Dibujás el polígono sobre el mapa (o subís un KML/KMZ/GeoJSON existente).
2. Click en "Analizar zona".
3. Se muestran métricas, mapas y tablas por pestaña (Topografía, Vegetación,
   Hidrología/Áreas protegidas, Reporte), y se puede descargar el reporte en
   Markdown y las capas (DEM, pendiente, NDVI, WorldCover) como GeoTIFF.

## Probar el pipeline sin la interfaz (más rápido para depurar)

```bash
uv run python scripts/smoke_test.py /ruta/a/un/poligono.geojson
```

## Estructura

```
app.py                              # interfaz Streamlit
src/territorio_base/
  aoi.py                            # carga/normaliza el polígono (dibujo, KML, KMZ, GeoJSON) y calcula su UTM
  sources/
    stac.py                         # DEM, Sentinel-2/NDVI y WorldCover vía Planetary Computer
    osm.py                          # hidrología vía Overpass API
    protected_areas.py              # WDPA vía UNEP-WCMC FeatureServer
  analysis/
    topography.py                   # pendiente, orientación, estadísticas
    vegetation.py                   # estadísticas de NDVI y cobertura de suelo
    report.py                       # orquesta todo lo anterior y arma el reporte
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
