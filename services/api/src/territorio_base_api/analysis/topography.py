"""Pendiente, orientación y estadísticas de elevación a partir de un DEM ya clipeado al AOI.

CORRECCIÓN respecto del código legacy (ver docs/migration/04-correctness-fixes.md):
- **H3 (MEDIO)**: elevación y pendiente ahora se resumen sobre EL MISMO conjunto de
  píxeles válidos.
"""

from __future__ import annotations

import numpy as np
import xarray as xr

SLOPE_CLASSES = [
    (0, 5, "Plano (0-5%)"),
    (5, 15, "Suave (5-15%)"),
    (15, 30, "Moderado (15-30%)"),
    (30, float("inf"), "Fuerte (>30%)"),
]


def sanitize_dem(dem: xr.DataArray) -> xr.DataArray:
    """Convierte el nodata declarado del DEM a NaN antes de derivar pendiente.

    Guarda contra la variante latente CRÍTICA de H3: `cop-dem-glo-30` hoy llega con
    `nodata=None` y `.rio.clip()` rellena fuera del AOI con NaN, así que `isnan()`
    filtra bien. Si el producto (u otro DEM) declarara `nodata=0` — como hacen
    muchos —, el relleno sería 0, `isnan()` no filtraría nada y el borde del AOI se
    volvería un acantilado al nivel del mar: pendiente máxima medida de 683 % contra
    ~4 % del terreno real. Normalizar acá cuesta cuatro líneas y elimina la clase
    entera de error.
    """
    nodata = dem.rio.nodata if hasattr(dem, "rio") else None
    if nodata is None or (isinstance(nodata, float) and np.isnan(nodata)):
        return dem.astype("float64") if not np.issubdtype(dem.dtype, np.floating) else dem
    out = dem.astype("float64").where(dem != nodata)
    out.rio.write_nodata(np.nan, inplace=True)
    return out


def compute_slope_aspect(dem: xr.DataArray) -> tuple[xr.DataArray, xr.DataArray]:
    """Asume que el DEM está en una CRS proyectada (metros), como se pide en sources/stac.py."""
    elevation = dem.values.astype("float64")
    if elevation.ndim != 2 or min(elevation.shape) < 2:
        raise RuntimeError(
            "El AOI es demasiado chico para derivar pendiente: el DEM recortado tiene "
            f"forma {elevation.shape} y np.gradient necesita al menos 2×2 píxeles."
        )
    res_x = abs(float(dem.x[1] - dem.x[0]))
    res_y = abs(float(dem.y[1] - dem.y[0]))

    dz_dy, dz_dx = np.gradient(elevation, res_y, res_x)
    slope_pct = np.sqrt(dz_dx**2 + dz_dy**2) * 100
    aspect_deg = (np.degrees(np.arctan2(-dz_dx, dz_dy))) % 360

    slope = xr.DataArray(slope_pct, dims=dem.dims, coords=dem.coords)
    aspect = xr.DataArray(aspect_deg, dims=dem.dims, coords=dem.coords)
    return slope, aspect


def shared_valid_mask(dem: xr.DataArray, slope: xr.DataArray) -> np.ndarray:
    """Máscara común a elevación y pendiente.

    H3: `.rio.clip()` deja NaN fuera del AOI y `np.gradient` propaga ese NaN un
    píxel hacia adentro (y en el borde del array usa diferencias de un solo lado).
    El legacy resumía elevación sobre `~isnan(elev)` y pendiente sobre
    `~isnan(slope)`, que en un AOI de 32 ha son 354 vs 293 píxeles: **17.2 % menos
    píxeles para la pendiente**, sobre una huella distinta. Los dos bloques del
    reporte describían áreas diferentes, y el desfase crece con el cociente
    perímetro/área (peor en AOIs chicos o alargados).

    La intersección es la única elección honesta: reporta el AOI erosionado un
    píxel, pero elevación y pendiente hablan exactamente del mismo territorio.
    """
    elev = np.asarray(dem.values, dtype="float64")
    slp = np.asarray(slope.values, dtype="float64")
    return np.isfinite(elev) & np.isfinite(slp)


def summarize_topography(dem: xr.DataArray, slope: xr.DataArray) -> dict:
    elev = np.asarray(dem.values, dtype="float64")
    slp = np.asarray(slope.values, dtype="float64")

    if not np.isfinite(elev).any():
        raise RuntimeError("El DEM no tiene datos válidos dentro del AOI.")

    mask = shared_valid_mask(dem, slope)
    if not mask.any():
        raise RuntimeError(
            "El AOI es demasiado chico: al descartar el anillo de borde (donde la "
            "pendiente no es calculable) no queda ningún píxel válido."
        )

    valid_elev = elev[mask]
    valid_slope = slp[mask]

    total = valid_slope.size
    class_pct = {}
    for lo, hi, label in SLOPE_CLASSES:
        cls = (valid_slope >= lo) & (valid_slope < hi)
        class_pct[label] = float(cls.sum() / total * 100) if total else 0.0

    return {
        "elevation_min_m": float(np.min(valid_elev)),
        "elevation_max_m": float(np.max(valid_elev)),
        "elevation_mean_m": float(np.mean(valid_elev)),
        "elevation_range_m": float(np.max(valid_elev) - np.min(valid_elev)),
        "slope_mean_pct": float(np.mean(valid_slope)),
        "slope_max_pct": float(np.max(valid_slope)),
        "slope_class_pct": class_pct,
    }
