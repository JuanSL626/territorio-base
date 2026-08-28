# Territorio Base — Inventario conductual de la app legacy (Streamlit)

> Documento de referencia para la migración a monorepo pnpm/Turborepo + TanStack Start.
> **Nada de lo que está acá puede perderse silenciosamente en la migración.**
> Generado a partir de la lectura completa de `app.py`, `src/territorio_base/**`,
> `README.md` y `CHANGELOG.md` antes de escribir una sola línea del nuevo stack.

---

## 1. Inventario de pantallas / regiones

La app legacy es un único script Streamlit que se renderiza de arriba hacia abajo,
gobernado por `st.session_state`. No hay rutas: todo es un rerun del script en cada
interacción.

| # | Región | ¿Siempre visible? | Qué muestra | Depende de |
|---|---|---|---|---|
| 1.1 | Cabecera | Sí | Título "Territorio Base" + caption con las fuentes | — |
| 1.2 | **"1. Definí la zona de estudio"** | Sí | Radio de modo + mapa de dibujo o file uploader | — |
| 1.2a | Mapa de dibujo | modo = "Dibujar en el mapa" | Mapa folium (OSM, centro `[18.453, -69.571]`, zoom 13) con toolbar Draw (solo polígono + rectángulo). Al dibujar: banner de éxito con área en ha | `folium.plugins.Draw`, `load_aoi_from_geojson_dict` |
| 1.2b | Subida de archivo | modo = "Subir archivo (KML/KMZ/GeoJSON)" | `file_uploader` (kml/kmz/geojson/json). Al subir: banner con área en ha | `load_aoi_from_bytes` |
| 1.3 | **"2. Analizá la zona"** | Sí | Botón "Analizar zona" (deshabilitado sin AOI), status box de progreso, banner de error si falla | `session_state["aoi"]`, `run_analysis` |
| 1.4 | **"3. Resultados"** | Solo con `results` | Métricas, banners y tabs | `results` de `run_analysis` |
| 1.4a | Fila de métricas | Con resultados | 4 tiles: Área, Elevación, Pendiente media, Cobertura arbórea | `aoi`, `topography.summary`, `vegetation.summary` |
| 1.4b | Banner áreas protegidas | Con resultados | 1 de 4 banners mutuamente excluyentes (error/warning/info/success) | `protected_areas.summary` |
| 1.4c | Banner hidrología | Con resultados, debajo de 1.4b | 1 de 4 banners mutuamente excluyentes | `hydrology.summary` |
| 1.4d | Barra de tabs | Con resultados | 5 o 6 tabs | `mepyd_rd["in_rd"]` |
| 1.4d-i | Tab **"Mapa interactivo"** | Siempre | Columna izq: controles de capas/opacidad. Columna der: mapa de resultados | `mapview.*`, todos los resultados, `aqueduct` |
| 1.4d-ii | Tab **"Topografía"** | Siempre | Gráfico de barras de clases de pendiente | `topography.summary.slope_class_pct` |
| 1.4d-iii | Tab **"Vegetación"** | Siempre | Dos gráficos: densidad NDVI y cobertura WorldCover | `vegetation.summary` |
| 1.4d-iv | Tab **"Hidrología / Áreas protegidas"** | Siempre | Dos subsecciones: tabla o texto de "sin resultados" | `hydrology.features`, `protected_areas.areas` |
| 1.4d-v | Tab **"Contexto RD (MEPyD)"** | Solo si `is_in_rd(aoi)` | Caption citando el portal MEPyD; subheaders por grupo con expanders por capa | `mepyd_rd.summary` |
| 1.4d-vi | Tab **"Reporte"** | Siempre, siempre último | Markdown completo + descarga .md + 4 descargas GeoTIFF | `to_markdown(results)`, rasters |
| 1.5 | Caption de estado vacío | Sin `results` | "Definí una zona y hacé click en «Analizar zona» para ver resultados acá." | ausencia de `results` |

**Orden de los controles en la columna izquierda del tab "Mapa interactivo"** (arriba→abajo):
DEM checkbox+slider · Pendiente checkbox+slider · NDVI checkbox+slider · Densidad NDVI checkbox+slider ·
WorldCover checkbox+slider · Hidrología checkbox · Áreas protegidas checkbox · (caption MEPyD condicional + divider) ·
divider · Inundación costera checkbox + selectbox de escenario + slider de opacidad + caption condicional.

**Orden de dibujo de capas en el mapa** (determina z-order y apilado de leyendas vía `legend_offset`):
Límite AOI → DEM → Pendiente → NDVI continuo → Densidad NDVI → WorldCover → Hidrología →
Áreas protegidas → capas MEPyD (`GroupedLayerControl`) → Inundación costera.

---

## 2. Inventario de controles

