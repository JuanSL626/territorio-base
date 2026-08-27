"""H2 (ALTO) — WorldCover: una sola época, no `.max(dim="time")`.

El legacy hacía `worldcover.max(dim="time")` sobre CÓDIGOS DE CLASE con las épocas
2020 (v100) y 2021 (v200) apiladas. `max` sobre códigos categóricos no significa
nada, y como "Bosque"=10 es el código más bajo, pierde toda discrepancia entre
épocas y encima mezcla dos años en una sola cifra.
"""

from __future__ import annotations

import numpy as np
import pytest
import xarray as xr

from helpers import worldcover_item
from territorio_base_api.analysis.vegetation import summarize_worldcover
from territorio_base_api.sources.stac import TREE_COVER_CLASS, select_worldcover_epoch


def test_selecciona_la_epoca_mas_reciente() -> None:
    items = [worldcover_item(2020, version="v100"), worldcover_item(2021, version="v200")]
    elegidos, anio = select_worldcover_epoch(items)
    assert anio == 2021
    assert [it.id for it in elegidos] == ["ESA_WorldCover_10m_2021_v200_N18W072"]


def test_conserva_todas_las_tiles_de_esa_epoca() -> None:
    """Filtrar por año no puede tirar tiles: un AOI grande necesita mosaico espacial."""
    items = [
        worldcover_item(2021, tile="N18W072"),
        worldcover_item(2021, tile="N18W069"),
        worldcover_item(2020, tile="N18W072", version="v100"),
    ]
    elegidos, anio = select_worldcover_epoch(items)
    assert anio == 2021
    assert len(elegidos) == 2


def test_sin_items_no_revienta() -> None:
    assert select_worldcover_epoch([]) == ([], 0)


def test_el_anio_puede_venir_del_id_si_no_hay_datetime() -> None:
    from helpers import FakeItem

    items = [FakeItem(id="ESA_WorldCover_10m_2021_v200_N18W072", properties={})]
    _, anio = select_worldcover_epoch(items)
    assert anio == 2021


def _cubo_dos_epocas() -> xr.DataArray:
    """Cubo 2×N donde 2020 y 2021 discrepan en algunos píxeles.

    2021 dice "Bosque" (10) donde 2020 decía "Pastizal" (30) o "Construida" (50).
    """
    e2020 = np.array([[30, 30, 50, 50], [10, 10, 30, 50]], dtype="uint8")
    e2021 = np.array([[10, 10, 10, 50], [10, 10, 80, 50]], dtype="uint8")
    return xr.DataArray(
        np.stack([e2020, e2021]),
        dims=("time", "y", "x"),
        coords={"time": np.array(["2020-01-01", "2021-01-01"], dtype="datetime64[ns]")},
    )


def test_max_sobre_time_pierde_el_bosque_que_el_2021_declara() -> None:
    """Reproduce el bug: `max` se queda con el código MAYOR, y bosque es el menor."""
    cubo = _cubo_dos_epocas()

    legacy = cubo.max(dim="time")
    correcto = cubo.isel(time=1)  # época 2021, ya filtrada

    bosque_legacy = int((legacy.values == TREE_COVER_CLASS).sum())
    bosque_correcto = int((correcto.values == TREE_COVER_CLASS).sum())

    assert bosque_correcto == 5
    assert bosque_legacy == 2, "el max() se comió el bosque declarado por 2021"
    assert bosque_legacy < bosque_correcto


def test_una_sola_epoca_no_inventa_clases_ausentes_en_ninguna() -> None:
    """`max` puede devolver una clase que ninguna época declara para ese píxel.

    Con dos épocas el máximo es siempre uno de los dos valores, pero al mezclar
    varios píxeles el MAPA resultante ya no corresponde a ningún año publicado:
    es un año que nunca existió.
    """
    cubo = _cubo_dos_epocas()
    legacy = cubo.max(dim="time").values
    e2020, e2021 = cubo.values

    assert not np.array_equal(legacy, e2020)
    assert not np.array_equal(legacy, e2021)


def test_porcentajes_de_cobertura_difieren_entre_legacy_y_epoca_unica() -> None:
    cubo = _cubo_dos_epocas()
    legacy = summarize_worldcover(cubo.max(dim="time"))
    correcto = summarize_worldcover(cubo.isel(time=1))

    assert legacy["worldcover_tree_cover_pct"] == pytest.approx(25.0)
    assert correcto["worldcover_tree_cover_pct"] == pytest.approx(62.5)


def test_landcover_pct_es_disperso() -> None:
    """Contrato del inventario: las clases con 0 % NO aparecen con 0.0, no aparecen."""
    cubo = _cubo_dos_epocas()
    resumen = summarize_worldcover(cubo.isel(time=1))
    assert set(resumen["worldcover_landcover_pct"]) == {
        "Bosque / cobertura arbórea",
        "Área construida",
        "Cuerpo de agua permanente",
    }
    assert "Pastizal" not in resumen["worldcover_landcover_pct"]
    assert all(v > 0 for v in resumen["worldcover_landcover_pct"].values())
    assert sum(resumen["worldcover_landcover_pct"].values()) == pytest.approx(100.0, abs=1e-9)
