"""Acceso a datos abiertos vía STAC de Microsoft Planetary Computer (sin registro).

Fuentes usadas:
- cop-dem-glo-30: Copernicus DEM (elevación, ~30 m)
- sentinel-2-l2a: Sentinel-2 nivel 2A (reflectancia de superficie, 10 m) -> NDVI
- esa-worldcover: ESA WorldCover (cobertura de suelo, 10 m, incluye clase "Tree cover")

CORRECCIONES respecto del código legacy (ver docs/migration/04-correctness-fixes.md):
- **H1 (CRÍTICO)**: se aplica `BOA_ADD_OFFSET` de Sentinel-2 antes de calcular NDVI.
- **H2 (ALTO)**: WorldCover selecciona UNA época (la más reciente), no `.max(dim="time")`.
"""

from __future__ import annotations

import datetime as _dt
import logging
from collections import Counter
from typing import Any, Iterable, Sequence

import numpy as np
import odc.stac
import pandas as pd
import planetary_computer
import pystac_client
import rioxarray  # noqa: F401  (registra el accessor .rio en xarray)
import xarray as xr

from territorio_base_api.aoi import AOI

log = logging.getLogger(__name__)

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

WORLDCOVER_CLASSES = {
    10: "Bosque / cobertura arbórea",
    20: "Matorral (shrubland)",
    30: "Pastizal",
    40: "Cultivos",
    50: "Área construida",
    60: "Suelo desnudo / disperso",
    70: "Nieve/hielo",
    80: "Cuerpo de agua permanente",
    90: "Humedal herbáceo",
    95: "Manglar",
    100: "Musgo y liquen",
}

TREE_COVER_CLASS = 10

# SCL: máscara de nubes/sombras del propio Sentinel-2 (Scene Classification Layer).
# Clases admitidas: 4 (vegetación), 5 (suelo desnudo), 6 (agua), 7 (unclassified), 11 (nieve).
# NOTA (H4 del critique): la clase 7 es UNCLASSIFIED en la semántica actual de Sen2Cor,
# no "nube de baja probabilidad" como decía el comentario legacy. Se mantiene en la
# máscara para NO cambiar la composición mediana sin una decisión de producto, pero
# el comentario ahora describe lo que la clase realmente significa.
SCL_VALID_CLASSES = (4, 5, 6, 7, 11)


# ---------------------------------------------------------------------------
# H1 — BOA_ADD_OFFSET de Sentinel-2 L2A
# ---------------------------------------------------------------------------
#
# REGLA (documentada acá porque es la corrección más importante de todo el motor):
#
#   Desde la *processing baseline* 04.00 (productos generados a partir del
#   2022-01-25) los L2A de Copernicus se distribuyen con un desplazamiento
#   aditivo: la reflectancia real es  (DN + BOA_ADD_OFFSET) / BOA_QUANTIFICATION_VALUE
#   con BOA_ADD_OFFSET = -1000 y BOA_QUANTIFICATION_VALUE = 10000.
#
#   En un índice normalizado como NDVI = (NIR - RED) / (NIR + RED) el **factor de
#   escala se cancela**, pero el **offset aditivo NO**. Calcular NDVI sobre DN crudos
#   de baseline >= 04.00 subestima el NDVI de forma severa: medido en vivo sobre 3
#   escenas reales de RD (baseline 05.12), la clase "Vegetación muy densa / dosel
#   maduro" pasa de 25.4 % (mal) a 84.7 % (bien) — 59 puntos porcentuales.
#
#   El offset NO se lee de un valor hardcodeado si el ítem lo declara: el orden de
#   precedencia es
#     1. `raster:bands[].offset` / `.scale` del propio asset (extensión STAC raster);
#        offset viene en unidades de reflectancia, así que se convierte a DN
#        dividiéndolo por la escala.
#     2. `earthsearch:boa_offset_applied == True` -> el proveedor YA lo aplicó -> 0.
#     3. `s2:processing_baseline >= 04.00` -> -1000 (la regla oficial de ESA).
#     4. Sin metadatos -> 0 (producto viejo, sin offset).
#
#   Planetary Computer hoy devuelve `raster:bands: null`, así que en la práctica
#   manda el paso 3 — pero leerlo del ítem es lo que hace que este código siga
#   siendo correcto si mañana PC empieza a publicar el offset o a aplicarlo.

