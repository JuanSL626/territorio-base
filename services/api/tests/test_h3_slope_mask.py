"""H3 (MEDIO) — elevación y pendiente sobre el MISMO conjunto de píxeles.

`.rio.clip()` deja NaN fuera del AOI y `np.gradient` propaga ese NaN un píxel hacia
adentro. El legacy resumía elevación sobre `~isnan(elev)` y pendiente sobre
`~isnan(slope)`: dos denominadores, dos huellas, un solo reporte.

Incluye además la variante latente CRÍTICA: un DEM que declare `nodata=0`.
"""

from __future__ import annotations

import numpy as np
import pytest

from helpers import dem_with_nan_border, utm_raster
from territorio_base_api.analysis.topography import (
    compute_slope_aspect,
    sanitize_dem,
    shared_valid_mask,
    summarize_topography,
)


def _dem_plano_con_borde_alto() -> "tuple":
    """Interior plano a 100 m, anillo de borde a 900 m, y afuera NaN (el clip).

    El anillo de 900 m es visible para las estadísticas de ELEVACIÓN del legacy
    (no es NaN) pero invisible para las de PENDIENTE (np.gradient lo NaN-ea por
    vecindad con el relleno). Ese desacople es exactamente H3.
    """
    interior = np.full((6, 6), 100.0)
    con_anillo = dem_with_nan_border(interior, border=900.0)
    con_relleno = dem_with_nan_border(con_anillo, border=np.nan)
    dem = utm_raster(con_relleno)
    slope, _ = compute_slope_aspect(dem)
    return dem, slope


def test_el_legacy_usaba_denominadores_distintos() -> None:
    """Documenta el bug: menos píxeles válidos de pendiente que de elevación."""
    dem, slope = _dem_plano_con_borde_alto()
    validos_elev = int(np.isfinite(dem.values).sum())
    validos_slope = int(np.isfinite(slope.values).sum())

    assert validos_slope < validos_elev
    assert validos_slope / validos_elev < 0.95


def test_la_mascara_compartida_es_la_interseccion() -> None:
    dem, slope = _dem_plano_con_borde_alto()
    mask = shared_valid_mask(dem, slope)

    assert mask.sum() == int((np.isfinite(dem.values) & np.isfinite(slope.values)).sum())
    assert mask.sum() <= np.isfinite(dem.values).sum()
    assert np.array_equal(mask, mask & np.isfinite(slope.values))


def test_elevacion_y_pendiente_reportan_la_misma_huella() -> None:
    """EL test que falla contra el código viejo.

    El legacy reportaba `elevation_max_m = 900` (el anillo de borde, que la pendiente
    nunca vio) mientras clasificaba pendientes sobre otro conjunto de píxeles. Con la
    máscara compartida el máximo es 100: el mismo territorio en los dos bloques.
    """
    dem, slope = _dem_plano_con_borde_alto()

    #  Denominadores del legacy: 64 píxeles para elevación, 36 para pendiente.
    assert int(np.isfinite(dem.values).sum()) == 64
    assert int(np.isfinite(slope.values).sum()) == 36
    assert int(shared_valid_mask(dem, slope).sum()) == 36

    #  El legacy reportaba el anillo de 900 m, que la pendiente nunca vio.
    assert float(np.nanmax(dem.values)) == 900.0

    resumen = summarize_topography(dem, slope)
    assert resumen["elevation_max_m"] == 100.0
    assert resumen["elevation_min_m"] == 100.0
    assert resumen["elevation_range_m"] == 0.0
    assert sum(resumen["slope_class_pct"].values()) == pytest.approx(100.0, abs=1e-9)


def test_las_clases_de_pendiente_suman_100() -> None:
    rng = np.random.default_rng(20260827)
    dem = utm_raster(dem_with_nan_border(rng.uniform(0, 400, size=(30, 30))))
    slope, _ = compute_slope_aspect(dem)
    resumen = summarize_topography(dem, slope)
    assert sum(resumen["slope_class_pct"].values()) == pytest.approx(100.0, abs=1e-9)


def test_etiquetas_de_clase_exactas_y_en_orden() -> None:
    dem = utm_raster(dem_with_nan_border(np.full((8, 8), 50.0)))
    slope, _ = compute_slope_aspect(dem)
    assert list(summarize_topography(dem, slope)["slope_class_pct"]) == [
        "Plano (0-5%)",
        "Suave (5-15%)",
        "Moderado (15-30%)",
        "Fuerte (>30%)",
    ]


# --- variante latente CRÍTICA: nodata = 0 ----------------------------------


def test_nodata_cero_sin_sanear_produce_un_acantilado() -> None:
    """Si el DEM declarara nodata=0, `isnan` no filtra nada y el borde del AOI
    se vuelve un precipicio al nivel del mar."""
    interior = np.full((8, 8), 1500.0)
    con_relleno = dem_with_nan_border(interior, border=0.0)
    dem = utm_raster(con_relleno)
    slope, _ = compute_slope_aspect(dem)

    assert float(np.nanmax(slope.values)) > 1000.0


def test_sanitize_dem_convierte_el_nodata_declarado_en_nan() -> None:
    interior = np.full((8, 8), 1500.0)
    dem = utm_raster(dem_with_nan_border(interior, border=0.0))
    dem.rio.write_nodata(0, inplace=True)

    saneado = sanitize_dem(dem)
    slope, _ = compute_slope_aspect(saneado)
    resumen = summarize_topography(saneado, slope)

    assert np.isnan(saneado.values[0, 0])
    assert resumen["slope_max_pct"] == pytest.approx(0.0, abs=1e-9)
    assert resumen["elevation_mean_m"] == pytest.approx(1500.0)


def test_sanitize_dem_deja_pasar_nodata_nan() -> None:
    dem = utm_raster(dem_with_nan_border(np.full((5, 5), 12.0)))
    assert np.isnan(sanitize_dem(dem).values[0, 0])


# --- guardas de tamaño -----------------------------------------------------


def test_aoi_demasiado_chico_para_gradiente_da_error_claro() -> None:
    dem = utm_raster(np.array([[10.0, 11.0]]))
    with pytest.raises(RuntimeError, match="demasiado chico"):
        compute_slope_aspect(dem)


def test_dem_todo_nan_da_el_mensaje_legacy() -> None:
    dem = utm_raster(np.full((5, 5), np.nan))
    slope, _ = compute_slope_aspect(dem)
    with pytest.raises(RuntimeError, match="no tiene datos válidos"):
        summarize_topography(dem, slope)


def test_aoi_de_un_pixel_util_avisa_en_vez_de_dividir_por_cero() -> None:
    dem = utm_raster(dem_with_nan_border(np.full((1, 1), 10.0)))
    slope, _ = compute_slope_aspect(dem)
    with pytest.raises(RuntimeError, match="anillo de borde"):
        summarize_topography(dem, slope)
