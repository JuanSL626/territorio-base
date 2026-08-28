"""REGRESIÓN #1 DEL INVENTARIO — orientación norte-sur del overlay.

Historia: se aplicaba `np.flipud` a arrays que ya venían con fila 0 = norte, y el
mapa quedaba espejado. La regla no es "nunca voltear" ni "siempre voltear": es
**verificar la orientación real contra la convención de bounds**. Estos tests
cubren las dos direcciones, así que ni reintroducir el flip ni sacar la
verificación pasan desapercibidos.
"""

from __future__ import annotations

import io

import numpy as np
import pytest
from PIL import Image

from helpers import wgs84_raster
from territorio_base_api.render.overlay import ensure_north_up, render_overlay
from territorio_base_api.render.palettes import RASTER_SPECS

# Gradiente vertical: la fila de arriba es la más ALTA. Si el PNG sale espejado,
# el píxel más claro aparece abajo.
GRADIENTE = np.array([[100.0, 100.0], [50.0, 50.0], [0.0, 0.0]])


def _png_rows(png: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(png)).convert("RGBA"))


def test_raster_north_up_no_se_voltea() -> None:
    da = wgs84_raster(GRADIENTE, y_descending=True)
    overlay = render_overlay(da, RASTER_SPECS["dem"])
    filas = _png_rows(overlay.png)

    west, south, east, north = overlay.bounds
    assert north > south and east > west

    # La fila 0 del PNG tiene que ser la del valor MÁXIMO (la del norte).
    assert filas.shape[:2] == GRADIENTE.shape
    assert filas[0, 0].tolist() != filas[-1, 0].tolist()
    assert np.array_equal(ensure_north_up(da).values, GRADIENTE)


def test_raster_south_up_si_se_voltea() -> None:
    """El único caso donde voltear es correcto: el array llega con fila 0 = sur."""
    da = wgs84_raster(GRADIENTE, y_descending=False)
    assert da.values[0, 0] == 0.0, "el fixture debe llegar invertido"
    assert float(da.y.values[0]) < float(da.y.values[-1])

    corregido = ensure_north_up(da)
    assert np.array_equal(corregido.values, GRADIENTE)
    assert float(corregido.y.values[0]) > float(corregido.y.values[-1])


def test_las_dos_orientaciones_producen_el_mismo_png() -> None:
    """Mismo terreno guardado de dos formas -> mismo overlay sobre el mapa."""
    a = render_overlay(wgs84_raster(GRADIENTE, y_descending=True), RASTER_SPECS["dem"])
    b = render_overlay(wgs84_raster(GRADIENTE, y_descending=False), RASTER_SPECS["dem"])

    assert np.array_equal(_png_rows(a.png), _png_rows(b.png))
    assert a.bounds == pytest.approx(b.bounds, abs=1e-9)


def test_ensure_north_up_es_idempotente() -> None:
    """Aplicarlo dos veces no puede volver a espejar (el bug original era doble flip)."""
    da = wgs84_raster(GRADIENTE, y_descending=False)
    una = ensure_north_up(da)
    dos = ensure_north_up(una)
    assert np.array_equal(una.values, dos.values)


def test_bounds_en_la_convencion_de_maplibre() -> None:
    da = wgs84_raster(GRADIENTE, west=-69.94, north=18.48, res=0.001)
    overlay = render_overlay(da, RASTER_SPECS["dem"])
    west, south, east, north = overlay.bounds

    assert west == pytest.approx(-69.94, abs=1e-9)
    assert north == pytest.approx(18.48, abs=1e-9)
    assert east == pytest.approx(-69.938, abs=1e-9)
    assert south == pytest.approx(18.477, abs=1e-9)

    # `coordinates` para ImageSource: TL, TR, BR, BL.
    assert overlay.coordinates == [
        [west, north],
        [east, north],
        [east, south],
        [west, south],
    ]