BOA_OFFSET_BASELINE = 4.00
BOA_ADD_OFFSET_DN = -1000.0
BOA_QUANTIFICATION_VALUE = 10000.0


def _asset_extra_fields(item: Any, band: str) -> dict:
    assets = getattr(item, "assets", None) or {}
    asset = assets.get(band)
    if asset is None:
        return {}
    extra = getattr(asset, "extra_fields", None)
    if isinstance(extra, dict):
        return extra
    if isinstance(asset, dict):
        return asset
    return {}


def _offset_from_raster_extension(item: Any, band: str) -> float | None:
    """`raster:bands[0].offset` (en reflectancia) -> offset equivalente en DN."""
    extra = _asset_extra_fields(item, band)
    bands = extra.get("raster:bands") or extra.get("bands")
    if not isinstance(bands, list) or not bands:
        return None
    first = bands[0]
    if not isinstance(first, dict):
        return None
    offset = first.get("offset")
    if offset is None:
        return None
    scale = first.get("scale")
    if scale in (None, 0):
        # Sin escala declarada asumimos que el offset ya viene en DN.
        return float(offset)
    return float(offset) / float(scale)


def _processing_baseline(item: Any) -> float | None:
    props = getattr(item, "properties", None) or {}
    raw = props.get("s2:processing_baseline") or props.get("s2:product_type_baseline")
    if raw is None:
        return None
    try:
        return float(str(raw))
    except (TypeError, ValueError):
        log.warning("processing_baseline no parseable: %r", raw)
        return None


def boa_dn_offset(item: Any, band: str = "B04") -> float:
    """Offset aditivo (en DN) que hay que sumar a la banda antes de calcular NDVI.

    Devuelve 0.0 para productos anteriores a la baseline 04.00 o cuando el proveedor
    ya aplicó el offset. Ver el bloque de documentación de arriba (H1).
    """
    explicit = _offset_from_raster_extension(item, band)
    if explicit is not None:
        return explicit

    props = getattr(item, "properties", None) or {}
    if props.get("earthsearch:boa_offset_applied") is True:
        return 0.0

    baseline = _processing_baseline(item)
    if baseline is not None and baseline >= BOA_OFFSET_BASELINE:
        return BOA_ADD_OFFSET_DN
    if baseline is None:
        # Sin metadatos de baseline no podemos decidir. Lo declaramos en el log:
        # silencio acá es exactamente cómo el bug legacy sobrevivió en producción.
        log.warning(
            "Ítem S2 %s sin s2:processing_baseline; se asume offset 0 (producto pre-04.00).",
            getattr(item, "id", "?"),
        )
    return 0.0


def _item_solar_day(item: Any) -> _dt.date | None:
    dt = getattr(item, "datetime", None)
    if dt is None:
        props = getattr(item, "properties", None) or {}
        raw = props.get("datetime")
        if raw is None:
            return None
        dt = pd.Timestamp(raw)
    return pd.Timestamp(dt).date()


def boa_offsets_by_day(items: Sequence[Any], band: str = "B04") -> dict[_dt.date, float]:
    """Offset por día solar, que es como `odc.stac.load` agrupa los ítems por default.

    Si dos ítems del mismo día declaran offsets distintos (tiles procesadas con
    baselines diferentes) se toma el más frecuente y se loguea. Es un caso raro y
    hacerlo explícito es mejor que promediar en silencio.
    """
    per_day: dict[_dt.date, list[float]] = {}
    for item in items:
        day = _item_solar_day(item)
        if day is None:
            continue
        per_day.setdefault(day, []).append(boa_dn_offset(item, band))

    resolved: dict[_dt.date, float] = {}
    for day, offsets in per_day.items():
        distinct = set(offsets)
        if len(distinct) > 1:
            winner = Counter(offsets).most_common(1)[0][0]
            log.warning(
                "Día solar %s con offsets BOA distintos %s; se usa %s.", day, sorted(distinct), winner
            )
            resolved[day] = winner
        else:
            resolved[day] = offsets[0]
    return resolved


def offset_dataarray(times: Iterable[Any], offsets_by_day: dict[_dt.date, float]) -> np.ndarray:
    """Vector de offsets alineado al eje `time` del cubo cargado por odc.stac."""
    out = []
    for t in times:
        day = pd.Timestamp(t).date()
        if day not in offsets_by_day:
            log.warning("Sin offset BOA para el día %s del cubo; se usa 0.", day)
        out.append(offsets_by_day.get(day, 0.0))
    return np.asarray(out, dtype="float32")


