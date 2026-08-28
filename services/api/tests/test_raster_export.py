"""Export GeoTIFF: compresión DEFLATE + tag nodata explícito.

El export legacy (`app.py:353`) era `raster.rio.to_raster(buf, driver="GTiff")` a
secas: sin compresión y sin nodata, así que el relleno de fuera del AOI se abría en
QGIS como si fuera dato. Estos tests fijan las dos mejoras.
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pytest
import rasterio

from helpers import dem_with_nan_border, utm_raster
from territorio_base_api.render.palettes import RASTER_SPECS
from territorio_base_api.render.raster_io import prepare_for_storage, read_geotiff, write_geotiff


@pytest.fixture
def dem() -> "object":
    return utm_raster(dem_with_nan_border(np.arange(64, dtype="float64").reshape(8, 8)))


def test_firma_de_geotiff(tmp_path: Path, dem) -> None:
    path = write_geotiff(dem, tmp_path / "dem.tif", RASTER_SPECS["dem"])
    firma = path.read_bytes()[:4]
    assert firma in (b"II*\x00", b"MM\x00*")


def test_lleva_compresion_deflate(tmp_path: Path, dem) -> None:
    path = write_geotiff(dem, tmp_path / "dem.tif", RASTER_SPECS["dem"])
    with rasterio.open(path) as src:
        assert src.profile["compress"].lower() == "deflate"


def test_lleva_tag_nodata_explicito(tmp_path: Path, dem) -> None:
    path = write_geotiff(dem, tmp_path / "dem.tif", RASTER_SPECS["dem"])
    with rasterio.open(path) as src:
        assert src.nodata is not None
        assert np.isnan(src.nodata)


def test_conserva_crs_transform_y_los_nan_de_afuera_del_aoi(tmp_path: Path, dem) -> None:
    path = write_geotiff(dem, tmp_path / "dem.tif", RASTER_SPECS["dem"])
    with rasterio.open(path) as src:
        assert src.crs.to_epsg() == 32619
        assert src.transform.a == pytest.approx(30.0)
        assert src.transform.e == pytest.approx(-30.0)  # y descendente = north-up
        datos = src.read(1, masked=True)

    assert datos.mask[0, 0], "el relleno de fuera del AOI tiene que quedar enmascarado"
    assert not datos.mask[1, 1]


def test_categorico_uint8_con_su_propio_nodata(tmp_path: Path) -> None:
    codigos = np.array([[10, 50, 0], [80, 10, 0]], dtype="uint8")
    path = write_geotiff(utm_raster(codigos), tmp_path / "wc.tif", RASTER_SPECS["worldcover"])
    with rasterio.open(path) as src:
        assert src.dtypes[0] == "uint8"
        assert src.nodata == 0
        assert src.read(1)[0, 0] == 10


def test_clases_ndvi_pasan_de_float_con_nan_a_uint8_con_255(tmp_path: Path) -> None:
    clases = np.array([[0.0, 1.0], [np.nan, 3.0]])
    preparado = prepare_for_storage(utm_raster(clases), RASTER_SPECS["ndvi_density"])
    assert preparado.dtype == np.uint8
    assert preparado.values[1, 0] == 255

    path = write_geotiff(utm_raster(clases), tmp_path / "nd.tif", RASTER_SPECS["ndvi_density"])
    with rasterio.open(path) as src:
        assert src.nodata == 255
        assert src.read(1, masked=True).mask[1, 0]


def test_roundtrip_conserva_valores(tmp_path: Path, dem) -> None:
    path = write_geotiff(dem, tmp_path / "dem.tif", RASTER_SPECS["dem"])
    vuelto = read_geotiff(path)
    original = dem.values
    np.testing.assert_allclose(
        np.nan_to_num(vuelto.values, nan=-9999), np.nan_to_num(original, nan=-9999), rtol=1e-6
    )


def test_la_compresion_achica_de_verdad(tmp_path: Path) -> None:
    """Un raster constante grande tiene que comprimir muchísimo. Sin `compress=` el
    archivo pesaría los ~4 MB crudos."""
    grande = utm_raster(np.full((1000, 1000), 42.0))
    path = write_geotiff(grande, tmp_path / "big.tif", RASTER_SPECS["dem"])
    crudo = 1000 * 1000 * 4
    assert path.stat().st_size < crudo / 10


def test_todas_las_capas_declaran_nombre_de_descarga_en_espanol() -> None:
    nombres = {spec.download_filename for spec in RASTER_SPECS.values()}
    assert len(nombres) == len(RASTER_SPECS), "hay nombres de descarga repetidos"
    assert {"elevacion.tif", "pendiente.tif", "ndvi.tif", "worldcover.tif"} <= nombres
    assert all(n.endswith(".tif") for n in nombres)


def test_aspect_ahora_si_es_exportable() -> None:
    """El inventario marca `aspect` como huérfano: se calculaba y no se podía bajar."""
    assert "aspect" in RASTER_SPECS
    assert RASTER_SPECS["aspect"].download_filename == "orientacion.tif"