def test_los_nan_salen_transparentes() -> None:
    valores = np.array([[1.0, np.nan], [3.0, 4.0]])
    overlay = render_overlay(wgs84_raster(valores), RASTER_SPECS["dem"])
    alpha = _png_rows(overlay.png)[..., 3]
    assert alpha[0, 1] == 0
    assert alpha[0, 0] == 255 and alpha[1, 1] == 255


def test_la_opacidad_escala_el_canal_alfa() -> None:
    da = wgs84_raster(np.array([[1.0, 2.0], [3.0, 4.0]]))
    overlay = render_overlay(da, RASTER_SPECS["dem"], opacity=0.5)
    assert _png_rows(overlay.png)[..., 3].max() == pytest.approx(127, abs=1)


def test_categorico_usa_la_paleta_oficial_y_deja_el_resto_transparente() -> None:
    codigos = np.array([[10, 50], [0, 80]], dtype="uint8")
    overlay = render_overlay(wgs84_raster(codigos), RASTER_SPECS["worldcover"])
    filas = _png_rows(overlay.png)

    assert filas[0, 0][:3].tolist() == [0x00, 0x64, 0x00]  # #006400 Bosque
    assert filas[0, 1][:3].tolist() == [0xFA, 0x00, 0x00]  # #fa0000 Construida
    assert filas[1, 1][:3].tolist() == [0x00, 0x64, 0xC8]  # #0064c8 Agua
    assert filas[1, 0][3] == 0  # código 0 = nodata -> transparente


def test_la_leyenda_categorica_lista_solo_las_clases_presentes() -> None:
    codigos = np.array([[10, 50], [10, 50]], dtype="uint8")
    overlay = render_overlay(wgs84_raster(codigos), RASTER_SPECS["worldcover"])
    assert [e["code"] for e in overlay.legend] == [10, 50]


def test_ndvi_usa_rampa_fija_menos_uno_a_uno() -> None:
    da = wgs84_raster(np.array([[0.1, 0.2], [0.3, 0.4]]))
    overlay = render_overlay(da, RASTER_SPECS["ndvi"])
    assert overlay.vmin == pytest.approx(-1.0)
    assert overlay.vmax == pytest.approx(1.0)
    assert len(overlay.legend) == 5


def test_pendiente_usa_percentil_98_como_vmax() -> None:
    valores = np.concatenate([np.full(99, 10.0), np.array([500.0])]).reshape(10, 10)
    overlay = render_overlay(wgs84_raster(valores), RASTER_SPECS["slope"])
    assert overlay.vmin == pytest.approx(0.0)
    assert overlay.vmax < 500.0, "el outlier no puede fijar el tope de la rampa"
    assert overlay.vmax == pytest.approx(np.percentile(valores, 98), rel=1e-9)


def test_dem_usa_min_max_reales_del_aoi() -> None:
    valores = np.array([[120.0, 130.0], [140.0, 150.0]])
    overlay = render_overlay(wgs84_raster(valores), RASTER_SPECS["dem"])
    assert overlay.vmin == pytest.approx(120.0)
    assert overlay.vmax == pytest.approx(150.0)


def test_costera_enmascara_lo_seco_y_usa_el_mismo_vmax_que_la_leyenda() -> None:
    """Se corrige de paso la inconsistencia del legacy: overlay y leyenda divergían."""
    valores = np.array([[0.0, 0.0], [0.0, 0.05]])
    overlay = render_overlay(wgs84_raster(valores), RASTER_SPECS["coastal"])
    alpha = _png_rows(overlay.png)[..., 3]

    assert alpha[0, 0] == 0 and alpha[0, 1] == 0  # seco -> sin overlay
    assert alpha[1, 1] == 255
    assert overlay.vmax == pytest.approx(0.1)
    assert overlay.legend[-1]["label"] == "0.1 m"


def test_overrides_de_vmin_vmax() -> None:
    da = wgs84_raster(np.array([[0.0, 50.0], [100.0, 150.0]]))
    overlay = render_overlay(da, RASTER_SPECS["dem"], vmin=0.0, vmax=200.0)
    assert (overlay.vmin, overlay.vmax) == (0.0, 200.0)
