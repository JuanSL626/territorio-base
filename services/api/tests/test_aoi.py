"""AOI: área, zona UTM, validación y el hazard H16 (centroide fuera de la geometría)."""

from __future__ import annotations

import pytest
from shapely.geometry import shape

from conftest import AOI_NAMES, load_aoi_geojson
from territorio_base_api.aoi import load_aoi_from_geojson_dict, utm_epsg_for


@pytest.mark.parametrize("name", AOI_NAMES)
def test_aoi_geometria_es_deterministica(name: str, expected: dict) -> None:
    """area_ha/bbox/utm_epsg no dependen de ningún servicio: tolerancia 1e-3 ha."""
    exp = expected["aois"][name]["aoi"]
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson(name))

    assert aoi.utm_epsg == exp["utm_epsg"]
    assert aoi.area_ha == pytest.approx(exp["area_ha"], abs=exp["area_ha_tolerance"])
    for got, want in zip(aoi.bbox, exp["bbox"]):
        assert got == pytest.approx(want, abs=1e-9)


def test_multipolygon_con_hueco_el_centroide_cae_afuera() -> None:
    """H16: el centroide de un MultiPolygon puede caer fuera de todas sus partes.

    Ese es el bug latente que el legacy tenía al elegir la zona UTM con
    `geometry.centroid`. Acá se usa `representative_point()`, que por definición
    está SOBRE la geometría. En este fixture el centroide cae justo en el hueco.
    """
    geom = shape(load_aoi_geojson("multipolygon-con-hueco")["geometry"])

    assert not geom.contains(geom.centroid), "el fixture perdió su propiedad; revisar el hueco"
    assert geom.contains(geom.representative_point())

    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("multipolygon-con-hueco"))
    punto = geom.representative_point()
    assert aoi.utm_epsg == utm_epsg_for(punto.x, punto.y)


def test_cruce_72w_abarca_dos_zonas_utm() -> None:
    """El AOI de 72°O cruza el borde 18N/19N: se elige UNA zona para todo el AOI."""
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("cruce-72w"))
    minx, _, maxx, _ = aoi.bbox

    assert utm_epsg_for(minx, 18.3) == 32618
    assert utm_epsg_for(maxx, 18.3) == 32619
    assert aoi.utm_epsg in (32618, 32619)


def test_area_ha_coincide_con_shapely_en_utm() -> None:
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("santo-domingo-urbano"))
    assert aoi.area_ha == pytest.approx(aoi.to_utm().area / 10_000, rel=1e-12)


def test_buffer_devuelve_wgs84_y_crece() -> None:
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("santo-domingo-urbano"))
    buf = aoi.buffer_wgs84(500)
    assert buf.area > aoi.geometry_wgs84.area
    assert buf.contains(aoi.geometry_wgs84)
    minx, miny, maxx, maxy = buf.bounds
    assert -180 <= minx < maxx <= 180 and -90 <= miny < maxy <= 90


@pytest.mark.parametrize(
    "payload, mensaje",
    [
        ({}, "type"),
        ({"type": "Point", "coordinates": [-69.9, 18.4]}, "polígono"),
        ({"type": "FeatureCollection", "features": []}, "geometría"),
        ({"type": "Feature", "properties": {}}, "geometría"),
    ],
)
def test_geojson_invalido_lanza_valueerror(payload: dict, mensaje: str) -> None:
    with pytest.raises(ValueError, match=mensaje):
        load_aoi_from_geojson_dict(payload)


def test_featurecollection_de_varias_partes_se_une() -> None:
    fc = {
        "type": "FeatureCollection",
        "features": [
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-69.94, 18.47], [-69.93, 18.47], [-69.93, 18.48], [-69.94, 18.48], [-69.94, 18.47]]],
                },
            },
            {
                "type": "Feature",
                "properties": {},
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [[[-69.92, 18.47], [-69.91, 18.47], [-69.91, 18.48], [-69.92, 18.48], [-69.92, 18.47]]],
                },
            },
        ],
    }
    aoi = load_aoi_from_geojson_dict(fc)
    assert aoi.geometry_wgs84.geom_type == "MultiPolygon"
    assert aoi.area_ha > 0


def test_canonical_json_es_estable() -> None:
    aoi = load_aoi_from_geojson_dict(load_aoi_geojson("santo-domingo-urbano"))
    otro = load_aoi_from_geojson_dict(load_aoi_geojson("santo-domingo-urbano"))
    assert aoi.canonical_json() == otro.canonical_json()
