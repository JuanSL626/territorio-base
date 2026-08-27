# CORRECCIONES DE CORRECTITUD — motor raster (`services/api`)

**Fecha:** 2026-08-27 · **Alcance:** `services/api/src/territorio_base_api/`
**Insumo:** los hazards H1–H16 verificados en `03-critique-2.md`, contra el código
legacy inventariado en `00-legacy-inventory.md`.

> **Por qué esto va primero, antes de una línea de port.**
> El memo de decisión (`01-engine-decision-memo.md`) vendía la opción híbrida como
> *"cero regresión, números idénticos"*. El critique demostró que eso confunde
> **paridad con el Python de hoy** con **correctitud**: el Python de hoy está mal.
> Portar primero y corregir después habría hecho imposible distinguir un bug del
> port de un bug heredado. Estas correcciones van en un cambio propio, comentado
> en el código, con tests que **fallan a propósito contra la versión vieja**.

Números medidos en vivo contra Microsoft Planetary Computer el 2026-08-27, sobre
los cinco AOI de aceptación que ahora viven en `services/api/tests/fixtures/aoi/`.

---

## Resumen

| # | Severidad | Qué estaba mal | Impacto medido | Dónde se arregló | Test |
|---|---|---|---|---|---|
| **H1** | CRÍTICA | Sentinel-2 L2A: no se aplicaba `BOA_ADD_OFFSET` antes del NDVI | La clase de densidad **dominante cambia**: Cordillera Central pasa de "dispersa / matorral bajo" 99.7 % a "muy densa / dosel maduro" 87.8 % | `sources/stac.py` | `tests/test_h1_boa_offset.py` |
| **H2** | ALTA | WorldCover: `.max(dim="time")` mezclaba las épocas 2020 y 2021 | Cobertura arbórea 72.8 % → **87.0 %** en el AOI de costura de tiles (14.2 pp) | `sources/stac.py` | `tests/test_h2_worldcover_epoch.py` |
| **H3** | MEDIA | Elevación y pendiente se resumían sobre conjuntos de píxeles distintos | 22.6 % menos píxeles para la pendiente en el AOI MultiPolygon; elevación máxima 57.7 → 56.9 m | `analysis/topography.py` | `tests/test_h3_slope_mask.py` |
| H5 | BAJA | Las 4 clases de densidad NDVI no sumaban 100 % | Ahora suman 100 ± 0.01 siempre | `sources/stac.py`, `analysis/vegetation.py` | `test_h1_*`, `test_h3_*` |
| H16 | LATENTE | La zona UTM se elegía con el centroide, que puede caer fuera del AOI | Elimina la elección de zona equivocada cerca de 72°O | `aoi.py` | `tests/test_aoi.py` |
| — | ALTA | El export GeoTIFF no tenía compresión ni tag nodata | El relleno de fuera del AOI ya no se abre en QGIS como si fuera dato | `render/raster_io.py` | `tests/test_raster_export.py` |

---

## H1 — `BOA_ADD_OFFSET` de Sentinel-2 (CRÍTICA)

### El bug

`stac.py:96` del legacy calculaba `ndvi = (nir - red) / (nir + red)` sobre **DN
crudos**. Desde la *processing baseline* 04.00 (productos generados a partir del
2022-01-25) los L2A de Copernicus se distribuyen con un desplazamiento aditivo:

```
reflectancia = (DN + BOA_ADD_OFFSET) / BOA_QUANTIFICATION_VALUE
             = (DN − 1000) / 10000
```

Un **factor de escala se cancela** en un índice normalizado. Un **offset aditivo
no**. Esa asimetría es exactamente por qué el bug es invisible leyendo el código:
cualquiera piensa "es un ratio normalizado, la calibración se cancela", y eso solo
vale para la escala.

`test_el_offset_no_es_un_factor_de_escala_y_por_eso_no_se_cancela` fija esa
distinción, porque es el razonamiento equivocado que reintroduce el bug.

### Antes / después (medido, escenas reales, baseline 05.12)

**Cordillera Central** — el caso donde el reporte pasa a decir otra cosa:

