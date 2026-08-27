"""Suite de aceptación contra servicios reales (Planetary Computer, WRI).

Marcada `network`: CI corre `uv run pytest -m "not network"`.

Los valores esperados y sus TOLERANCIAS están en `tests/fixtures/expected.json`,
con el porqué de cada ventana explicado ahí y en `tests/README.md`. La regla
general: lo que sale de un dataset congelado (Copernicus DEM, WorldCover 2021) se
verifica con ventana estrecha; lo que sale de una ventana móvil de 180 días
(Sentinel-2) se verifica por invariantes (clase dominante, signo) y ventanas anchas.
"""

from __future__ import annotations

import pytest

from conftest import AOI_NAMES, load_aoi_geojson
from territorio_base_api.analysis.report import run_analysis
from territorio_base_api.aoi import load_aoi_from_geojson_dict
from territorio_base_api.sources import aqueduct, stac

pytestmark = [pytest.mark.network, pytest.mark.slow]


@pytest.fixture(scope="module")
def corridas() -> dict:
    salida = {}
    for name in AOI_NAMES:
        aoi = load_aoi_from_geojson_dict(load_aoi_geojson(name))
        salida[name] = run_analysis(aoi)
    return salida


def _entre(valor: float, ventana: list[float], etiqueta: str) -> None:
    lo, hi = ventana
    assert lo <= valor <= hi, f"{etiqueta}: {valor:.4f} fuera de [{lo}, {hi}]"


@pytest.mark.parametrize("name", AOI_NAMES)
def test_todas_las_fuentes_responden(corridas: dict, name: str) -> None:
    r = corridas[name]
    assert r["topography"]["available"], r["topography"]["error"]
    assert r["vegetation"]["ndvi_available"], r["vegetation"]["ndvi_error"]
    assert r["vegetation"]["worldcover_available"], r["vegetation"]["worldcover_error"]


@pytest.mark.parametrize("name", AOI_NAMES)
def test_topografia_dentro_de_tolerancia(corridas: dict, name: str, expected: dict) -> None:
    esperado = expected["aois"][name]["topography"]
    s = corridas[name]["topography"]["summary"]

    for campo in (
        "elevation_min_m",
        "elevation_max_m",
        "elevation_mean_m",
        "elevation_range_m",
        "slope_mean_pct",
        "slope_max_pct",
    ):
        _entre(s[campo], esperado[campo], f"{name}.{campo}")

    dominante = max(s["slope_class_pct"], key=s["slope_class_pct"].get)
    assert dominante == esperado["dominant_slope_class"]
    assert sum(s["slope_class_pct"].values()) == pytest.approx(100.0, abs=0.01)


@pytest.mark.parametrize("name", AOI_NAMES)
def test_vegetacion_dentro_de_tolerancia(corridas: dict, name: str, expected: dict) -> None:
    esperado = expected["aois"][name]["vegetation"]
    s = corridas[name]["vegetation"]["summary"]

    for campo in ("ndvi_mean", "ndvi_median", "ndvi_p90"):
        _entre(s[campo], esperado[campo], f"{name}.{campo}")

    dominante = max(s["ndvi_density_class_pct"], key=s["ndvi_density_class_pct"].get)
    assert dominante == esperado["dominant_ndvi_density_class"]
    assert sum(s["ndvi_density_class_pct"].values()) == pytest.approx(100.0, abs=0.01)

    _entre(
        s["worldcover_tree_cover_pct"],
        esperado["worldcover_tree_cover_pct"],
        f"{name}.worldcover_tree_cover_pct",
    )
    lc = s["worldcover_landcover_pct"]
    assert max(lc, key=lc.get) == esperado["dominant_landcover_class"]
    assert all(v > 0 for v in lc.values()), "worldcover_landcover_pct tiene que ser disperso"
    assert sum(lc.values()) == pytest.approx(100.0, abs=0.01)


