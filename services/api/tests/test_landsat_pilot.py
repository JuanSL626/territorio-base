"""Prueba raster offline del NDVI Landsat C2 L2 sobre un AOI pequeño."""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_bounds
from rasterio.warp import transform_bounds

from territorio_base_api.analysis.landsat import compute_landsat_ndvi
from territorio_base_api.aoi import load_aoi_from_geojson_dict


def _write_band(path: Path, values: np.ndarray, transform) -> None:
    with rasterio.open(
        path,
        "w",
        driver="GTiff",
        width=values.shape[1],
        height=values.shape[0],
        count=1,
        dtype=str(values.dtype),
        crs="EPSG:32619",
        transform=transform,
        nodata=0,
    ) as dataset:
        dataset.write(values, 1)


def test_ndvi_aplica_escala_offset_qa_y_escribe_artefactos(tmp_path: Path) -> None:
    outer_wgs84 = (-70.0, 18.4, -69.85, 18.55)
    projected = transform_bounds("EPSG:4326", "EPSG:32619", *outer_wgs84)
    transform = from_bounds(*projected, width=12, height=12)
    red = np.full((12, 12), 10_000, dtype="uint16")
    nir = np.full((12, 12), 20_000, dtype="uint16")
    qa = np.zeros((12, 12), dtype="uint16")
    qa[5, 5] = 1 << 3  # cloud
    red_path, nir_path, qa_path = (tmp_path / name for name in ("red.tif", "nir.tif", "qa.tif"))
    _write_band(red_path, red, transform)
    _write_band(nir_path, nir, transform)
    _write_band(qa_path, qa, transform)
    aoi = load_aoi_from_geojson_dict(
        {
            "type": "Polygon",
            "coordinates": [
                [[-69.95, 18.45], [-69.9, 18.45], [-69.9, 18.5], [-69.95, 18.5], [-69.95, 18.45]]
            ],
        }
    )

    artifact = compute_landsat_ndvi(
        red_href=str(red_path),
        nir_href=str(nir_path),
        qa_href=str(qa_path),
        aoi=aoi,
        output_dir=tmp_path / "output",
        file_sizes={"SR_B4": 101, "SR_B5": 102, "QA_PIXEL": 103},
    )

    # Con escala+offset: red=.075, nir=.35, NDVI=.6470588; con DN crudo daría .3333.
    assert artifact.summary["mean"] == pytest.approx(0.647059, abs=1e-6)
    assert artifact.summary["valid_pixel_pct"] < 100
    assert artifact.raster_path.exists()
    assert artifact.preview_path.exists()
    assert {fact.key for fact in artifact.facts} == {"SR_B4", "SR_B5", "QA_PIXEL"}
    assert all(fact.epsg == 32619 for fact in artifact.facts)
    assert [fact.file_size_bytes for fact in artifact.facts] == [101, 102, 103]
    with rasterio.open(artifact.raster_path) as result:
        assert result.dtypes == ("float32",)
        assert result.crs.to_epsg() == 32619