| Clase de densidad NDVI | Legacy (sin offset) | Corregido | Δ |
|---|---:|---:|---:|
| Sin vegetación / suelo desnudo o agua | 0.30 % | 0.00 % | −0.30 |
| Vegetación dispersa / matorral bajo | **99.70 %** | 0.13 % | −99.57 |
| Vegetación densa / bosque secundario | 0.00 % | 12.08 % | +12.08 |
| Vegetación muy densa / dosel maduro | 0.00 % | **87.80 %** | +87.80 |

NDVI medio 0.324 → 0.657. La app reportaba una ladera de bosque nublado a 2 900 m
como *matorral bajo*.

**Santo Domingo (urbano)** — el error es chico pero sigue estando: NDVI medio
0.067 → 0.100, y la clase "muy densa" pasa de 0.00 % a 0.47 %.

Con los DN medianos que el critique midió (red 1434 / nir 4955): NDVI **0.5511 →
0.8022**, que cruza el corte de 0.6 y cambia de clase.

### El arreglo

`sources/stac.py`: `boa_dn_offset()` resuelve el offset **por ítem**, con esta
precedencia (no es un `-1000` hardcodeado):

1. `raster:bands[].offset` / `.scale` del asset (extensión STAC raster). Viene en
   unidades de reflectancia; se convierte a DN dividiendo por la escala.
2. `earthsearch:boa_offset_applied == True` → el proveedor ya lo aplicó → `0`.
   Aplicarlo dos veces sería tan incorrecto como no aplicarlo nunca.
3. `s2:processing_baseline >= 04.00` → `-1000` (la regla oficial de ESA).
4. Sin metadatos → `0`, **con un warning**. El silencio es cómo el bug original
   sobrevivió en producción.

`boa_offsets_by_day()` agrupa por día solar, que es como `odc.stac.load` agrupa por
default, y `offset_dataarray()` alinea el vector de offsets al eje `time` del cubo:
escenas de baselines distintas en la misma corrida llevan offsets distintos.

Planetary Computer hoy devuelve `raster:bands: null`, así que en la práctica manda
el paso 3 — pero leerlo del ítem es lo que mantiene el código correcto si mañana PC
empieza a publicar el offset o a aplicarlo él mismo.

### Verificación

- `tests/test_h1_boa_offset.py` — 16 tests offline: precedencia, agrupación por día
  solar, conflicto de baselines en un mismo día, alineación temporal, y el salto de
  clase con los DN reales. **Todos fallan contra el código viejo**, que no tiene
  ninguna de estas funciones.
- `tests/test_network_pipeline.py::test_procedencia` exige
  `sentinel2_boa_offsets_applied == [-1000.0]` en las 5 corridas reales.
- La respuesta de la API publica `provenance.sentinel2_boa_offsets_applied`, así que
  el offset aplicado es auditable desde el reporte, no un detalle enterrado.

---

## H2 — Época de ESA WorldCover (ALTA)

### El bug

`stac.py:118` del legacy hacía `worldcover.max(dim="time")`. Planetary Computer
devuelve **dos ítems** para un bbox de RD (confirmado en las 3 corridas medidas):

```
ESA_WorldCover_10m_2021_v200_N18W072   2021
ESA_WorldCover_10m_2020_v100_N18W072   2020
```

`max` sobre **códigos de clase** no significa nada aritméticamente. Peor: "Bosque"
= 10 es el código **más bajo**, así que el máximo pierde toda discrepancia donde
2021 dice bosque y 2020 decía otra cosa. Y el mapa resultante no corresponde a
ningún año publicado: es un año que nunca existió, reportado como una cifra sola.

### Antes / después (medido)

| AOI | Legacy `max(dim="time")` | Corregido (época 2021) | Δ |
|---|---:|---:|---:|
| `borde-tile-dem` | 72.78 % | **87.01 %** | +14.24 pp |
| `santo-domingo-urbano` | 0.643 % | 0.686 % | +0.04 pp |
| `cordillera-central` | 90.33 % | 90.55 % | +0.21 pp |

