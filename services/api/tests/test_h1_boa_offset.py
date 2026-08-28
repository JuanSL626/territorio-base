"""H1 (CRÍTICO) — BOA_ADD_OFFSET de Sentinel-2 L2A.

Estos tests FALLAN contra el código legacy a propósito: `stac.py:96` del legacy
calculaba `ndvi = (nir - red) / (nir + red)` sobre DN crudos, sin ninguna de las
funciones que se ejercitan acá (`boa_dn_offset`, `boa_offsets_by_day`,
`offset_dataarray`, `ndvi_from_bands` con offset).

El caso numérico usa los DN medidos en vivo en `docs/migration/03-critique-2.md`
sobre 3 escenas reales de RD con baseline 05.12: red=1434, nir=4955.
"""

from __future__ import annotations

import datetime as dt

import numpy as np
import pytest

from helpers import s2_item
from territorio_base_api.analysis.vegetation import NDVI_DENSITY_CLASSES
from territorio_base_api.sources.stac import (
    BOA_ADD_OFFSET_DN,
    boa_dn_offset,
    boa_offsets_by_day,
    clean_ndvi,
    ndvi_from_bands,
    offset_dataarray,
)

# DN medianos reales (critique §1A, H1).
RED_DN = 1434.0
NIR_DN = 4955.0


def clase_de(ndvi: float) -> str:
    for index, (lo, hi, label) in enumerate(NDVI_DENSITY_CLASSES):
        ultimo = index == len(NDVI_DENSITY_CLASSES) - 1
        if (lo <= ndvi <= hi) if ultimo else (lo <= ndvi < hi):
            return label
    raise AssertionError(f"NDVI fuera de rango: {ndvi}")


# --- resolución del offset por ítem ----------------------------------------


@pytest.mark.parametrize(
    "baseline, esperado",
    [
        ("05.12", BOA_ADD_OFFSET_DN),  # producto actual
        ("04.00", BOA_ADD_OFFSET_DN),  # justo el corte (2022-01-25)
        ("03.01", 0.0),  # anterior al corte: no lleva offset
        ("02.07", 0.0),
    ],
)
def test_offset_por_processing_baseline(baseline: str, esperado: float) -> None:
    assert boa_dn_offset(s2_item("x", baseline=baseline)) == esperado


def test_offset_cero_si_el_proveedor_ya_lo_aplico() -> None:
    """`earthsearch:boa_offset_applied=True` gana sobre la regla de baseline.

    Aplicarlo dos veces sería tan incorrecto como no aplicarlo nunca.
    """
    item = s2_item("x", baseline="05.12", boa_offset_applied=True)
    assert boa_dn_offset(item) == 0.0


def test_offset_explicito_de_la_extension_raster_gana() -> None:
    """`raster:bands[].offset` viene en reflectancia; se convierte a DN con la escala."""
    item = s2_item("x", baseline="03.01", raster_offset=-0.1, raster_scale=0.0001)
    assert boa_dn_offset(item) == pytest.approx(-1000.0)


def test_offset_sin_escala_se_toma_como_dn() -> None:
    item = s2_item("x", baseline=None, raster_offset=-1000.0)
    assert boa_dn_offset(item) == pytest.approx(-1000.0)


def test_sin_metadatos_asume_cero_y_avisa(caplog: pytest.LogCaptureFixture) -> None:
    with caplog.at_level("WARNING"):
        assert boa_dn_offset(s2_item("sin-meta", baseline=None)) == 0.0
    assert "sin s2:processing_baseline" in caplog.text


# --- agrupación por día solar (como agrupa odc.stac.load) -------------------


def test_offsets_por_dia_solar() -> None:
    items = [
        s2_item("a", baseline="05.12", day="2026-04-14"),
        s2_item("b", baseline="05.12", day="2026-04-14"),
        s2_item("c", baseline="03.01", day="2026-03-25"),
    ]
    por_dia = boa_offsets_by_day(items)
    assert por_dia[dt.date(2026, 4, 14)] == BOA_ADD_OFFSET_DN
    assert por_dia[dt.date(2026, 3, 25)] == 0.0


