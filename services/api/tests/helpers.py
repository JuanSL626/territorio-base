"""Constructores sintéticos compartidos por la suite offline."""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass, field
from typing import Any

import numpy as np
import rioxarray  # noqa: F401  (registra el accessor .rio)
import xarray as xr


@dataclass
class FakeAsset:
    extra_fields: dict = field(default_factory=dict)


@dataclass
class FakeItem:
    """Lo mínimo de un `pystac.Item` que el código lee."""

    id: str = "item"
    properties: dict = field(default_factory=dict)
    assets: dict[str, Any] = field(default_factory=dict)
    datetime: dt.datetime | None = None


def s2_item(
    item_id: str,
    baseline: str | None = "05.12",
    day: str = "2026-04-14",
    boa_offset_applied: bool | None = None,
    raster_offset: float | None = None,
    raster_scale: float | None = None,
) -> FakeItem:
    props: dict = {}
    if baseline is not None:
        props["s2:processing_baseline"] = baseline
    if boa_offset_applied is not None:
        props["earthsearch:boa_offset_applied"] = boa_offset_applied

    assets: dict[str, Any] = {}
    for band in ("B04", "B08"):
        extra: dict = {}
        if raster_offset is not None:
            band_meta: dict = {"offset": raster_offset}
            if raster_scale is not None:
                band_meta["scale"] = raster_scale
            extra["raster:bands"] = [band_meta]
        assets[band] = FakeAsset(extra_fields=extra)

    return FakeItem(
        id=item_id,
        properties=props,
        assets=assets,
        datetime=dt.datetime.fromisoformat(f"{day}T15:17:21+00:00"),
    )


def worldcover_item(year: int, tile: str = "N18W072", version: str = "v200") -> FakeItem:
    return FakeItem(
        id=f"ESA_WorldCover_10m_{year}_{version}_{tile}",
        properties={"datetime": f"{year}-01-01T00:00:00Z"},
        datetime=dt.datetime(year, 1, 1, tzinfo=dt.timezone.utc),
    )


def utm_raster(
    values: np.ndarray,
    *,
    x0: float = 400_000.0,
    y0: float = 2_043_000.0,
    res: float = 30.0,
    epsg: int = 32619,
) -> xr.DataArray:
    """Raster con fila 0 = NORTE (eje y descendente), como sale de odc.stac + clip."""
    values = np.asarray(values)
    ny, nx = values.shape
    x = x0 + res * np.arange(nx) + res / 2
    y = y0 - res * np.arange(ny) - res / 2
    da = xr.DataArray(values, dims=("y", "x"), coords={"y": y, "x": x})
    da.rio.write_crs(f"EPSG:{epsg}", inplace=True)
    return da


def wgs84_raster(
    values: np.ndarray,
    *,
    west: float = -69.94,
    north: float = 18.48,
    res: float = 0.001,
    y_descending: bool = True,
) -> xr.DataArray:
    """Raster en EPSG:4326. `y_descending=False` produce el caso patológico fila 0 = SUR."""
    values = np.asarray(values)
    ny, nx = values.shape
    x = west + res * np.arange(nx) + res / 2
    if y_descending:
        y = north - res * np.arange(ny) - res / 2
        data = values
    else:
        y = (north - res * ny) + res * np.arange(ny) + res / 2
        data = values[::-1]  # mismo terreno, guardado al revés
    da = xr.DataArray(data, dims=("y", "x"), coords={"y": y, "x": x})
    da.rio.write_crs("EPSG:4326", inplace=True)
    return da


def dem_with_nan_border(inner: np.ndarray, border: float = np.nan) -> np.ndarray:
    """Simula el relleno de `.rio.clip()`: un anillo de nodata alrededor del AOI."""
    ny, nx = inner.shape
    out = np.full((ny + 2, nx + 2), border, dtype="float64")
    out[1:-1, 1:-1] = inner
    return out