El error escala con cuánto discrepan las épocas: casi nulo en un AOI urbano
consolidado, **14 puntos porcentuales** en una zona de vegetación en cambio. O sea:
es más grande justo donde la cobertura arbórea es la métrica que importa.

### El arreglo

`select_worldcover_epoch()` elige explícitamente la época **más reciente** y devuelve
`(ítems, año)`. Conserva *todas* las tiles de esa época (un AOI grande necesita
mosaico espacial, filtrar por año no puede tirar tiles). El año viaja hasta la
respuesta como `provenance.worldcover_epoch_year`, así que el reporte puede citar
"ESA WorldCover 2021" sin mentir.

Detalle que solo aparece contra datos reales: los ítems de WorldCover de PC llegan
con `item.datetime is None` — declaran `start_datetime`/`end_datetime`. Leer solo
`.datetime` revienta en producción. `worldcover_year()` cae en cascada a
`start_datetime` y, en último caso, al año dentro del id.

### Verificación

- `tests/test_h2_worldcover_epoch.py` — 8 tests offline con un cubo sintético donde
  ninguna época domina a la otra: `max` produce un mapa que **no es igual a ninguna
  de las dos** y reporta 25 % de cobertura arbórea donde la época real dice 62.5 %.
- El test de red exige `worldcover_epoch_year == 2021` en las 5 corridas.

---

## H3 — Máscara compartida entre elevación y pendiente (MEDIA)

### El bug

`.rio.clip()` rellena con NaN fuera del AOI. `np.gradient` propaga ese NaN un píxel
hacia adentro. El legacy resumía elevación sobre `~isnan(elev)` y pendiente sobre
`~isnan(slope)`: **dos denominadores, dos huellas, un solo reporte**. Los dos bloques
describían áreas distintas y nada lo decía.

### Antes / después (medido)

| AOI | px elevación | px pendiente | Δ | Elevación legacy | Elevación con máscara compartida |
|---|---:|---:|---:|---|---|
| `multipolygon-con-hueco` | 760 | 588 | **−22.6 %** | 42.4 – 57.7 m | 42.4 – 56.9 m |
| `santo-domingo-urbano` | 270 | 270 | 0 % | 44.5 – 68.3 m | 44.5 – 68.3 m |
| `cordillera-central` | 270 | 270 | 0 % | igual | igual |
| `cruce-72w` | 154 | 154 | 0 % | igual | igual |
| `borde-tile-dem` | 154 | 154 | 0 % | igual | igual |

**Hallazgo que vale la pena decir en voz alta:** los cuatro AOI rectangulares no
muestran diferencia. Un rectángulo alineado a los ejes llena todo el array
recortado, así que no queda relleno NaN que propagar y `np.gradient` usa diferencias
de un solo lado en el borde del array. El desfase aparece **solo cuando el AOI no es
un rectángulo que llena su bbox** — o sea, en todo polígono dibujado o subido por un
usuario real. El caso MultiPolygon lo expone al 22.6 %.

La magnitud crece con el cociente perímetro/área: peor en AOIs chicos o alargados,
que son justamente el caso de uso (parcelas).

### El arreglo

- `shared_valid_mask(dem, slope)` = intersección de los píxeles finitos de ambos.
  `summarize_topography()` la usa para **los dos** bloques. Reporta el AOI erosionado
  un píxel, pero elevación y pendiente hablan exactamente del mismo territorio, que
  es la única elección honesta.
- `sanitize_dem()` cubre la **variante latente CRÍTICA**: hoy `cop-dem-glo-30` llega
  con `nodata=None` y el relleno es NaN, así que `isnan()` filtra bien. Si el
  producto declarara `nodata=0` — como hacen muchos DEM —, `.rio.clip` rellenaría con
  0, `isnan()` no filtraría nada y el borde del AOI sería un acantilado al nivel del
  mar. Medido sobre un DEM sintético a 1500 m: **pendiente máxima 1885 % contra 0 %**.
  `sanitize_dem` normaliza cualquier nodata declarado a NaN antes de derivar nada.