| Control | Tipo | Etiqueta exacta (ES) | Default | Rango / opciones | Efecto | Habilitado / deshabilitado |
|---|---|---|---|---|---|---|
| Modo AOI | `radio` horizontal | "¿Cómo querés definirla?" | "Dibujar en el mapa" | ["Dibujar en el mapa", "Subir archivo (KML/KMZ/GeoJSON)"] | Alterna mapa de dibujo / uploader | Siempre |
| Toolbar de dibujo | Leaflet Draw (`key="draw_map"`) | (iconos, sin label) | — | Habilitados: polígono, rectángulo. Deshabilitados: polyline, circle, circlemarker, marker. `export=False`. Editar/borrar quedan en default de Leaflet-Draw (habilitados) | Dibujar setea `aoi` y persiste en `session_state["aoi"]` | Solo en modo "Dibujar" |
| Subir polígono | `file_uploader` | "Subí el polígono" | vacío | `["kml","kmz","geojson","json"]` | Carga AOI desde bytes | Solo en modo "Subir archivo" |
| Analizar zona | `button` primary | "Analizar zona" | — | — | Corre `run_analysis`, llena `results` | `disabled` mientras `session_state["aoi"] is None` |
| Capa DEM | `checkbox` | "Elevación (DEM)" | `False` | on/off | Muestra overlay DEM + leyenda | Siempre |
| Opacidad DEM | `slider` (`op_dem`) | "Opacidad DEM" | `0.7` | 0.0–1.0 | Opacidad del overlay | `disabled` si la capa está off |
| Capa pendiente | `checkbox` | "Pendiente (%)" | `False` | on/off | Overlay de pendiente | Siempre |
| Opacidad pendiente | `slider` (`op_slope`) | "Opacidad pendiente" | `0.7` | 0.0–1.0 | Opacidad | `disabled` si off |
| Capa NDVI | `checkbox` | "NDVI (continuo)" | `False` | on/off | Overlay NDVI continuo | Siempre |
| Opacidad NDVI | `slider` (`op_ndvi`) | "Opacidad NDVI" | `0.7` | 0.0–1.0 | Opacidad | `disabled` si off |
| Capa densidad veg. | `checkbox` | "Densidad de vegetación (clasificada)" | **`True`** (única capa raster on por default) | on/off | Overlay clasificado | Siempre |
| Opacidad densidad veg. | `slider` (`op_ndvi_density`) | "Opacidad densidad vegetación" | `0.75` | 0.0–1.0 | Opacidad | `disabled` si off (por default está **habilitado**) |
| Capa WorldCover | `checkbox` | "Cobertura de suelo (WorldCover)" | `False` | on/off | Overlay categórico | Siempre |
| Opacidad WorldCover | `slider` (`op_worldcover`) | "Opacidad WorldCover" | `0.7` | 0.0–1.0 | Opacidad | `disabled` si off |
| Capa hidrología | `checkbox` | "Hidrología (OSM)" | `True` | on/off | Vectores de hidrología | Siempre. **Sin slider** (fijo 0.9) |
| Capa áreas protegidas | `checkbox` | "Áreas protegidas (WDPA)" | `True` | on/off | Polígonos WDPA | Siempre. **Sin slider** (fijo 0.8; relleno = 0.8×0.5) |
| Capa inundación costera | `checkbox` | "Inundación costera (WRI Aqueduct)" | `False` | on/off | Dispara fetch + cache y overlay | Siempre |
| Escenario costero | `selectbox` | "Escenario" | primer preset | 5 presets (§4) | Elige el raster a traer | `disabled` si la capa está off |
| Opacidad costera | `slider` (`op_coastal`) | "Opacidad inundación costera" | `0.8` | 0.0–1.0 | Opacidad | `disabled` si off |
| Capas MEPyD (~35) | `GroupedLayerControl` nativo de Leaflet | Panel agrupado, un checkbox por capa | todas ocultas (`show=False`) | on/off por capa | **100% client-side**, sin rerun. Grupos no exclusivos | El panel solo existe si ≥1 capa devolvió datos |
| Mapa de resultados | `st_folium` (`key="results_map"`, `returned_objects=[]`) | — | ajustado al bbox del AOI, zoom 15 | — | Solo navegación; explícitamente no devuelve estado | Siempre |
| Tabs | `st.tabs` | ver §1 | primer tab | 5 o 6 | Cambia de panel | Tab MEPyD condicional |
| Tablas hidro/AP | `st.table` | — | — | — | Display estático | Solo si la lista no está vacía; si no, "Sin elementos." / "Sin áreas encontradas." |
| Expander por capa MEPyD | `st.expander` | `"{label} ({count})"` | colapsado | — | Revela tabla de atributos | Uno por capa con ≥1 feature |
| Descargar reporte | `download_button` | "Descargar reporte (Markdown)" | — | — | `reporte_territorial.md` | Siempre en el tab Reporte |
| Descargar raster ×4 | `download_button` | `"Descargar {archivo}"` para `elevacion.tif`, `pendiente.tif`, `ndvi.tif`, `worldcover.tif` | — | — | GeoTIFF vía `rio.to_raster` | Siempre. **`aspect` no tiene botón** |

---

## 3. Contrato de datos (`run_analysis`)

Forma exacta del dict `results`. Este es el esquema que la nueva API debe reproducir.