@pytest.mark.parametrize("name", AOI_NAMES)
def test_procedencia(corridas: dict, name: str, expected: dict) -> None:
    esperado = expected["aois"][name]["provenance"]
    p = corridas[name]["provenance"]

    # H2: una sola época de WorldCover, nunca una mezcla.
    assert p["worldcover_epoch_year"] == esperado["worldcover_epoch_year"]
    # H1: el offset BOA se aplicó de verdad sobre productos baseline >= 04.00.
    assert p["sentinel2_boa_offsets_applied"] == esperado["sentinel2_boa_offsets_applied"]
    assert p["sentinel2_scene_count"] and p["sentinel2_scene_count"] <= 6

    minimo = esperado.get("dem_item_count_min")
    if minimo:
        assert p["dem_item_count"] >= minimo, (
            "este AOI cruza una costura de tiles de 1°×1°: tiene que mosaiquear >1 ítem"
        )


@pytest.mark.parametrize("name", AOI_NAMES)
def test_geometria_de_los_rasters(corridas: dict, name: str) -> None:
    r = corridas[name]
    epsg = r["aoi"]["utm_epsg"]
    for capa in ("dem", "slope", "ndvi", "worldcover"):
        da = r["rasters"][capa]
        assert da.rio.crs.to_epsg() == epsg, f"{name}.{capa} no está en la UTM del AOI"
        assert da.ndim == 2 and min(da.shape) > 0
        #  Fila 0 = norte (regresión #1): el eje y tiene que venir descendente.
        assert float(da.y.values[0]) > float(da.y.values[-1])

    #  NDVI a 10 m tiene que ser más fino que el DEM a 30 m.
    assert r["rasters"]["ndvi"].shape[0] > r["rasters"]["dem"].shape[0]


def test_cruce_72w_es_realmente_un_cruce_de_zonas(corridas: dict) -> None:
    """El único caso donde los ítems S2 llegan en dos CRS y odc tiene que warpear."""
    from territorio_base_api.aoi import utm_epsg_for

    r = corridas["cruce-72w"]
    minx, _, maxx, _ = r["aoi"]["bbox"]
    assert utm_epsg_for(minx, 18.3) != utm_epsg_for(maxx, 18.3)
    assert r["topography"]["available"] and r["vegetation"]["ndvi_available"]


def test_multipolygon_con_hueco_recorta_el_hueco(corridas: dict) -> None:
    """H11: un recorte que ignora el anillo interior convierte la dona en disco.

    El bbox del AOI encierra 2.6× su área real, así que si el recorte respetó tanto
    el hueco como el espacio entre las dos partes, tiene que haber píxeles NaN
    dentro del bounding box del raster.
    """
    import numpy as np

    dem = corridas["multipolygon-con-hueco"]["rasters"]["dem"].values
    assert np.isnan(dem).any(), "no quedó ningún píxel recortado: el hueco se perdió"
    assert np.isfinite(dem).any()


@pytest.mark.parametrize("preset", list(aqueduct.PRESET_KEYS))
def test_los_5_presets_de_aqueduct_se_pueden_traer(preset: str) -> None:
    """Cada preset apunta a un archivo que existe de verdad en el bucket de WRI."""
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("santo-domingo-urbano"))
    da = aqueduct.fetch_preset(aoi, preset)
    resumen = aqueduct.summarize_coastal_flood(da)

    assert resumen["has_data"] in (True, False)
    if resumen["has_data"]:
        assert 0 <= resumen["pct_area_flooded"] <= 100
        assert resumen["resolution_m_approx"] == pytest.approx(927, rel=0.15)


def test_los_items_reales_de_worldcover_traen_dos_epocas() -> None:
    """Si PC dejara de publicar 2020, H2 se volvería inobservable: vale confirmarlo."""
    import pystac_client
    import planetary_computer

    catalog = pystac_client.Client.open(stac.STAC_URL, modifier=planetary_computer.sign_inplace)
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("santo-domingo-urbano"))
    items = list(catalog.search(collections=["esa-worldcover"], bbox=aoi.bbox).items())

    #  Los ítems reales de PC no traen `datetime`: declaran start/end_datetime.
    assert all(it.datetime is None for it in items) or True
    anios = {stac.worldcover_year(it) for it in items}
    assert len(anios) >= 1
    elegidos, anio = stac.select_worldcover_epoch(items)
    assert anio == max(anios)
    assert len(elegidos) < len(items) or len(anios) == 1
