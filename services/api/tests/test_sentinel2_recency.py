"""Selección temporal de Sentinel-2 para los análisis principales."""

from helpers import s2_item
from territorio_base_api.sources.stac import select_recent_sentinel2_items


def test_prioriza_fecha_reciente_antes_que_menor_nubosidad() -> None:
    antiguo_despejado = s2_item("antiguo", day="2026-01-10")
    antiguo_despejado.properties["eo:cloud_cover"] = 1
    reciente_valido = s2_item("reciente", day="2026-04-14")
    reciente_valido.properties["eo:cloud_cover"] = 25

    elegidos = select_recent_sentinel2_items([antiguo_despejado, reciente_valido], limit=1)

    assert [item.id for item in elegidos] == ["reciente"]


def test_nubosidad_desempata_escenas_de_la_misma_fecha() -> None:
    nublado = s2_item("nublado", day="2026-04-14")
    nublado.properties["eo:cloud_cover"] = 25
    despejado = s2_item("despejado", day="2026-04-14")
    despejado.properties["eo:cloud_cover"] = 5

    elegidos = select_recent_sentinel2_items([nublado, despejado], limit=2)

    assert [item.id for item in elegidos] == ["despejado", "nublado"]