```
results = {
  "aoi": {
    "area_ha": float,                      # hectáreas, calculado en CRS UTM
    "bbox": (minx, miny, maxx, maxy),      # tupla WGS84 lon/lat
    "utm_epsg": int,                       # ej. 32619, derivado del centroide
  },

  "topography": {
    "summary": {
      "elevation_min_m": float,
      "elevation_max_m": float,
      "elevation_mean_m": float,
      "elevation_range_m": float,          # max - min
      "slope_mean_pct": float,             # PORCENTAJE de pendiente (rise/run*100), NO grados
      "slope_max_pct": float,
      "slope_class_pct": {                 # claves = etiquetas exactas, suman ~100
        "Plano (0-5%)": float,
        "Suave (5-15%)": float,
        "Moderado (15-30%)": float,
        "Fuerte (>30%)": float,
      },
    },
    "dem": DataArray,                      # elevación, CRS = UTM del AOI, recortado al AOI
    "slope": DataArray,                    # pendiente %, misma grilla
    "aspect": DataArray,                   # grados 0-360 — CALCULADO PERO NUNCA USADO en la UI
  },

  "vegetation": {
    "summary": {
      "ndvi_mean": float,                  # -1..1
      "ndvi_median": float,
      "ndvi_p90": float,
      "ndvi_density_class_pct": {          # etiquetas exactas, suman ~100
        "Sin vegetación / suelo desnudo o agua": float,   # NDVI [-1.0, 0.2)
        "Vegetación dispersa / matorral bajo": float,     # NDVI [0.2, 0.4)
        "Vegetación densa / bosque secundario": float,    # NDVI [0.4, 0.6)
        "Vegetación muy densa / dosel maduro": float,     # NDVI [0.6, 1.0]
      },
      "worldcover_tree_cover_pct": float,  # % de píxeles con código 10
      "worldcover_landcover_pct": {        # DISPERSO: solo clases con pct > 0
        "<etiqueta WorldCover>": float,
      },
    },
    "ndvi": DataArray,
    "worldcover": DataArray,               # códigos enteros 10-100
  },

  "hydrology": {
    "summary": {
      "available": bool,                   # False solo si Overpass falló (los 5 mirrors)
      "features_found": int,
      "intersects_aoi": bool,
      "nearest_distance_m": float | None,  # None si no disponible o sin features
      "features": [
        { "osm_id": int, "kind": "waterway"|"water_body"|"wetland",
          "name": str | None, "distance_m": float },   # ordenado por distancia asc
      ],
    },
    "features": [HydrologyFeature, ...],   # dataclasses con geometría, para el mapa
  },

  "protected_areas": {
    "summary": {
      "available": bool,
      "areas_found": int,
      "intersects_aoi": bool,
      "overlap_ha": float,
      "overlap_pct_of_aoi": float,
      "nearest_distance_m": float | None,
      "areas": [
        { "name": str|None, "desig": str|None, "iucn_cat": str|None,
          "status": str|None, "distance_m": float, "overlap_ha": float },
      ],
    },
    "gdf": GeoDataFrame,                   # cols: name, desig, desig_eng, iucn_cat, status, mang_auth, geometry
  },

  "mepyd_rd": {
    "in_rd": bool,                         # bbox del AOI intersecta RD_BBOX (-72.05, 17.45, -68.30, 19.95)
    "summary": {
      "<grupo>": { "<capa>": { "count": int, "features": [ {...atributos dinámicos...} ] } },
    },
    "layers": { "<grupo>": { "<capa>": GeoDataFrame } },
  },
}
```

### Precisiones que importan para el esquema de la API

- Los campos `*_pct` ya vienen escalados 0–100, no 0–1.
- `slope_*_pct` es **porcentaje de pendiente** (rise/run×100), **no grados**. La clasificación
  del rewrite debe usar la misma unidad o los umbrales quedan mal.
- `slope_class_pct`, `ndvi_density_class_pct` y `worldcover_landcover_pct` son dicts **ordenados por
  inserción** cuyas etiquetas en español funcionan a la vez como clave estable y como texto de UI.
  El rewrite debería separar `code` de `label` en vez de usar el string como clave.
- `worldcover_landcover_pct` es **disperso**: las clases ausentes se omiten (no aparecen con 0.0).
- `available: False` es **semánticamente distinto** de "no encontré nada". Ambos, hidrología y áreas
  protegidas, usan este patrón y la diferencia gobierna el color y el texto del banner. Debe preservarse.
- El esquema de atributos de MEPyD es **dinámico por capa** (`outFields="*"`). Ver §6.
- `aspect` existe en el resultado pero **no tiene ninguna superficie**: sin estadística, sin mapa,
  sin descarga, sin mención en el reporte. Decisión explícita pendiente.
- El reporte Markdown **no incluye** los resultados de inundación costera (Aqueduct), aunque el
  usuario los haya visto en el mapa: viven solo en `session_state["coastal_cache"]`.
- `bbox` es una tupla de 4 floats `(lon_min, lat_min, lon_max, lat_max)`, no un array GeoJSON.

---

## 4. Catálogo de capas

