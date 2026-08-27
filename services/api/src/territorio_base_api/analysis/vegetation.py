"""Estadísticas de cobertura y densidad arbórea a partir de NDVI (Sentinel-2) y ESA WorldCover.

Las dos mitades (NDVI y WorldCover) se resumen por separado para que la caída de
una fuente no anule la otra (aislamiento de fallas por fuente — regresión #3 del
inventario).
"""

from __future__ import annotations

import numpy as np
import xarray as xr

from territorio_base_api.sources.stac import TREE_COVER_CLASS, WORLDCOVER_CLASSES

NDVI_DENSITY_CLASSES = [
    (-1.0, 0.2, "Sin vegetación / suelo desnudo o agua"),
    (0.2, 0.4, "Vegetación dispersa / matorral bajo"),
    (0.4, 0.6, "Vegetación densa / bosque secundario"),
    (0.6, 1.0, "Vegetación muy densa / dosel maduro"),
]

# Un color por clase, mismo orden que NDVI_DENSITY_CLASSES (rampa amarillo->verde oscuro).
NDVI_DENSITY_COLORS = ["#bfae96", "#fee08b", "#66bd63", "#1a9850"]


def classify_ndvi_density(ndvi: xr.DataArray) -> xr.DataArray:
    """Índice de clase (0..3) de NDVI_DENSITY_CLASSES por píxel, NaN si no hay dato."""
    values = np.asarray(ndvi.values, dtype="float64")
    edges = [hi for _, hi, _ in NDVI_DENSITY_CLASSES[:-1]]  # bordes internos: [0.2, 0.4, 0.6]
    classified = np.full(values.shape, np.nan)
    valid = np.isfinite(values)
    classified[valid] = np.digitize(values[valid], edges)
    return xr.DataArray(classified, dims=ndvi.dims, coords=ndvi.coords)


def summarize_ndvi(ndvi: xr.DataArray) -> dict:
    values = np.asarray(ndvi.values, dtype="float64")
    valid = values[np.isfinite(values)]
    if valid.size == 0:
        raise RuntimeError("No hay píxeles NDVI válidos dentro del AOI (revisa nubosidad/fechas).")

    total = valid.size
    density_pct = {}
    for index, (lo, hi, label) in enumerate(NDVI_DENSITY_CLASSES):
        is_last = index == len(NDVI_DENSITY_CLASSES) - 1
        # H5: la última clase incluye su borde superior. Con `< hi` estricto, un
        # píxel con NDVI exactamente 1.0 desaparecía del histograma pero seguía
        # contando en el denominador, así que las cuatro clases no sumaban 100 %.
        cls = (valid >= lo) & (valid <= hi) if is_last else (valid >= lo) & (valid < hi)
        density_pct[label] = float(cls.sum() / total * 100)

    return {
        "ndvi_mean": float(np.mean(valid)),
        "ndvi_median": float(np.median(valid)),
        "ndvi_p90": float(np.percentile(valid, 90)),
        "ndvi_density_class_pct": density_pct,
    }


def summarize_worldcover(worldcover: xr.DataArray) -> dict:
    values = worldcover.values
    if np.issubdtype(values.dtype, np.floating):
        valid = values[np.isfinite(values)]
    else:
        valid = values.ravel()
    valid = valid[valid > 0]
    total = valid.size
    if total == 0:
        raise RuntimeError("No hay píxeles de ESA WorldCover válidos dentro del AOI.")

    # `worldcover_landcover_pct` es DISPERSO a propósito: las clases con 0 % se
    # omiten (el inventario lo marca como parte del contrato de datos).
    landcover_pct = {}
    for code, label in WORLDCOVER_CLASSES.items():
        pct = float((valid == code).sum() / total * 100)
        if pct > 0:
            landcover_pct[label] = pct

    return {
        "worldcover_tree_cover_pct": float((valid == TREE_COVER_CLASS).sum() / total * 100),
        "worldcover_landcover_pct": landcover_pct,
    }


def summarize_vegetation(ndvi: xr.DataArray, worldcover: xr.DataArray) -> dict:
    """Resumen combinado, con el orden de claves exacto del contrato legacy."""
    return {**summarize_ndvi(ndvi), **summarize_worldcover(worldcover)}
