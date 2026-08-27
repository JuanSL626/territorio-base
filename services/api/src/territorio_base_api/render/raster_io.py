"""Lectura/escritura de los GeoTIFF recortados al AOI.

MEJORA sobre el export legacy (`app.py:353` hacía `raster.rio.to_raster(buf, driver="GTiff")`
a secas): acá los TIFF salen con **compresión DEFLATE** y con un **tag nodata explícito**.
El export legacy no tenía ninguno de los dos, así que el relleno NaN de fuera del AOI
se abría en QGIS como si fuera dato (una mancha de valores en vez de transparencia)
y los archivos pesaban varias veces de más.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import rioxarray  # noqa: F401  (registra el accessor .rio)
import xarray as xr

from territorio_base_api.render.palettes import RasterSpec


def prepare_for_storage(da: xr.DataArray, spec: RasterSpec) -> xr.DataArray:
    """Castea al dtype de la capa y materializa el nodata como valor real."""
    arr = np.asarray(da.values)
    if arr.ndim == 3 and arr.shape[0] == 1:
        da = da.isel({da.dims[0]: 0})
        arr = np.asarray(da.values)

    if spec.dtype.startswith("float"):
        out = arr.astype(spec.dtype)
        out = np.where(np.isfinite(out), out, np.nan).astype(spec.dtype)
    else:
        source = arr.astype("float64")
        missing = ~np.isfinite(source)
        if not np.issubdtype(arr.dtype, np.floating):
            missing |= arr == spec.nodata
        out = np.where(missing, spec.nodata, source).astype(spec.dtype)

    result = xr.DataArray(out, dims=da.dims, coords=da.coords, attrs=dict(da.attrs))
    result.rio.write_crs(da.rio.crs, inplace=True)
    result.rio.write_nodata(spec.nodata, inplace=True)
    return result


def write_geotiff(da: xr.DataArray, path: Path | str, spec: RasterSpec) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    prepared = prepare_for_storage(da, spec)
    prepared.rio.to_raster(
        path,
        driver="GTiff",
        compress="deflate",
        # predictor 3 = coma flotante, 2 = enteros. Mejora la compresión sin pérdida.
        predictor=3 if spec.dtype.startswith("float") else 2,
        zlevel=6,
        tiled=True,
        blockxsize=256,
        blockysize=256,
        nodata=spec.nodata,
    )
    return path


def read_geotiff(path: Path | str) -> xr.DataArray:
    da = rioxarray.open_rasterio(Path(path), masked=True)
    if "band" in da.dims:
        da = da.squeeze("band", drop=True)
    return da.load()