| Capa (UI) | Tipo | Paleta / colores | Leyenda | Visible por default | Opacidad default | Fuente |
|---|---|---|---|---|---|---|
| Límite del AOI | Vector (línea) | `#3388ff`, weight 2, `fillOpacity: 0` | Swatch "Límite del AOI" | Siempre (no toggleable) | n/a | AOI del usuario |
| Elevación (DEM) | Raster continuo | cmap `terrain`, vmin/vmax = min/max reales del AOI (dinámico) | Rampa 5 pasos, `"{:.0f} m"` | Off | 0.7 | Copernicus DEM GLO-30 |
| Pendiente (%) | Raster continuo | cmap `YlOrRd`, vmin=0, vmax = **percentil 98** (recorta outliers) | Rampa 5 pasos, `"{:.0f}%"` | Off | 0.7 | Derivado (gradiente del DEM) |
| NDVI (continuo) | Raster continuo | cmap `RdYlGn`, vmin=-1.0, vmax=1.0 (fijo) | Rampa 5 pasos, `"{:.1f}"` | Off | 0.7 | Sentinel-2 L2A |
| Densidad de vegetación | Raster categórico (4 clases) | `#bfae96` · `#fee08b` · `#66bd63` · `#1a9850` | Una fila por clase | **On** (única raster on) | 0.75 | Derivado de NDVI, cortes [0.2, 0.4, 0.6] |
| Cobertura de suelo | Raster categórico (11 clases) | `WORLDCOVER_COLORS` (ver abajo) | Solo clases presentes en el AOI | Off | 0.7 | ESA WorldCover 2021 |
| Hidrología (OSM) | Vector | `waterway` `#1f78b4` · `water_body` `#08519c` · `wetland` `#41b6c4`, weight 3 | Solo tipos presentes | **On** | fijo 0.9 | OSM/Overpass, buffer 500 m |
| Áreas protegidas (WDPA) | Vector polígono | `#d95f02`, weight 2, relleno = opacidad×0.5 | "Área protegida (WDPA)" si no vacío | **On** | fijo 0.8 | UNEP-WCMC, buffer 1 km |
| Contexto RD (MEPyD), ~35 capas / 7 grupos | Vector (puntos/líneas/polígonos) | Paleta cualitativa de 12 colores, **un color por capa** (reciclada entre grupos, no dentro): `#e41a1c #377eb8 #4daf4a #984ea3 #ff7f00 #a65628 #f781bf #999999 #66c2a5 #fc8d62 #8da0cb #e78ac3`. Puntos → `CircleMarker` r=4. Polígonos → relleno 0.85×0.12 (bajo, borde fuerte), weight 2.5. Líneas → relleno 0.85×0.4, weight 2 | Sin leyenda propia: el panel de capas es la única clave (sin swatches) | Todas ocultas | fijo 0.85 | ~35 FeatureServers MEPyD, buffer 500 m |
| Inundación costera | Raster continuo (enmascarado a >0) | cmap `Blues`, vmin=0, vmax = `max(max_depth_m, 0.1)` en el render pero la leyenda usa `max_depth_m` crudo (**inconsistencia menor a corregir**) | Rampa 5 pasos, `"{:.1f} m"`, título con el preset | Off | 0.8 | WRI Aqueduct Floods v2 |

### Grupos MEPyD (orden y etiquetas exactas)

1. **División Político-Administrativa** — "Municipios (límites, provincia, región, población)"
2. **Amenaza sísmica (por nivel censal 2010)** — "Barrio/paraje", "Sección", "Distrito municipal", "Municipio", "Vulnerabilidad física de edificaciones (municipio)", "Riesgo sísmico (municipio)"
3. **Amenazas** — "Gasoductos y oleoductos (buffer 500 m)", "Almacenamiento de combustibles (buffer 1000 m)", "Vertederos (buffer 1500 m)", "Área propensa a licuefacción", "Amenaza de deslizamiento", "Áreas propensas a deslizamientos (SGN)", "Amenaza sísmica (zonificación)", "Área propensa a tsunami", "Área propensa a inundación", "Amenaza de ciclón"
4. **Agua** — "Plantas de tratamiento de residuales (INAPA)", "Plantas de tratamiento (INAPA)", "Drenaje (buffer 20 m)", "Drenaje (red)", "Canales de riego", "Ríos y arroyos"
5. **Infraestructuras y edificaciones** — "Líneas de transmisión eléctrica", "Obras de toma (canales INDRHI)", "Infraestructura de salud", "Subestaciones eléctricas", "Albergues", "Centros educativos", "Área construida"
6. **Vías** — "Calles", "Pistas", "Carreteras terciarias", "Carreteras secundarias", "Carreteras primarias", "Autovías", "Puentes"
7. **Áreas protegidas (MEPyD)** — "Área de amortiguamiento", "Área protegida"

Excluidas deliberadamente (docstring de `mepyd_rd.py`): imágenes GOES en vivo, huracanes activos NOAA,
cobertura Sentinel-2 (ya cubierta por WorldCover propio).

### Paleta ESA WorldCover

| Código | Hex | Etiqueta |
|---|---|---|
| 10 | `#006400` | Bosque / cobertura arbórea |
| 20 | `#ffbb22` | Matorral (shrubland) |
| 30 | `#ffff4c` | Pastizal |
| 40 | `#f096ff` | Cultivos |
| 50 | `#fa0000` | Área construida |
| 60 | `#b4b4b4` | Suelo desnudo / disperso |
| 70 | `#f0f0f0` | Nieve/hielo |
| 80 | `#0064c8` | Cuerpo de agua permanente |
| 90 | `#0096a0` | Humedal herbáceo |
| 95 | `#00cf75` | Manglar |
| 100 | `#fae6a0` | Musgo y liquen |

`TREE_COVER_CLASS = 10` (la métrica de cobertura arbórea usa solo ese código).

### Presets WRI Aqueduct (strings exactos)

1. `"Hoy (histórico) — 100 años de retorno"` → `scenario=historical, year=hist, return_period=100`
2. `"2050 · RCP4.5 (optimista) — 100 años"` → `scenario=rcp4p5, year=2050, return_period=100`
3. `"2050 · RCP8.5 (pesimista) — 100 años"` → `scenario=rcp8p5, year=2050, return_period=100`
4. `"2080 · RCP8.5 (pesimista) — 100 años"` → `scenario=rcp8p5, year=2080, return_period=100`
5. `"2080 · RCP8.5 (pesimista) — 1000 años (extremo)"` → `scenario=rcp8p5, year=2080, return_period=1000`

