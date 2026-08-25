"""Pendiente, orientación y estadísticas de elevación a partir de un DEM ya clipeado al AOI."""

from __future__ import annotations

import numpy as np
import xarray as xr

SLOPE_CLASSES = [
    (0, 5, "Plano (0-5%)"),
    (5, 15, "Suave (5-15%)"),
    (15, 30, "Moderado (15-30%)"),
    (30, float("inf"), "Fuerte (>30%)"),
]


def compute_slope_aspect(dem: xr.DataArray) -> tuple[xr.DataArray, xr.DataArray]:
    """Asume que el DEM está en una CRS proyectada (metros), como se pide en sources/stac.py."""
    elevation = dem.values.astype("float64")
    res_x = abs(float(dem.x[1] - dem.x[0]))
    res_y = abs(float(dem.y[1] - dem.y[0]))

    dz_dy, dz_dx = np.gradient(elevation, res_y, res_x)
    slope_pct = np.sqrt(dz_dx**2 + dz_dy**2) * 100
    aspect_deg = (np.degrees(np.arctan2(-dz_dx, dz_dy))) % 360

    slope = xr.DataArray(slope_pct, dims=dem.dims, coords=dem.coords)
    aspect = xr.DataArray(aspect_deg, dims=dem.dims, coords=dem.coords)
    return slope, aspect


def summarize_topography(dem: xr.DataArray, slope: xr.DataArray) -> dict:
    elev = dem.values
    slp = slope.values
    valid_elev = elev[~np.isnan(elev)]
    valid_slope = slp[~np.isnan(slp)]

    if valid_elev.size == 0:
        raise RuntimeError("El DEM no tiene datos válidos dentro del AOI.")

    total = valid_slope.size
    class_pct = {}
    for lo, hi, label in SLOPE_CLASSES:
        mask = (valid_slope >= lo) & (valid_slope < hi)
        class_pct[label] = float(mask.sum() / total * 100) if total else 0.0

    return {
        "elevation_min_m": float(np.min(valid_elev)),
        "elevation_max_m": float(np.max(valid_elev)),
        "elevation_mean_m": float(np.mean(valid_elev)),
        "elevation_range_m": float(np.max(valid_elev) - np.min(valid_elev)),
        "slope_mean_pct": float(np.mean(valid_slope)),
        "slope_max_pct": float(np.max(valid_slope)),
        "slope_class_pct": class_pct,
    }
