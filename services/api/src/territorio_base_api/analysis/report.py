"""Orquesta el pipeline RASTER para un AOI.

Alcance: este servicio es solo raster (DEM/pendiente, NDVI/Sentinel-2, WorldCover,
Aqueduct). Hidrología (Overpass), áreas protegidas (WDPA) y el catálogo MEPyD
salieron de Python y viven en `packages/geo` (TypeScript) — ver
`services/api/legacy-vector-reference/README.md`.

El armado del reporte (Markdown / story-map) también es de TypeScript: acá se
devuelven números y rásters, no prosa.

**Aislamiento de fallas por fuente (regresión #3 del inventario):** cada fuente
corre en su propio try/except y publica un booleano `available`. Que Sentinel-2 no
tenga escenas sin nubes no puede borrar la topografía ya descargada, ni al revés.
`available: False` significa "no se pudo consultar", que es semánticamente distinto
de "consulté y no hay nada".
"""

from __future__ import annotations

import logging
from typing import Callable

import xarray as xr

from territorio_base_api.analysis.topography import (
    classify_slope_classes,
    compute_slope_aspect,
    sanitize_dem,
    summarize_topography,
)
from territorio_base_api.analysis.vegetation import (
    classify_ndvi_density,
    summarize_ndvi,
    summarize_worldcover,
)
from territorio_base_api.aoi import AOI
from territorio_base_api.sources import stac

log = logging.getLogger(__name__)

Progress = Callable[[str], None]

# Los strings EXACTOS que mostraba la app legacy, en el mismo orden.
STEP_DEM = "Descargando DEM (Copernicus GLO-30)…"
STEP_NDVI = "Descargando Sentinel-2 y calculando NDVI…"
STEP_WORLDCOVER = "Descargando ESA WorldCover…"
STEP_DONE = "Análisis completo"

STEPS = (STEP_DEM, STEP_NDVI, STEP_WORLDCOVER)

# Claves del resumen de vegetación, en el orden del contrato legacy.
_NDVI_KEYS = ("ndvi_mean", "ndvi_median", "ndvi_p90", "ndvi_density_class_pct")
_WORLDCOVER_KEYS = ("worldcover_tree_cover_pct", "worldcover_landcover_pct")


def _noop(_msg: str) -> None:
    return None


def _reason(exc: BaseException) -> str:
    text = str(exc).strip()
    return text or exc.__class__.__name__


def run_analysis(
    aoi: AOI,
    progress: Progress = _noop,
    *,
    ndvi_resolution_m: int = 10,
    lookback_days: int = 180,
    max_cloud_cover: int = 30,
) -> dict:
    """Corre el pipeline raster completo. Nunca lanza por una fuente caída."""
    rasters: dict[str, xr.DataArray] = {}

    progress(STEP_DEM)
    topography: dict = {"available": False, "error": None, "summary": None}
    try:
        dem = sanitize_dem(stac.fetch_dem(aoi))
        slope, aspect = compute_slope_aspect(dem)
        topography["summary"] = summarize_topography(dem, slope)
        topography["available"] = True
        rasters["dem"] = dem
        rasters["slope"] = slope
        rasters["aspect"] = aspect
        rasters["slope_classes"] = classify_slope_classes(slope)
    except Exception as exc:  # noqa: BLE001 — aislamiento por fuente, a propósito
        log.warning("Topografía no disponible: %s", exc, exc_info=True)
        topography["error"] = _reason(exc)

    # NDVI y WorldCover son fuentes independientes.
    progress(STEP_NDVI)
    ndvi_summary: dict | None = None
    ndvi_error: str | None = None
    sentinel2_temporal: dict = {}
    try:
        ndvi = stac.fetch_sentinel2_ndvi(
            aoi,
            resolution_m=ndvi_resolution_m,
            max_cloud_cover=max_cloud_cover,
            lookback_days=lookback_days,
        )
        sentinel2_temporal = dict(ndvi.attrs)
        ndvi_summary = summarize_ndvi(ndvi)
        rasters["ndvi"] = ndvi
        rasters["ndvi_density"] = classify_ndvi_density(ndvi)
    except Exception as exc:  # noqa: BLE001
        log.warning("NDVI no disponible: %s", exc, exc_info=True)
        ndvi_error = _reason(exc)
        if isinstance(exc, stac.NoValidSentinel2Data):
            sentinel2_temporal = exc.temporal_metadata

    progress(STEP_WORLDCOVER)
    worldcover_summary: dict | None = None
    worldcover_error: str | None = None
    try:
        worldcover = stac.fetch_worldcover(aoi)
        worldcover_summary = summarize_worldcover(worldcover)
        rasters["worldcover"] = worldcover
    except Exception as exc:  # noqa: BLE001
        log.warning("WorldCover no disponible: %s", exc, exc_info=True)
        worldcover_error = _reason(exc)

    summary: dict | None = None
    if ndvi_summary or worldcover_summary:
        summary = {}
        for key in _NDVI_KEYS:
            summary[key] = ndvi_summary.get(key) if ndvi_summary else None
        for key in _WORLDCOVER_KEYS:
            summary[key] = worldcover_summary.get(key) if worldcover_summary else None

    vegetation = {
        "available": bool(ndvi_summary or worldcover_summary),
        "ndvi_available": ndvi_summary is not None,
        "worldcover_available": worldcover_summary is not None,
        "error": ndvi_error if ndvi_error and worldcover_error else None,
        "ndvi_error": ndvi_error,
        "worldcover_error": worldcover_error,
        "summary": summary,
    }

    progress(STEP_DONE)

    return {
        "aoi": {
            "area_ha": aoi.area_ha,
            "bbox": aoi.bbox,
            "utm_epsg": aoi.utm_epsg,
        },
        "topography": topography,
        "vegetation": vegetation,
        "rasters": rasters,
        "provenance": build_provenance(rasters, sentinel2_temporal=sentinel2_temporal),
    }