Todos comparten `subsidence="wtsub"` y `percentile=95`.

---

## 5. Fuentes de datos y citación

El reporte nuevo debe citar la fuente **por capa**. Esta tabla es el insumo.

| Fuente | Nombre oficial | Proveedor | Endpoint | Resolución | Licencia / registro | Caveats |
|---|---|---|---|---|---|---|
| DEM | Copernicus DEM GLO-30 | ESA, vía Microsoft Planetary Computer | STAC `planetarycomputer.microsoft.com/api/stac/v1`, colección `cop-dem-glo-30` | 30 m | Sin registro | — |
| NDVI | Sentinel-2 L2A | ESA Copernicus, vía Planetary Computer | mismo STAC, colección `sentinel-2-l2a` | 10 m | Sin registro | Mediana de las escenas menos nubladas de los últimos 180 días; filtro `eo:cloud_cover < 30`; top 6 escenas; máscara SCL {4,5,6,7,11}. Puede fallar en zonas persistentemente nubladas |
| Cobertura de suelo | ESA WorldCover 2021 | ESA, vía Planetary Computer | mismo STAC, colección `esa-worldcover` | 10 m | Sin registro | — |
| Hidrología | OpenStreetMap (`waterway`, `natural=water`, `natural=wetland`) | Comunidad OSM, vía Overpass API | 5 mirrors en orden: `overpass-api.de`, `z.overpass-api.de`, `lz4.overpass-api.de`, `overpass.kumi.systems`, `overpass.private.coffee` | Vectorial (colaborativo, variable) | Abierto, sin token | Que no aparezca un curso de agua no prueba que no exista — cruzar con INDRHI / Medio Ambiente si el proyecto lo amerita. **`overpass.osm.ch` excluido a propósito**: responde OK pero con 0 resultados en todo el Caribe (extracto regional) — falla en silencio con datos incompletos |
| Áreas protegidas | WDPA — World Database on Protected Areas | UNEP-WCMC (misma base que Protected Planet) | `data-gis.unep-wcmc.org/arcgis/.../The_World_Database_of_Protected_Areas/FeatureServer/1/query` | Vectorial | Abierto, sin token (elegido en vez de la API oficial de Protected Planet, que sí pide token) | — |
| Inundación costera | WRI Aqueduct Floods v2 (Ward et al., 2020) | World Resources Institute | `aqueduct.wridata.org/AqueductFloods20/<archivo>.tif` vía `/vsicurl/` (lecturas HTTP por ventana) | ~927 m (30 arcsec) | **CC-BY**, sin registro | Screening, no estudio de detalle. Proyecciones solo hasta 2080; metodología 2020 basada en RCPs. **URL muerta a no reusar**: `wri-projects.s3.amazonaws.com/AqueductFloodTool`. Climate Central descartado (DEM propietario, sin API pública) |
| Contexto RD | Sistema de Información para la GRD y la AC | MEPyD, República Dominicana | ~35 FeatureServers en `services3.arcgis.com/DYnzeQNyuMo2mJ1o/...` | Vectorial | Abierto, sin token | Solo si el AOI intersecta `RD_BBOX`. Descubierto por ingeniería inversa del Experience Builder del "Explorador de Riesgo 2.1". Una capa que falla se omite en silencio. Paginación por `resultOffset`/`exceededTransferLimit` (tope 10 páginas) — agregada porque capas densas se truncaban silenciosamente en `maxRecordCount` |

---

## 6. Atributos disponibles por tipo de feature (para click-to-inspect)

**Hidrología (OSM)** — esquema fijo:
`osm_id: int` · `kind: "waterway"|"water_body"|"wetland"` · `name: str|None` (tag `name` de OSM, muchas veces ausente) · `geometry` · `distance_m` (derivado).
El tooltip actual muestra solo `name or kind`.

**WDPA** — `outFields` fijos: `name, desig, desig_eng, iucn_cat, status, mang_auth`.
El resumen expone solo `name, desig, iucn_cat, status, distance_m, overlap_ha`.
**`mang_auth` y el `desig` original se traen pero nunca se muestran** — decisión explícita pendiente.

**MEPyD** — `outFields="*"`, esquema **totalmente dinámico y distinto por capa** (~35 capas, cada una con
su propia tabla de atributos). Implicancias para el rewrite:
- No existe un tipo TS estático para "feature MEPyD": o es `Record<string, unknown>` o hay que curar
  columnas por capa (curación que hoy no existe).
- El único campo que el código busca por nombre es un heurístico de display: el primero de
  `("MUN_NOM", "NOMBRE", "nombre", "name")`; si ninguno existe, el tooltip cae a la etiqueta de la capa.
- La tabla mostrada es "todas las columnas que devolvió el servicio, menos geometría" → cantidad y
  nombres de columnas efectivamente ilimitados. Hay que renderizar defensivamente (tabla de columnas dinámicas).
- `fetch_all` descarta capas vacías **antes** de `summarize()`, así que toda capa presente tiene `count >= 1`.

---

## 7. Casos de uso