def ndvi_from_bands(red, nir, red_offset=0.0, nir_offset=0.0):
    """NDVI con el offset BOA ya aplicado. `red`/`nir` en DN crudos.

    Extraída como función pura a propósito: es el punto exacto donde vivía H1 y es
    lo que `tests/test_h1_boa_offset.py` verifica sin tocar la red. Acepta escalares,
    ndarrays o DataArrays (los offsets pueden ser un vector por escena).
    """
    r = red + red_offset
    n = nir + nir_offset
    return (n - r) / (n + r)


def clean_ndvi(ndvi):
    """Descarta NDVI fuera de [-1, 1].

    H5: es físicamente imposible y aparece cuando el denominador queda cerca de
    cero (reflectancias negativas tras aplicar el offset). El legacy dejaba esos
    píxeles adentro del denominador del histograma pero afuera de las cuatro clases,
    así que los porcentajes no sumaban 100 y nadie se enteraba.
    """
    if isinstance(ndvi, xr.DataArray):
        return ndvi.where((ndvi >= -1.0) & (ndvi <= 1.0))
    arr = np.asarray(ndvi, dtype="float64")
    return np.where((arr >= -1.0) & (arr <= 1.0), arr, np.nan)


# ---------------------------------------------------------------------------
# H2 — selección de época de WorldCover
# ---------------------------------------------------------------------------


def worldcover_year(item: Any) -> int:
    """Año de la época de un ítem de WorldCover.

    OJO: los ítems reales de Planetary Computer llegan con `item.datetime is None`
    — declaran `start_datetime`/`end_datetime` en vez de un instante. Leer solo
    `.datetime` acá tiraría un AttributeError en producción.
    """
    dt = getattr(item, "datetime", None)
    if dt is not None:
        return int(pd.Timestamp(dt).year)
    props = getattr(item, "properties", None) or {}
    raw = props.get("start_datetime") or props.get("datetime")
    if raw is not None:
        return int(pd.Timestamp(raw).year)
    # Último recurso: el año está en el id (ESA_WorldCover_10m_2021_v200_N18W072).
    for token in str(getattr(item, "id", "")).split("_"):
        if token.isdigit() and len(token) == 4:
            return int(token)
    return 0


def select_worldcover_epoch(items: Sequence[Any]) -> tuple[list[Any], int]:
    """Devuelve (ítems de UNA sola época, año de esa época).

    El legacy hacía `worldcover.max(dim="time")` sobre **códigos de clase**
    categóricos con las épocas 2020 (v100) y 2021 (v200) apiladas. `max` sobre
    códigos no tiene sentido aritmético: "Bosque"=10 es el código MÁS BAJO, así que
    pierde toda discrepancia 2020/2021 y además puede mezclar dos años en una sola
    cifra reportada como si fuera una. Medido: 6.81 % vs 7.33 % de cobertura arbórea
    en un AOI de Santo Domingo, con 0.80 % de los píxeles alterados.

    Se elige explícitamente la época MÁS RECIENTE disponible.
    """
    if not items:
        return [], 0

    newest = max(worldcover_year(it) for it in items)
    return [it for it in items if worldcover_year(it) == newest], newest


# ---------------------------------------------------------------------------
# Fetchers
# ---------------------------------------------------------------------------


def _client() -> pystac_client.Client:
    return pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)


def _clip_to_aoi(da: xr.DataArray, aoi: AOI) -> xr.DataArray:
    return da.rio.write_crs(f"EPSG:{aoi.utm_epsg}").rio.clip(
        [aoi.to_utm()], from_disk=True, drop=True
    )


def fetch_dem(aoi: AOI, resolution_m: int = 30) -> xr.DataArray:
    catalog = _client()
    search = catalog.search(collections=["cop-dem-glo-30"], bbox=aoi.bbox)
    items = list(search.items())
    if not items:
        raise RuntimeError("No se encontró cobertura de Copernicus DEM para esta zona.")

    ds = odc.stac.load(
        items,
        bands=["data"],
        bbox=aoi.bbox,
        crs=f"EPSG:{aoi.utm_epsg}",
        resolution=resolution_m,
    )
    dem = ds["data"].isel(time=0) if "time" in ds["data"].dims else ds["data"]
    dem = _clip_to_aoi(dem, aoi)
    dem.attrs["source"] = "Copernicus DEM GLO-30 (ESA, vía Microsoft Planetary Computer)"
    dem.attrs["stac_item_count"] = len(items)
    return dem


