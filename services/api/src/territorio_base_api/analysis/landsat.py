"""Procesamiento mínimo y reproducible de Landsat 8/9 Collection 2 Level-2."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

import numpy as np
import rasterio
import rioxarray  # noqa: F401
import xarray as xr
from pyproj import CRS
from rasterio.enums import Resampling
from rasterio.features import geometry_mask
from rasterio.transform import array_bounds
from rasterio.warp import transform_bounds, transform_geom
from rasterio.windows import Window, from_bounds

from territorio_base_api.aoi import AOI
from territorio_base_api.render.overlay import render_overlay
from territorio_base_api.render.palettes import RASTER_SPECS
from territorio_base_api.render.raster_io import write_geotiff

SR_SCALE = 0.0000275
SR_OFFSET = -0.2
QA_INVALID_BITS = (0, 1, 2, 3, 4, 5)  # fill, dilated cloud, cirrus, cloud, shadow, snow


@dataclass(frozen=True)
class RasterFacts:
    key: str
    file_size_bytes: int | None
    width: int
    height: int
    epsg: int | None
    projection: str | None
    datum: str | None
    data_type: str
    resolution_m: float | None


@dataclass(frozen=True)
class LandsatNdviArtifact:
    raster_path: Path
    preview_path: Path
    summary: dict[str, float]
    facts: list[RasterFacts]
    width: int
    height: int
    bounds_wgs84: tuple[float, float, float, float]


def _remote_env() -> rasterio.Env:
    return rasterio.Env(
        GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
        CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.TIF",
        GDAL_HTTP_MAX_RETRY="3",
        GDAL_HTTP_RETRY_DELAY="1",
    )


def _window_for_aoi(dataset: rasterio.DatasetReader, aoi: AOI) -> Window:
    if dataset.crs is None:
        raise ValueError("El GeoTIFF Landsat no declara CRS.")
    west, south, east, north = transform_bounds("EPSG:4326", dataset.crs, *aoi.bbox)
    window = from_bounds(west, south, east, north, dataset.transform)
    full = Window(0, 0, dataset.width, dataset.height)
    try:
        window = window.intersection(full)
    except rasterio.errors.WindowError as exc:
        raise ValueError("La escena Landsat no cubre el AOI solicitado.") from exc
    return window.round_offsets().round_lengths()


def _facts(key: str, dataset: rasterio.DatasetReader, file_size: int | None) -> RasterFacts:
    epsg = dataset.crs.to_epsg() if dataset.crs else None
    projection = datum = None
    if dataset.crs:
        crs = CRS.from_user_input(dataset.crs)
        projection = crs.name
        datum = crs.datum.name if crs.datum else None
    xres, yres = dataset.res
    resolution = (
        float(max(abs(xres), abs(yres))) if dataset.crs and dataset.crs.is_projected else None
    )
    return RasterFacts(
        key=key,
        file_size_bytes=file_size,
        width=dataset.width,
        height=dataset.height,
        epsg=epsg,
        projection=projection,
        datum=datum,
        data_type=str(dataset.dtypes[0]),
        resolution_m=resolution,
    )


def _read_to_grid(
    href: str,
    *,
    key: str,
    aoi: AOI,
    target_bounds: tuple[float, float, float, float] | None = None,
    target_shape: tuple[int, int] | None = None,
    target_crs=None,
    file_size: int | None = None,
) -> tuple[np.ndarray, rasterio.Affine, object, RasterFacts]:
    with _remote_env(), rasterio.open(href) as dataset:
        if target_bounds is None:
            window = _window_for_aoi(dataset, aoi)
            transform = dataset.window_transform(window)
            height, width = int(window.height), int(window.width)
        else:
            if dataset.crs is None or target_crs is None:
                raise ValueError("No se puede alinear una banda Landsat sin CRS.")
            bounds = transform_bounds(target_crs, dataset.crs, *target_bounds)
            window = from_bounds(*bounds, dataset.transform)
            height, width = target_shape or (int(window.height), int(window.width))
            transform = rasterio.transform.from_bounds(*target_bounds, width, height)
        array = dataset.read(
            1,
            window=window,
            out_shape=(height, width),
            resampling=Resampling.nearest,
            boundless=True,
            fill_value=dataset.nodata or 0,
        )
        return array, transform, dataset.crs, _facts(key, dataset, file_size)


def compute_landsat_ndvi(
    *,
    red_href: str,
    nir_href: str,
    qa_href: str,
    aoi: AOI,
    output_dir: Path,
    file_sizes: Mapping[str, int | None] | None = None,
) -> LandsatNdviArtifact:
    """Lee solo la ventana del AOI, aplica QA_PIXEL y genera NDVI/preview locales."""
    sizes = file_sizes or {}
    red, transform, crs, red_facts = _read_to_grid(
        red_href, key="SR_B4", aoi=aoi, file_size=sizes.get("SR_B4")
    )
    height, width = red.shape
    bounds = array_bounds(height, width, transform)
    nir, _nir_transform, _nir_crs, nir_facts = _read_to_grid(
        nir_href,
        key="SR_B5",
        aoi=aoi,
        target_bounds=bounds,
        target_shape=(height, width),
        target_crs=crs,
        file_size=sizes.get("SR_B5"),
    )
    qa, _qa_transform, _qa_crs, qa_facts = _read_to_grid(
        qa_href,
        key="QA_PIXEL",
        aoi=aoi,
        target_bounds=bounds,
        target_shape=(height, width),
        target_crs=crs,
        file_size=sizes.get("QA_PIXEL"),
    )

    invalid_mask = np.zeros(qa.shape, dtype=bool)
    for bit in QA_INVALID_BITS:
        invalid_mask |= (qa.astype("uint32") & (1 << bit)) != 0
    aoi_geometry = transform_geom("EPSG:4326", crs, aoi.to_geojson())
    inside = geometry_mask(
        [aoi_geometry], out_shape=(height, width), transform=transform, invert=True
    )
    valid = inside & ~invalid_mask & (red > 0) & (nir > 0)

    red_reflectance = red.astype("float32") * SR_SCALE + SR_OFFSET
    nir_reflectance = nir.astype("float32") * SR_SCALE + SR_OFFSET
    denominator = nir_reflectance + red_reflectance
    with np.errstate(divide="ignore", invalid="ignore"):
        ndvi = (nir_reflectance - red_reflectance) / denominator
    valid &= np.isfinite(ndvi) & (denominator != 0) & (ndvi >= -1) & (ndvi <= 1)
    ndvi = np.where(valid, ndvi, np.nan).astype("float32")

    x = transform.c + transform.a * (np.arange(width) + 0.5)
    y = transform.f + transform.e * (np.arange(height) + 0.5)
    data = xr.DataArray(ndvi, dims=("y", "x"), coords={"y": y, "x": x})
    data.rio.write_crs(crs, inplace=True)
    data.rio.write_transform(transform, inplace=True)
    data.rio.write_nodata(np.nan, inplace=True)

    finite = ndvi[np.isfinite(ndvi)]
    if finite.size == 0:
        raise ValueError("La escena no contiene píxeles válidos en el AOI después de QA_PIXEL.")
    inside_count = int(np.count_nonzero(inside))
    summary = {
        "mean": round(float(np.mean(finite)), 6),
        "median": round(float(np.median(finite)), 6),
        "p90": round(float(np.percentile(finite, 90)), 6),
        "valid_pixel_pct": round(100.0 * finite.size / max(inside_count, 1), 4),
    }

    output_dir.mkdir(parents=True, exist_ok=True)
    raster_path = write_geotiff(data, output_dir / "landsat-ndvi.tif", RASTER_SPECS["ndvi"])
    overlay = render_overlay(data, RASTER_SPECS["ndvi"])
    preview_path = output_dir / "landsat-ndvi.png"
    preview_path.write_bytes(overlay.png)
    return LandsatNdviArtifact(
        raster_path=raster_path,
        preview_path=preview_path,
        summary=summary,
        facts=[red_facts, nir_facts, qa_facts],
        width=overlay.width,
        height=overlay.height,
        bounds_wgs84=overlay.bounds,
    )