**Definición del AOI**
- **UC-01** Dibujar polígono/rectángulo → banner `Polígono dibujado: {ha} ha`, AOI en sesión.
- **UC-02** Subir GeoJSON/KML/KMZ válido → banner `Polígono cargado: {ha} ha`. Varias geometrías se unen en una.
- **UC-03** Subir archivo corrupto → la carga lanza excepción **no capturada** por `app.py` → traceback crudo de Streamlit, no un error elegante.
- **UC-04** Cambiar de modo teniendo ya un AOI → el AOI previo **no se limpia**; "Analizar zona" sigue habilitado contra un AOI viejo.
- **UC-05** Dibujar un AOI nuevo después de un análisis exitoso, sin re-analizar → el mapa muestra el borde del AOI nuevo pero las capas siguen siendo del AOI viejo (desincronización visible).

**Ejecución**
- **UC-06** "Analizar zona" sin AOI: imposible por UI (botón deshabilitado) — el estado deshabilitado es en sí un caso a preservar.
- **UC-07** Análisis exitoso → mensajes de progreso secuenciales (DEM → Sentinel-2/NDVI → WorldCover → hidrología → áreas protegidas → [MEPyD]) → "Análisis completo" → sección de resultados.
- **UC-08** `run_analysis` lanza → status en estado error, `st.error` con el texto crudo, y **los resultados previos siguen visibles** (solo se sobreescriben en éxito).
- **UC-09** Overpass falla en los 5 mirrors → capturado, el análisis sigue, `hydrology.available = False`.
- **UC-10** WDPA falla → capturado, el análisis sigue, `protected_areas.available = False`.
- **UC-11** AOI fuera de RD → `is_in_rd` False, MEPyD se omite entero (sin llamadas de red), sin tab, sin sección en el reporte, sin capas.
- **UC-12** AOI dentro/cerca de RD → tab presente; ~35 capas en paralelo (10 workers); capa fallida o vacía se descarta en silencio; si todas fallan, el tab existe con "Sin resultados…".

**Banners**
- **UC-13..16** Áreas protegidas: (a) `available=False` → error; (b) intersecta → warning con nombre, designación y solapamiento ha/%; (c) hay cerca sin intersección → info con conteo y distancia; (d) cero → success.
- **UC-17..20** Hidrología: (a) `available=False` → error; (b) intersecta → warning genérico (sin nombre); (c) cerca sin intersección → info con conteo y distancia; (d) cero → success.

**Capas del mapa**
- **UC-21** Cada raster se togglea independiente; cada slider deshabilitado salvo que su checkbox esté on; varias leyendas se apilan sin superponerse (`legend_offset`).
- **UC-22** Hidrología / áreas protegidas se togglean (sin control de opacidad).
- **UC-23** Costera off → sin fetch, sin mensajes, selectbox y slider deshabilitados.
- **UC-24** Costera on, preset sin cachear → spinner "Descargando inundación costera (…)…", resultado cacheado en sesión.
- **UC-25** Preset ya cacheado → sin spinner, reuso inmediato.
- **UC-26** `has_data=False` → warning "No hay cobertura de datos de Aqueduct para esta zona.", sin overlay.
- **UC-27** `has_data=True`, `pct_area_flooded=0` → success con la resolución, sin overlay.
- **UC-28** `pct_area_flooded>0` → warning con % y profundidad máx., overlay Blues + leyenda.
- **UC-29** Panel MEPyD: toggle por capa, client-side, sin rerun, grupos no exclusivos.

**Tabs y descargas**
- **UC-30** Topografía: barras de clases de pendiente.
- **UC-31** Vegetación: dos gráficos (densidad NDVI, WorldCover).
- **UC-32** Hidrología / áreas protegidas: tablas o texto de vacío, independiente por sección.
- **UC-33** Contexto RD: subheaders por grupo, expanders por capa con tablas dinámicas; "Sin resultados…" si vacío.
- **UC-34** Reporte: Markdown renderizado + descarga .md + 4 GeoTIFF (**sin aspect**).
- **UC-35** Sin resultados → solo el caption de estado vacío.

---

## 8. Casos de prueba

> Enfoque de validación: los casos se expresan por **texto visible y roles accesibles**, no por
> `data-testid` de Streamlit, para que transfieran directamente a la UI nueva. Validación con
> Puppeteer MCP (`puppeteer_navigate`, `puppeteer_click`, `puppeteer_fill`, `puppeteer_evaluate`,
> `puppeteer_screenshot`). **Cada caso se valida 2 veces antes de pasar al siguiente.**

