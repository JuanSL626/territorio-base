# Suite de aceptación — `services/api`

Antes de esta suite el repo tenía **cero tests**. Eso importa más de lo que parece:
el critique (`docs/migration/03-critique-2.md`) demostró que el pipeline legacy
producía un error de 59 puntos porcentuales en su estadística estrella y nadie se
enteró en producción. Una suite con AOIs fijos y tolerancias escritas es lo único
que le da credibilidad numérica a lo que este servicio publica.

```bash
uv run pytest -m "not network"   # subset offline (el que corre en CI)
uv run pytest                    # todo, incluida la red
uv run pytest -m network         # solo los que golpean PC/WRI
```

## Los 5 AOI de aceptación (`tests/fixtures/aoi/`)

Son los cinco casos que el critique pidió explícitamente, y cada uno existe para
romper algo distinto. Cada `.geojson` lleva su `por_que` en `properties`.

| Fixture | Dónde | Qué caso cubre |
|---|---|---|
| `santo-domingo-urbano` | −69.93, 18.47 · 23.4 ha | Control plano/urbano. NDVI bajo, ~99 % "Área construida". Una tile de DEM, una zona UTM. |
| `cordillera-central` | −70.99, 19.02 · 23.3 ha | Terreno empinado (2757–2986 m, pendiente media ~38 %). Es donde H3 más se nota. |
| `cruce-72w` | −72.00, 18.30 · 14.1 ha | Cruza el meridiano 72°O: zonas UTM 18N/19N. **El único caso donde los ítems de Sentinel-2 llegan en dos CRS distintas** y `odc.stac` tiene que reproyectar de verdad. |
| `borde-tile-dem` | −70.00, 18.45 · 14.0 ha | Cruza el meridiano 70°O, o sea una costura entre tiles de 1°×1° del Copernicus DEM: obliga a mosaiquear >1 ítem. |
| `multipolygon-con-hueco` | −69.91, 18.49 · 73.0 ha | Dos partes disjuntas, una con anillo interior. Cubre H11 (un recorte ingenuo convierte la dona en disco) y H16 (**el centroide de esta geometría cae dentro del hueco**, o sea fuera del AOI). |

## Tolerancias (`tests/fixtures/expected.json`)

Los valores de referencia salen de una corrida real contra Planetary Computer el
**2026-08-27**, con H1/H2/H3 ya corregidos. La regla que las gobierna:

| Bloque | Ventana | Por qué |
|---|---|---|
| `aoi` (área, bbox, EPSG) | **exacto**, ±0.001 ha | Sale solo de la geometría y de pyproj. No depende de ningún servicio. |
| Elevación | ±8 m (±6 m el rango) | Copernicus DEM GLO-30 es un dataset congelado: lo único que puede mover el número es el remuestreo de odc-stac al cambiar de versión. |
| Pendiente | ±25 % relativo, + **clase dominante fija** | Es una derivada del DEM sobre la grilla remuestreada, más sensible que la elevación. La clase dominante es lo que el usuario efectivamente lee. |
| NDVI | ±0.20, + **clase de densidad dominante fija** | El compuesto usa las 6 escenas menos nubladas de los **últimos 180 días**: la ventana se corre sola con el calendario, así que un valor exacto sería un test que se rompe solo. El invariante duro es el que H1 rompía: un AOI urbano nunca puede dar "dosel maduro". |
| WorldCover | ±3 pp, + `epoch_year == 2021` | WorldCover 2021 v200 también está congelado. El assert de época hace caer el test si vuelve a colarse una mezcla (H2). |
| Sumas de clases | 100 ± 0.01 | `slope_class_pct` y `ndvi_density_class_pct` (H5). |

Para regenerarlas después de un cambio deliberado del motor: correr el pipeline
sobre los 5 fixtures, revisar las diferencias **a mano** y recién ahí actualizar el
JSON, cambiando `medido_el`. Un `expected.json` regenerado sin leer el diff no vale
nada.

## Qué falla contra el código viejo (a propósito)

| Archivo | Fija |
|---|---|
| `test_h1_boa_offset.py` | H1 — offset BOA de Sentinel-2. El test numérico usa los DN reales del critique (red 1434 / nir 4955) y muestra el salto de clase 0.551 → 0.802. |
| `test_h2_worldcover_epoch.py` | H2 — una sola época. Reproduce cómo `max(dim="time")` se come el bosque y produce un mapa que no corresponde a ningún año publicado. |
| `test_h3_slope_mask.py` | H3 — máscara compartida (64 vs 36 píxeles) + la variante latente `nodata=0` (pendiente máxima de 1885 % contra 0 %). |
| `test_overlay_orientation.py` | Regresión #1 — norte-sur, **en las dos direcciones**: ni reintroducir el flip ni sacar la verificación pasan. |
| `test_raster_export.py` | La mejora sobre el export legacy: DEFLATE + tag nodata. |
| `test_contract.py` | Etiquetas, paletas, presets y mensajes de progreso, palabra por palabra según el inventario. |
| `test_api_offline.py` | Contrato HTTP, ciclo de vida del job, SSE, y el aislamiento de fallas por fuente (regresión #3). |
