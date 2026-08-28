"""`slope-classes`: el servicio raster ahora emite clases de pendiente, no solo el
continuo (§4.3 de la tarea). Mirror exacto del path de `ndvi_density`:
`classify_*` produce índices de clase, y el renderer categórico genérico
(`render_overlay`, fijado por `test_overlay_orientation.py`) los pinta — no hay
un segundo renderer.

Los cortes son PORCENTAJE de pendiente (rise/run×100), no grados, y las cuatro
etiquetas son las del inventario legacy §3/§4, letra por letra:
"Plano (0-5%)", "Suave (5-15%)", "Moderado (15-30%)", "Fuerte (>30%)".
"""

from __future__ import annotations

import io

import numpy as np
from PIL import Image

from helpers import wgs84_raster
from territorio_base_api.analysis.topography import SLOPE_CLASSES, classify_slope_classes
from territorio_base_api.render.overlay import render_overlay
from territorio_base_api.render.palettes import RASTER_SPECS


def _png_rows(png: bytes) -> np.ndarray:
    return np.array(Image.open(io.BytesIO(png)).convert("RGBA"))


# --- clasificación: límites exactos -----------------------------------------


def test_las_cuatro_etiquetas_son_las_del_inventario_en_orden() -> None:
    assert [label for _lo, _hi, label in SLOPE_CLASSES] == [
        "Plano (0-5%)",
        "Suave (5-15%)",
        "Moderado (15-30%)",
        "Fuerte (>30%)",
    ]


def test_un_pixel_exactamente_en_5_cae_en_suave() -> None:
    """`lo <= valor < hi`: el mismo criterio que `summarize_topography`."""
    slope = wgs84_raster(np.array([[4.999, 5.0], [14.999, 15.0]]))
    codes = classify_slope_classes(slope).values
    assert codes[0, 0] == 0  # Plano
    assert codes[0, 1] == 1  # Suave: el corte de 5 % ya es Suave
    assert codes[1, 0] == 1  # Suave
    assert codes[1, 1] == 2  # Moderado: el corte de 15 % ya es Moderado


def test_un_pixel_exactamente_en_30_cae_en_fuerte() -> None:
    slope = wgs84_raster(np.array([[29.999, 30.0], [100.0, 0.0]]))
    codes = classify_slope_classes(slope).values
    assert codes[0, 0] == 2  # Moderado
    assert codes[0, 1] == 3  # Fuerte: el corte de 30 % ya es Fuerte
    assert codes[1, 0] == 3  # Fuerte
    assert codes[1, 1] == 0  # Plano


def test_nan_queda_sin_clase() -> None:
    slope = wgs84_raster(np.array([[np.nan, 10.0], [20.0, 40.0]]))
    codes = classify_slope_classes(slope).values
    assert np.isnan(codes[0, 0])
    assert not np.isnan(codes[0, 1])


# --- overlay: paleta oficial + transparencia --------------------------------


def test_el_overlay_pinta_la_paleta_oficial_por_clase() -> None:
    slope = wgs84_raster(np.array([[2.0, 10.0], [20.0, 40.0]]))
    codes = classify_slope_classes(slope)
    overlay = render_overlay(codes, RASTER_SPECS["slope_classes"])
    filas = _png_rows(overlay.png)

    assert filas[0, 0][:3].tolist() == [0xF7, 0xF7, 0xF7]  # Plano
    assert filas[0, 1][:3].tolist() == [0xFD, 0xD4, 0x9E]  # Suave
    assert filas[1, 0][:3].tolist() == [0xD9, 0xA4, 0x41]  # Moderado
    assert filas[1, 1][:3].tolist() == [0xB5, 0x50, 0x2F]  # Fuerte
    assert (filas[..., 3] == 255).all()


def test_fuera_del_aoi_o_sin_dato_sale_transparente() -> None:
    """NaN de pendiente (fuera del AOI, o el anillo de borde de H3) -> alfa 0."""
    slope = wgs84_raster(np.array([[np.nan, 10.0], [20.0, np.nan]]))
    codes = classify_slope_classes(slope)
    overlay = render_overlay(codes, RASTER_SPECS["slope_classes"])
    alpha = _png_rows(overlay.png)[..., 3]

    assert alpha[0, 0] == 0
    assert alpha[1, 1] == 0
    assert alpha[0, 1] == 255
    assert alpha[1, 0] == 255


def test_la_leyenda_solo_lista_las_clases_presentes_en_el_aoi() -> None:
    slope = wgs84_raster(np.array([[2.0, 2.0], [2.0, 40.0]]))
    codes = classify_slope_classes(slope)
    overlay = render_overlay(codes, RASTER_SPECS["slope_classes"])

    assert [entry["label"] for entry in overlay.legend] == ["Plano (0-5%)", "Fuerte (>30%)"]
    assert overlay.legend[0]["color"] == "#f7f7f7"
    assert overlay.legend[1]["color"] == "#b5502f"


def test_la_orientacion_norte_sur_no_se_espeja() -> None:
    """La misma verificación de la regresión #1, sobre la capa categórica nueva."""
    gradiente_de_clases = np.array([[40.0, 40.0], [2.0, 2.0]])  # fila 0 = Fuerte (norte)
    slope = wgs84_raster(gradiente_de_clases, y_descending=True)
    codes = classify_slope_classes(slope)
    overlay = render_overlay(codes, RASTER_SPECS["slope_classes"])
    filas = _png_rows(overlay.png)

    assert filas[0, 0][:3].tolist() == [0xB5, 0x50, 0x2F]  # Fuerte arriba (norte)
    assert filas[1, 0][:3].tolist() == [0xF7, 0xF7, 0xF7]  # Plano abajo (sur)