| # | Precondiciones | Pasos | Resultado esperado |
|---|---|---|---|
| TC-01 | App recién cargada, sin AOI | Cargar | "Analizar zona" deshabilitado |
| TC-02 | App limpia | Dibujar polígono | Banner "Polígono dibujado:" con ha; botón se habilita |
| TC-03 | App limpia | Cambiar a "Subir archivo", subir `.geojson` válido | Banner "Polígono cargado:"; botón habilitado |
| TC-04 | Igual que TC-03 | Subir archivo corrupto | Comportamiento actual: error crudo, no elegante. Confirmar para decidir si el rewrite lo arregla |
| TC-05 | AOI definido | Click "Analizar zona" | Progreso secuencial en orden; termina "Análisis completo"; aparecen las 4 métricas |
| TC-06 | Forzar fallo de `run_analysis` | Click "Analizar zona" | "Falló el análisis"; banner "Error corriendo el análisis:"; si había resultados previos, siguen visibles |
| TC-07 | `protected_areas.available=False` | Ver resultados | Error: "No se pudo consultar áreas protegidas (WDPA) — el servicio no respondió. El resto del análisis sí se completó." |
| TC-08 | AOI intersecta WDPA | Ver resultados | Warning "⚠️ El polígono SÍ intersecta un área de la WDPA:" + nombre + designación + solapamiento |
| TC-09 | WDPA cerca sin intersección | Ver resultados | Info "No hay intersección, pero hay N área(s) WDPA a X m del polígono." |
| TC-10 | Cero WDPA | Ver resultados | Success "No se encontraron áreas protegidas (WDPA) cerca del polígono." |
| TC-11 | `hydrology.available=False` | Ver resultados | Error "No se pudo consultar hidrología (Overpass API) — el servicio no respondió. El resto del análisis sí se completó." |
| TC-12 | Hidrología intersecta | Ver resultados | Warning "⚠️ Hay un curso/cuerpo de agua de OSM que intersecta el polígono." |
| TC-13 | Hidrología cerca sin intersección | Ver resultados | Info "No hay intersección, pero hay N elemento(s) de hidrología a X m." |
| TC-14 | Cero hidrología | Ver resultados | Success "No se encontró hidrología mapeada en OSM cerca del polígono." |
| TC-15 | Con resultados | Tab "Mapa interactivo", prender "Elevación (DEM)" | Overlay renderiza; su slider pasa a habilitado |
| TC-16 | DEM apagado | Verificar | "Opacidad DEM" deshabilitado por default |
| TC-17..20 | Idem | Repetir para Pendiente, NDVI, Densidad NDVI (**default ON → slider habilitado por default, única excepción**), WorldCover | El estado del slider espeja exactamente su checkbox |
| TC-21 | Con resultados | Toggle hidrología y áreas protegidas | Capas aparecen/desaparecen; **no existe slider** para ninguna |
| TC-22 | AOI fuera de RD | Ver tabs | Sin caption MEPyD, sin tab "Contexto RD (MEPyD)", 5 tabs |
| TC-23 | AOI dentro de RD | Ver tabs | Caption presente, tab presente, 6 tabs |
| TC-24 | AOI en RD, ≥1 capa con datos | Abrir panel de capas | Grupos con sub-capas individualmente marcables, todas desmarcadas; marcar una actualiza el mapa **sin recarga** |
| TC-25 | AOI en RD, todas las capas vacías/fallidas | Ver tab | Sin panel de capas, pero el tab muestra "Sin resultados (servicios sin respuesta o sin elementos cerca del AOI)." |
| TC-26 | Costera off | Ver panel | "Escenario" y "Opacidad inundación costera" deshabilitados |
| TC-27 | Prender costera, preset nuevo | — | Spinner "Descargando inundación costera (…)…" aparece y se resuelve |
| TC-28 | `has_data=False` | Ver panel | Warning "No hay cobertura de datos de Aqueduct para esta zona."; sin overlay ni leyenda |
| TC-29 | `pct_area_flooded=0` | Ver panel | Success "Sin inundación proyectada en el AOI para «{preset}» (resolución ~X m)."; sin overlay |
| TC-30 | `pct_area_flooded>0` | Ver panel y mapa | Warning con % y profundidad máx.; overlay Blues + leyenda |
| TC-31 | Preset ya visitado | Reseleccionarlo | No reaparece el spinner (cache hit) |
| TC-32 | Con resultados | Tab "Topografía" | Barras con las 4 etiquetas exactas de clase de pendiente |
| TC-33 | Con resultados | Tab "Vegetación" | Dos gráficos; las clases WorldCover ausentes **no** se listan |
| TC-34 | Con hidrología | Tab "Hidrología / Áreas protegidas" | Tabla con osm_id/kind/name/distance_m; filas = `features_found` |
| TC-35 | Sin hidrología | Idem | Texto "Sin elementos." en vez de tabla |
| TC-36 | Sin WDPA | Idem, subsección AP | Texto "Sin áreas encontradas." |
| TC-37 | AOI en RD | Tab MEPyD, expandir una capa | Header `"{label} ({count})"`; tabla con columnas variables por capa |
| TC-38 | (Rama muerta hoy) | — | "Sin atributos." solo sería alcanzable con una capa de 0 features, que el fetch ya descarta. Decidir si el rewrite mantiene la rama defensiva |
| TC-39 | Con resultados | Tab "Reporte" | Markdown con todos los headers esperados, incluido el condicional de RD |
| TC-40 | Tab Reporte | Click "Descargar reporte (Markdown)" | Descarga `reporte_territorial.md` con el contenido renderizado |
| TC-41..44 | Tab Reporte | Click en cada una de las 4 descargas de raster | GeoTIFF válido por archivo (verificar firma `II*\0` / `MM\0*`) |
| TC-45 | — | Verificar | **No existe** botón de descarga de `aspect` (confirma el hueco actual) |
| TC-46 | Sin resultados | Cargar y no analizar | Solo el caption de estado vacío; sin header "3. Resultados" |
| TC-47 | Análisis exitoso previo | Dibujar otro AOI sin re-analizar | Borde del AOI nuevo con overlays del AOI viejo (desincronización visible) |
| TC-48 | AOI dibujado | Cambiar de modo sin subir nada y volver | El AOI se recuerda; el botón sigue habilitado |

---

## 9. Bugs conocidos / regresiones a NO repetir

1. **Rasters espejados norte-sur.** Se aplicaba `np.flipud` a arrays que ya venían con fila 0 = norte
   (que es justo lo que espera un PNG para calzar con `bounds=[[south,west],[north,east]]`).
   `mapview.py::_rgba_to_data_uri` tiene un comentario explícito advirtiéndolo.
   **Preservar:** cualquier pipeline raster→imagen del nuevo stack debe verificar independientemente
   la orientación contra su convención de bounds. Es trivial reintroducir esto con otra librería.

