"""Contrato de datos y de strings: lo que el inventario legacy fija palabra por palabra.

Si un test de acá falla, o alguien cambió una etiqueta que la UI usa como clave, o
alguien rompió la paridad con `docs/migration/00-legacy-inventory.md`.
"""

from __future__ import annotations

import pytest

from territorio_base_api.analysis.report import STEP_DEM, STEP_DONE, STEP_NDVI, STEP_WORLDCOVER
from territorio_base_api.analysis.topography import SLOPE_CLASSES
from territorio_base_api.analysis.vegetation import NDVI_DENSITY_CLASSES, NDVI_DENSITY_COLORS
from territorio_base_api.models import (
    AnalysisResult,
    CoastalPreset,
    TopographySummary,
    VegetationSummary,
)
from territorio_base_api.render.palettes import RASTER_SPECS, WORLDCOVER_COLORS
from territorio_base_api.sources import aqueduct
from territorio_base_api.sources.stac import TREE_COVER_CLASS, WORLDCOVER_CLASSES


def test_clases_de_pendiente_exactas() -> None:
    assert [(lo, hi, label) for lo, hi, label in SLOPE_CLASSES] == [
        (0, 5, "Plano (0-5%)"),
        (5, 15, "Suave (5-15%)"),
        (15, 30, "Moderado (15-30%)"),
        (30, float("inf"), "Fuerte (>30%)"),
    ]


def test_clases_de_densidad_ndvi_exactas() -> None:
    assert NDVI_DENSITY_CLASSES == [
        (-1.0, 0.2, "Sin vegetación / suelo desnudo o agua"),
        (0.2, 0.4, "Vegetación dispersa / matorral bajo"),
        (0.4, 0.6, "Vegetación densa / bosque secundario"),
        (0.6, 1.0, "Vegetación muy densa / dosel maduro"),
    ]
    assert NDVI_DENSITY_COLORS == ["#bfae96", "#fee08b", "#66bd63", "#1a9850"]


def test_paleta_worldcover_exacta() -> None:
    assert WORLDCOVER_CLASSES == {
        10: "Bosque / cobertura arbórea",
        20: "Matorral (shrubland)",
        30: "Pastizal",
        40: "Cultivos",
        50: "Área construida",
        60: "Suelo desnudo / disperso",
        70: "Nieve/hielo",
        80: "Cuerpo de agua permanente",
        90: "Humedal herbáceo",
        95: "Manglar",
        100: "Musgo y liquen",
    }
    assert WORLDCOVER_COLORS == {
        10: "#006400",
        20: "#ffbb22",
        30: "#ffff4c",
        40: "#f096ff",
        50: "#fa0000",
        60: "#b4b4b4",
        70: "#f0f0f0",
        80: "#0064c8",
        90: "#0096a0",
        95: "#00cf75",
        100: "#fae6a0",
    }
    assert TREE_COVER_CLASS == 10
    assert set(WORLDCOVER_COLORS) == set(WORLDCOVER_CLASSES)


def test_presets_de_aqueduct_exactos() -> None:
    assert list(aqueduct.PRESET_KEYS) == [
        "Hoy (histórico) — 100 años de retorno",
        "2050 · RCP4.5 (optimista) — 100 años",
        "2050 · RCP8.5 (pesimista) — 100 años",
        "2080 · RCP8.5 (pesimista) — 100 años",
        "2080 · RCP8.5 (pesimista) — 1000 años (extremo)",
    ]
    for params in aqueduct.PRESETS.values():
        assert params["subsidence"] == "wtsub"
        assert params["percentile"] == 95


def test_presets_producen_los_nombres_de_archivo_de_wri() -> None:
    assert aqueduct.build_filename(**aqueduct.resolve_preset("Hoy (histórico) — 100 años de retorno")) == (
        "inuncoast_historical_wtsub_hist_rp0100_0.tif"
    )
    assert aqueduct.build_filename(
        **aqueduct.resolve_preset("2080 · RCP8.5 (pesimista) — 1000 años (extremo)")
    ) == "inuncoast_rcp8p5_wtsub_2080_rp1000_0.tif"


