"""Estadísticas de cobertura y densidad arbórea a partir de NDVI (Sentinel-2) y ESA WorldCover."""

from __future__ import annotations

import numpy as np
import xarray as xr

from territorio_base.sources.stac import TREE_COVER_CLASS, WORLDCOVER_CLASSES

NDVI_DENSITY_CLASSES = [
    (-1.0, 0.2, "Sin vegetación / suelo desnudo o agua"),
    (0.2, 0.4, "Vegetación dispersa / matorral bajo"),
    (0.4, 0.6, "Vegetación densa / bosque secundario"),
    (0.6, 1.0, "Vegetación muy densa / dosel maduro"),
]


def summarize_vegetation(ndvi: xr.DataArray, worldcover: xr.DataArray) -> dict:
    ndvi_vals = ndvi.values
    valid_ndvi = ndvi_vals[~np.isnan(ndvi_vals)]

    if valid_ndvi.size == 0:
        raise RuntimeError("No hay píxeles NDVI válidos dentro del AOI (revisa nubosidad/fechas).")

    total_ndvi = valid_ndvi.size
    density_pct = {}
    for lo, hi, label in NDVI_DENSITY_CLASSES:
        mask = (valid_ndvi >= lo) & (valid_ndvi < hi)
        density_pct[label] = float(mask.sum() / total_ndvi * 100)

    wc_vals = worldcover.values
    valid_wc = wc_vals[~np.isnan(wc_vals)] if np.issubdtype(wc_vals.dtype, np.floating) else wc_vals.ravel()
    valid_wc = valid_wc[valid_wc > 0]
    total_wc = valid_wc.size

    landcover_pct = {}
    for code, label in WORLDCOVER_CLASSES.items():
        pct = float((valid_wc == code).sum() / total_wc * 100) if total_wc else 0.0
        if pct > 0:
            landcover_pct[label] = pct

    tree_cover_pct = float((valid_wc == TREE_COVER_CLASS).sum() / total_wc * 100) if total_wc else 0.0

    return {
        "ndvi_mean": float(np.mean(valid_ndvi)),
        "ndvi_median": float(np.median(valid_ndvi)),
        "ndvi_p90": float(np.percentile(valid_ndvi, 90)),
        "ndvi_density_class_pct": density_pct,
        "worldcover_tree_cover_pct": tree_cover_pct,
        "worldcover_landcover_pct": landcover_pct,
    }