2. **Overpass como punto único de falla.** Historial: (a) solo `overpass-api.de`, 504 en pico;
   (b) se sumaron mirrors de terceros; (c) se probó `overpass.osm.ch` y devuelve **0 resultados en
   todo el Caribe** — rechazado por ser *peor que no tener fallback* (falla en silencio con datos
   incompletos); (d) lista final de 5 URLs, verificando que `z`/`lz4` comparten `timestamp_osm_base`
   con el cluster principal; (e) en producción los 3 del cluster principal fallaron juntos
   (bloqueo a nivel de infra contra la IP de salida), por eso hay 2 proveedores genuinamente
   independientes. Timeout `(connect=5s, read=30s)` para fallar rápido.
   **Preservar:** fallback multi-mirror con proveedores independientes, connect timeout corto, y
   nunca tratar "el servidor respondió 200" como prueba de datos completos.

3. **La caída de un servicio externo tumbaba todo el análisis.** No había manejo de error alrededor
   de Overpass ni WDPA: un servicio caído mataba resultados de topografía/vegetación ya descargados.
   **Preservar:** aislamiento de fallas por fuente, con el booleano `available` distinguido de
   "consulté y no hay nada", reflejado distinto en UI y en el reporte. La nueva API no puede dejar
   que una llamada de terceros haga fallar el request entero.

4. **Polígonos de "Amenazas" MEPyD ilegibles por apilado de relleno.** Varias capas de amenaza se
   superponen; con `fillOpacity ~0.34` dos o tres se mezclaban en un color sólido que no coincidía
   con ninguna entrada de leyenda (todo el AOI como un blob rosa). Se bajó el relleno a ~0.10 y se
   subió el peso del borde. Al mismo tiempo se arregló un **bug de closure tardío**: variables por
   iteración no capturadas como argumentos default en el `style_function`, así que todas las capas
   del grupo se renderizaban con el estilo de la última iteración.
   **Preservar:** relleno bajo + borde fuerte para polígonos de amenaza superpuestos, y cuidado
   explícito con la captura de variables por iteración en cualquier loop que genere estilos.

5. **Capas de puntos MEPyD renderizadas como pines default, ignorando el color de capa.** folium
   aplica `style_function` a líneas/polígonos pero no a markers, así que "Infraestructura de salud"
   (~1600 puntos) salía como pines azules genéricos, ilegibles a esa densidad. Se pasó a `CircleMarker`
   coloreado por capa.
   **Preservar:** los puntos necesitan estilo explícito por capa y una representación liviana
   (no pines) cuando hay miles de features.

6. **El toggle de capas MEPyD requería rerun completo y solo funcionaba por grupo.** Se reemplazó por
   `GroupedLayerControl`: las ~35 capas se agregan ocultas y se togglean client-side, no exclusivas.
   **Preservar:** toggle **por capa** (no por grupo) y sin round-trip al servidor.

7. **Todas las capas de un grupo MEPyD compartían color**, haciendo indistinguibles las amenazas
   superpuestas. Se pasó a una paleta cualitativa de 12 colores ciclada **por capa**.
   **Preservar:** color distinto por capa individual, reciclado entre grupos y no dentro.

8. **`load_aoi_from_bytes` dependía de `fiona`, dependencia no declarada** (el proyecto usa `pyogrio`),
   rompiendo toda subida KML/KMZ con `ModuleNotFoundError`. Se arregló con `zipfile` de stdlib +
   `read_file(driver="KML")`.
   **Preservar:** el parser de KML/KMZ del nuevo stack debe ser una dependencia explícita e instalada.

9. **`requirements.txt` debe regenerarse desde `uv.lock`** cuando cambian dependencias. Señal de que
   este proyecto ya se quemó con drift entre lockfile y dependencias desplegadas: el nuevo stack debe
   fijar dependencias desde una sola fuente de verdad.

### Rarezas adicionales encontradas en esta auditoría (decidir explícitamente, no arrastrar en silencio)

- **Resultados obsoletos tras un re-análisis fallido** (UC-08 / TC-06): si se vuelve a analizar y falla,
  los `results` previos siguen renderizando debajo del error, potencialmente de otro AOI.
- **Desincronización AOI/resultados al redibujar sin re-analizar** (UC-05 / TC-47): el mapa siempre
  muestra el AOI actual de sesión, independientemente de cuál produjo los datos cargados. Se arregla
  con un campo "AOI que produjo estos resultados" como única fuente de verdad.
- **Inconsistencia de `vmax` en la leyenda costera**: el overlay usa `max(max_depth_m, 0.1)` y la
  leyenda usa `max_depth_m` crudo. Divergen para profundidades máximas muy bajas.
- **`aspect` totalmente huérfano**: se calcula y se devuelve, pero no se resume, no se mapea, no se
  descarga y no aparece en el reporte.
- **La inundación costera no aparece en el reporte Markdown** aunque el usuario la haya explorado:
  vive solo en `session_state["coastal_cache"]`. Hueco real de contenido si el reporte pretende ser
  un artefacto completo.
- **"Sin atributos." de MEPyD es código muerto**: `fetch_all` descarta capas vacías antes de
  `summarize()`, así que la rama nunca se ejecuta.
