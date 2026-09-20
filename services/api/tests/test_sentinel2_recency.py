"""Selección temporal de Sentinel-2 para los análisis principales."""

import datetime as dt

from helpers import FakeItem
from helpers import s2_item
from territorio_base_api.analysis.report import build_provenance
from territorio_base_api.sources.stac import (
    select_recent_sentinel2_items,
    select_sentinel2_temporal,
)


CHECKED_ON = dt.date(2026, 9, 20)


def scene(item_id: str, day: str, cloud: float) -> FakeItem:
    item = s2_item(item_id, day=day)
    item.properties["eo:cloud_cover"] = cloud
    return item


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


def test_ventana_primaria_no_mezcla_escenas_antiguas() -> None:
    selection = select_sentinel2_temporal(
        [scene("reciente", "2026-09-10", 12), scene("antigua", "2026-05-01", 1)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.status == "updated"
    assert [item.id for item in selection.used_items] == ["reciente"]
    assert selection.selection_window_days == 30


def test_ultima_nublada_no_oculta_la_ultima_valida() -> None:
    selection = select_sentinel2_temporal(
        [scene("nublada", "2026-09-15", 85), scene("valida", "2026-09-05", 10)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.status == "cloudy"
    assert selection.latest_available.id == "nublada"
    assert selection.latest_valid.id == "valida"
    assert selection.used_items[0].id == "valida"


def test_sin_valida_en_30_dias_usa_fallback_y_marca_retraso() -> None:
    selection = select_sentinel2_temporal(
        [scene("reciente-nublada", "2026-09-10", 90), scene("fallback", "2026-08-04", 22)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.status == "cloudy"
    assert selection.used_items[0].id == "fallback"
    assert selection.selection_window_days == 180


def test_fallback_sin_escena_reciente_se_marca_retrasado() -> None:
    selection = select_sentinel2_temporal(
        [scene("fallback", "2026-08-04", 22)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.status == "delayed"
    assert selection.used_items[0].id == "fallback"


def test_sin_escena_valida_en_180_dias() -> None:
    selection = select_sentinel2_temporal(
        [scene("nublada-antigua", "2026-05-01", 95)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.status == "no_valid_data"
    assert selection.latest_valid is None
    assert selection.used_items == ()


def test_escena_sin_fecha_no_se_selecciona() -> None:
    sin_fecha = FakeItem(id="sin-fecha", properties={"eo:cloud_cover": 0})
    selection = select_sentinel2_temporal(
        [sin_fecha, scene("valida", "2026-09-01", 20)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.latest_available.id == "valida"
    assert [item.id for item in selection.used_items] == ["valida"]


def test_nubosidad_ausente_no_rompe_el_orden_ni_se_declara_valida() -> None:
    sin_nubosidad = s2_item("sin-nubosidad", day="2026-09-15")
    selection = select_sentinel2_temporal(
        [sin_nubosidad, scene("valida", "2026-09-01", 20)],
        checked_on=CHECKED_ON,
        max_cloud_cover=30,
        fallback_window_days=180,
    )

    assert selection.latest_available.id == "sin-nubosidad"
    assert selection.latest_valid.id == "valida"
    assert [item.id for item in selection.used_items] == ["valida"]


def test_procedencia_conserva_ultima_nublada_aunque_no_haya_ndvi() -> None:
    provenance = build_provenance(
        {},
        sentinel2_temporal={
            "temporal_status": "cloudy",
            "temporal_message": "La última escena está nublada.",
            "latest_available_scene_id": "nublada",
            "latest_available_acquired_at": "2026-09-16T15:17:19+00:00",
            "latest_available_cloud_cover_pct": 65.02,
            "fallback_window_days": 180,
            "max_cloud_cover": 30,
        },
    )

    assert provenance["sentinel2_temporal_status"] == "cloudy"
    assert provenance["sentinel2_latest_available_scene_id"] == "nublada"
    assert provenance["sentinel2_latest_available_cloud_cover_pct"] == 65.02
    assert provenance["sentinel2_lookback_days"] == 180