- Errores explícitos en vez de divisiones por cero: AOI menor a 2×2 píxeles, y AOI
  que se queda sin píxeles al descartar el anillo de borde.

### Verificación

`tests/test_h3_slope_mask.py` — 11 tests. El central construye un DEM con un anillo
de 900 m alrededor de un interior plano de 100 m: 64 píxeles válidos de elevación
contra 36 de pendiente. El legacy reportaba `elevation_max_m = 900` (el anillo, que
la pendiente nunca vio); con la máscara compartida da 100.

---

## Correcciones menores incluidas

### H5 — las clases de densidad NDVI no sumaban 100 %

`NDVI_DENSITY_CLASSES` cubre `[-1.0, 1.0)` con `>= lo & < hi`. Un píxel con NDVI
exactamente 1.0 —o fuera de [-1, 1], posible con reflectancias negativas después de
aplicar el offset— desaparecía del histograma pero seguía contando en el
denominador. El reporte mostraba cuatro porcentajes que calladamente no sumaban.

Arreglo en dos partes: `clean_ndvi()` descarta lo físicamente imposible (fuera de
[-1, 1], que solo aparece con el denominador cerca de cero), y la última clase
incluye su borde superior. Los tests de red exigen suma 100 ± 0.01.

### H16 — zona UTM elegida con el centroide

`aoi.py:53` del legacy usaba `geometry.centroid`, que para un MultiPolygon o un
polígono en C puede caer **fuera de todas las partes**. Cerca de 72°O —el límite
entre UTM 18N y 19N, que cruza República Dominicana— eso elige la zona equivocada y
desplaza todas las áreas y distancias.

Se pasó a `representative_point()`, que por definición está sobre la geometría, y se
loguea un warning cuando el AOI cruza un límite de zona. El fixture
`multipolygon-con-hueco` está construido para que su **centroide caiga dentro del
hueco**, y el test lo verifica: si alguien vuelve al centroide, el test cae.

### Export GeoTIFF: compresión y nodata

El export legacy (`app.py:353`) era `raster.rio.to_raster(buf, driver="GTiff")` a
secas — **sin compresión y sin tag nodata**. El critique lo confirmó leyendo el
archivo: `compress: None, nodata: None`. Consecuencia práctica: los TIFF recortados
se abren en QGIS con la región NaN de fuera del AOI renderizada como dato.

`render/raster_io.py` escribe con `compress="deflate"`, `predictor` según dtype,
tiled 256×256 y **tag nodata explícito** por capa (NaN para float, 0 para
WorldCover, 255 para las clases de NDVI). Se agrega además la descarga de `aspect`
(`orientacion.tif`), que el inventario marcaba como huérfano: se calculaba y no
había forma de bajarlo.

### SCL clase 7 (H4) — documentada, no cambiada

El comentario legacy decía *"nubes baja prob."* para la clase 7 del SCL. En la
semántica actual de Sen2Cor 7 es **UNCLASSIFIED**. Se corrigió **el comentario**, no
la máscara: sacar la clase 7 cambia el compuesto y es una decisión de producto, no
una corrección. Queda documentado para que se decida a propósito.

---

## Lo que estas correcciones significan para el resto de la migración

1. **"Paridad numérica con el Python de hoy" no es un criterio de aceptación.** Era
   el mecanismo por el cual un error de 87.8 puntos porcentuales se lavaba dentro del
   rewrite. Se reemplaza por `services/api/tests/` — 5 AOI fijos, salidas esperadas y
   **tolerancias documentadas** (ver `services/api/tests/README.md`).
2. **Los números de la app cambian con esta corrección.** Cualquier reporte emitido
   antes del 2026-08-27 tiene clases de densidad NDVI mal y cobertura arbórea de una
   mezcla de épocas. Si hay reportes en manos de un cliente, esto es una nota de
   migración, no un detalle interno.
3. **El offset y la época viajan en la respuesta** (`provenance`), no solo en el
   código. Un reporte de debida diligencia tiene que poder mostrar con qué se calculó.