def build_provenance(
    rasters: dict[str, xr.DataArray], *, sentinel2_temporal: dict | None = None
) -> dict:
    """Metadatos de qué se usó realmente en esta corrida (para la tabla de fuentes)."""
    ndvi = rasters.get("ndvi")
    worldcover = rasters.get("worldcover")
    dem = rasters.get("dem")
    scene_ids = ndvi.attrs.get("scene_ids") if ndvi is not None else None
    offsets = ndvi.attrs.get("boa_offsets_applied") if ndvi is not None else None
    temporal = sentinel2_temporal or (dict(ndvi.attrs) if ndvi is not None else {})
    derived_products = []
    if ndvi is not None and scene_ids:
        derived_products.append(
            {
                "product": "NDVI",
                "formula": "(NIR + nir_offset - RED - red_offset) / "
                "(NIR + nir_offset + RED + red_offset)",
                "parameters": {
                    "composite": "median",
                    "red_offset_dn": list(offsets or []),
                    "nir_offset_dn": list(offsets or []),
                    "valid_scl_classes": list(stac.SCL_VALID_CLASSES),
                },
                "source": "Sentinel-2 L2A via Microsoft Planetary Computer",
                "scene_ids": list(scene_ids),
                "bands_used": ["B04 (red)", "B08 (nir)", "SCL (quality mask)"],
                "metadata_origin": "derived",
            }
        )
    return {
        "dem_source": (dem.attrs.get("source") if dem is not None else None),
        "dem_item_count": (dem.attrs.get("stac_item_count") if dem is not None else None),
        "sentinel2_scene_count": (ndvi.attrs.get("scene_count") if ndvi is not None else None),
        "sentinel2_scene_ids": (ndvi.attrs.get("scene_ids") if ndvi is not None else None),
        "sentinel2_acquisition_datetimes": (
            ndvi.attrs.get("scene_acquired_at") if ndvi is not None else None
        ),
        "sentinel2_latest_acquisition_datetime": (
            ndvi.attrs.get("latest_acquired_at") if ndvi is not None else None
        ),
        "sentinel2_oldest_acquisition_datetime": (
            ndvi.attrs.get("oldest_acquired_at") if ndvi is not None else None
        ),
        "sentinel2_observation_age_days": (
            temporal.get("observation_age_days")
        ),
        "sentinel2_temporal_status": temporal.get("temporal_status"),
        "sentinel2_temporal_message": temporal.get("temporal_message"),
        "sentinel2_last_checked_at": temporal.get("last_checked_at"),
        "sentinel2_latest_available_scene_id": temporal.get("latest_available_scene_id"),
        "sentinel2_latest_available_acquisition_datetime": temporal.get(
            "latest_available_acquired_at"
        ),
        "sentinel2_latest_available_cloud_cover_pct": temporal.get(
            "latest_available_cloud_cover_pct"
        ),
        "sentinel2_latest_valid_scene_id": temporal.get("latest_valid_scene_id"),
        "sentinel2_latest_valid_acquisition_datetime": temporal.get(
            "latest_valid_acquired_at"
        ),
        "sentinel2_latest_valid_cloud_cover_pct": temporal.get(
            "latest_valid_cloud_cover_pct"
        ),
        "sentinel2_last_used_scene_ids": temporal.get("last_used_scene_ids"),
        "sentinel2_last_used_acquisition_datetimes": temporal.get("last_used_acquired_at"),
        "sentinel2_primary_window_days": temporal.get("primary_window_days"),
        "sentinel2_fallback_window_days": temporal.get("fallback_window_days"),
        "sentinel2_selection_window_days": temporal.get("selection_window_days"),
        "sentinel2_fallback_used": temporal.get("fallback_used"),
        "sentinel2_boa_offsets_applied": (
            ndvi.attrs.get("boa_offsets_applied") if ndvi is not None else None
        ),
        "sentinel2_lookback_days": (
            ndvi.attrs.get("lookback_days")
            if ndvi is not None
            else temporal.get("fallback_window_days")
        ),
        "sentinel2_max_cloud_cover": temporal.get("max_cloud_cover"),
        "worldcover_epoch_year": (
            worldcover.attrs.get("epoch_year") if worldcover is not None else None
        ),
        "derived_products": derived_products,
    }