def test_dia_con_offsets_en_conflicto_usa_el_mas_frecuente_y_avisa(
    caplog: pytest.LogCaptureFixture,
) -> None:
    items = [
        s2_item("a", baseline="05.12", day="2026-04-14"),
        s2_item("b", baseline="05.12", day="2026-04-14"),
        s2_item("c", baseline="03.01", day="2026-04-14"),
    ]
    with caplog.at_level("WARNING"):
        por_dia = boa_offsets_by_day(items)
    assert por_dia[dt.date(2026, 4, 14)] == BOA_ADD_OFFSET_DN
    assert "offsets BOA distintos" in caplog.text


def test_offset_dataarray_se_alinea_con_el_eje_time() -> None:
    por_dia = {dt.date(2026, 4, 14): -1000.0, dt.date(2026, 3, 25): 0.0}
    times = np.array(
        ["2026-03-25T15:17:21", "2026-04-14T15:17:21"], dtype="datetime64[ns]"
    )
    assert list(offset_dataarray(times, por_dia)) == [0.0, -1000.0]


def test_offset_dataarray_avisa_si_falta_un_dia(caplog: pytest.LogCaptureFixture) -> None:
    times = np.array(["2026-05-01T10:00:00"], dtype="datetime64[ns]")
    with caplog.at_level("WARNING"):
        assert list(offset_dataarray(times, {})) == [0.0]
    assert "Sin offset BOA" in caplog.text


# --- el impacto numérico: EL test que falla contra el código viejo ----------


def test_el_offset_cambia_la_clase_de_densidad_reportada() -> None:
    """Sin el offset la app reporta una clase de densidad MENOR que la real.

    Con los DN reales de una escena de RD: NDVI 0.551 (mal) vs 0.802 (bien). Cruza
    el corte de 0.6, así que la clase pasa de "densa / bosque secundario" a
    "muy densa / dosel maduro" — que es justo la estadística estrella del reporte.
    """
    sin_offset = float(ndvi_from_bands(RED_DN, NIR_DN))
    con_offset = float(
        ndvi_from_bands(RED_DN, NIR_DN, BOA_ADD_OFFSET_DN, BOA_ADD_OFFSET_DN)
    )

    assert sin_offset == pytest.approx(0.5511, abs=1e-3)
    assert con_offset == pytest.approx(0.8022, abs=1e-3)
    assert con_offset > sin_offset

    assert clase_de(sin_offset) == "Vegetación densa / bosque secundario"
    assert clase_de(con_offset) == "Vegetación muy densa / dosel maduro"


def test_el_offset_no_es_un_factor_de_escala_y_por_eso_no_se_cancela() -> None:
    """Un factor multiplicativo SÍ se cancela en un índice normalizado; el aditivo no.

    Es la razón exacta por la que el bug es invisible mirando el código: alguien
    piensa "es un índice normalizado, la calibración se cancela" — y eso solo vale
    para la escala.
    """
    escalado = float(ndvi_from_bands(RED_DN * 3, NIR_DN * 3))
    assert escalado == pytest.approx(float(ndvi_from_bands(RED_DN, NIR_DN)), abs=1e-12)

    desplazado = float(ndvi_from_bands(RED_DN, NIR_DN, -1000.0, -1000.0))
    assert abs(desplazado - float(ndvi_from_bands(RED_DN, NIR_DN))) > 0.2


def test_offset_vectorial_por_escena() -> None:
    """Escenas de baselines distintas en el mismo cubo llevan offsets distintos."""
    red = np.array([RED_DN, RED_DN])
    nir = np.array([NIR_DN, NIR_DN])
    offsets = np.array([BOA_ADD_OFFSET_DN, 0.0])

    ndvi = np.asarray(ndvi_from_bands(red, nir, offsets, offsets))
    assert ndvi[0] == pytest.approx(0.8022, abs=1e-3)
    assert ndvi[1] == pytest.approx(0.5511, abs=1e-3)


def test_clean_ndvi_descarta_lo_fisicamente_imposible() -> None:
    """H5: con reflectancias negativas el cociente puede salirse de [-1, 1]."""
    valores = np.array([-1.5, -1.0, 0.0, 1.0, 1.5, np.nan])
    limpio = clean_ndvi(valores)
    assert np.isnan(limpio[0]) and np.isnan(limpio[4]) and np.isnan(limpio[5])
    assert limpio[1] == -1.0 and limpio[3] == 1.0