def test_preset_desconocido_da_error_util() -> None:
    with pytest.raises(ValueError, match="desconocido"):
        aqueduct.resolve_preset("2100 · lo que sea")


def test_el_literal_de_openapi_y_los_presets_no_pueden_divergir() -> None:
    assert set(CoastalPreset.__args__) == set(aqueduct.PRESET_KEYS)


def test_mensajes_de_progreso_identicos_a_los_del_legacy() -> None:
    assert STEP_DEM == "Descargando DEM (Copernicus GLO-30)…"
    assert STEP_NDVI == "Descargando Sentinel-2 y calculando NDVI…"
    assert STEP_WORLDCOVER == "Descargando ESA WorldCover…"
    assert STEP_DONE == "Análisis completo"


# --- forma del contrato de datos -------------------------------------------


def test_topography_summary_tiene_exactamente_las_claves_legacy() -> None:
    assert list(TopographySummary.model_fields) == [
        "elevation_min_m",
        "elevation_max_m",
        "elevation_mean_m",
        "elevation_range_m",
        "slope_mean_pct",
        "slope_max_pct",
        "slope_class_pct",
    ]


def test_vegetation_summary_tiene_exactamente_las_claves_legacy() -> None:
    assert list(VegetationSummary.model_fields) == [
        "ndvi_mean",
        "ndvi_median",
        "ndvi_p90",
        "ndvi_density_class_pct",
        "worldcover_tree_cover_pct",
        "worldcover_landcover_pct",
    ]


def test_available_existe_y_es_distinto_de_no_encontre_nada() -> None:
    """Regresión #3: `available: False` = "no se pudo consultar", no "no hay nada"."""
    schema = AnalysisResult.model_json_schema()
    defs = schema["$defs"]
    assert "available" in defs["TopographyResult"]["required"]
    assert "available" in defs["VegetationResult"]["required"]
    #  Y la vegetación distingue cuál de sus dos fuentes falló.
    assert {"ndvi_available", "worldcover_available"} <= set(defs["VegetationResult"]["required"])


def test_los_campos_de_vegetacion_son_anulables_por_fuente() -> None:
    """NDVI puede caerse sin llevarse WorldCover puesto, y viceversa."""
    solo_ndvi = VegetationSummary(ndvi_mean=0.4, ndvi_median=0.4, ndvi_p90=0.6)
    assert solo_ndvi.worldcover_tree_cover_pct is None
    solo_wc = VegetationSummary(worldcover_tree_cover_pct=12.0, worldcover_landcover_pct={"Pastizal": 100.0})
    assert solo_wc.ndvi_mean is None


def test_todas_las_capas_de_overlay_tienen_spec() -> None:
    assert set(RASTER_SPECS) == {
        "dem",
        "slope",
        "slope_classes",
        "aspect",
        "ndvi",
        "ndvi_density",
        "worldcover",
        "coastal",
    }
    for layer, spec in RASTER_SPECS.items():
        assert spec.layer == layer
        assert 0.0 <= spec.default_opacity <= 1.0
        if spec.kind == "categorical":
            assert spec.colors and spec.labels
        else:
            assert spec.cmap


def test_opacidades_por_default_iguales_a_las_del_legacy() -> None:
    assert RASTER_SPECS["dem"].default_opacity == 0.7
    assert RASTER_SPECS["slope"].default_opacity == 0.7
    assert RASTER_SPECS["ndvi"].default_opacity == 0.7
    assert RASTER_SPECS["ndvi_density"].default_opacity == 0.75  # la única capa on por default
    assert RASTER_SPECS["worldcover"].default_opacity == 0.7
    assert RASTER_SPECS["coastal"].default_opacity == 0.8