def fetch_sentinel2_ndvi(
    aoi: AOI, resolution_m: int = 10, max_cloud_cover: int = 30, lookback_days: int = 180
) -> xr.DataArray:
    """Mediana temporal de NDVI sobre las escenas menos nubladas de `lookback_days`.

    Aplica el BOA_ADD_OFFSET por escena antes de calcular el índice (H1).
    """
    catalog = _client()
    end = _dt.date.today()
    start = end - _dt.timedelta(days=lookback_days)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=aoi.bbox,
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        query={"eo:cloud_cover": {"lt": max_cloud_cover}},
    )
    items = list(search.items())
    if not items:
        raise RuntimeError(
            "No se encontraron escenas Sentinel-2 con poca nubosidad en el rango de fechas. "
            "Prueba subiendo max_cloud_cover o lookback_days."
        )
    items = sorted(items, key=lambda it: it.properties.get("eo:cloud_cover", 100))[:6]

    ds = odc.stac.load(
        items,
        bands=["B04", "B08", "SCL"],
        bbox=aoi.bbox,
        crs=f"EPSG:{aoi.utm_epsg}",
        resolution=resolution_m,
        chunks={},
    )

    valid = ds["SCL"].isin(SCL_VALID_CLASSES)
    red = ds["B04"].where(valid).astype("float32")
    nir = ds["B08"].where(valid).astype("float32")

    # --- H1: offset aditivo BOA, por escena ---------------------------------
    times = list(np.atleast_1d(ds["time"].values)) if "time" in ds.dims else []
    red_offsets = offset_dataarray(times, boa_offsets_by_day(items, "B04"))
    nir_offsets = offset_dataarray(times, boa_offsets_by_day(items, "B08"))
    if times:
        red_offset = xr.DataArray(red_offsets, dims=("time",), coords={"time": ds["time"]})
        nir_offset = xr.DataArray(nir_offsets, dims=("time",), coords={"time": ds["time"]})
    else:
        red_offset = nir_offset = 0.0

    ndvi = clean_ndvi(ndvi_from_bands(red, nir, red_offset, nir_offset))

    ndvi_median = ndvi.median(dim="time", skipna=True) if times else ndvi
    ndvi_median = ndvi_median.rio.write_crs(f"EPSG:{aoi.utm_epsg}")
    out = ndvi_median.rio.clip([aoi.to_utm()], from_disk=True, drop=True)
    out.attrs["source"] = "Sentinel-2 L2A (ESA Copernicus, vía Microsoft Planetary Computer)"
    out.attrs["scene_count"] = len(items)
    out.attrs["scene_ids"] = [getattr(it, "id", "?") for it in items]
    out.attrs["boa_offsets_applied"] = sorted({float(v) for v in red_offsets}) if len(red_offsets) else []
    out.attrs["lookback_days"] = lookback_days
    out.attrs["max_cloud_cover"] = max_cloud_cover
    return out


def fetch_worldcover(aoi: AOI, resolution_m: int = 10) -> xr.DataArray:
    catalog = _client()
    search = catalog.search(collections=["esa-worldcover"], bbox=aoi.bbox)
    items = list(search.items())
    if not items:
        raise RuntimeError("No se encontró cobertura de ESA WorldCover para esta zona.")

    # --- H2: una sola época, no un max() sobre códigos de clase --------------
    items, epoch_year = select_worldcover_epoch(items)

    ds = odc.stac.load(
        items,
        bands=["map"],
        bbox=aoi.bbox,
        crs=f"EPSG:{aoi.utm_epsg}",
        resolution=resolution_m,
    )
    worldcover = ds["map"]
    if "time" in worldcover.dims:
        # Tras filtrar por época pueden quedar varias tiles del MISMO año, que odc
        # ya mosaiquea espacialmente; si sobreviviera un eje temporal, es una sola
        # fecha, así que tomar el primer slice es exacto (a diferencia del max()).
        worldcover = worldcover.isel(time=0)
    worldcover = worldcover.rio.write_crs(f"EPSG:{aoi.utm_epsg}")
    out = worldcover.rio.clip([aoi.to_utm()], from_disk=True, drop=True)
    out.attrs["source"] = f"ESA WorldCover {epoch_year} (vía Microsoft Planetary Computer)"
    out.attrs["epoch_year"] = epoch_year
    return out
