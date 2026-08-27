"""Hidrología vía Overpass API (OpenStreetMap) — sin registro."""

from __future__ import annotations

from dataclasses import dataclass

import requests
from shapely.geometry import LineString, Point, Polygon
from shapely.geometry.base import BaseGeometry

from territorio_base.aoi import AOI

# El mirror principal (overpass-api.de) se satura seguido y devuelve 504/timeout
# en horas pico. Los otros dos son frontends alternativos del mismo cluster/
# datos (mismo timestamp_osm_base que el principal al verificarlo) — no son
# mirrors de datos regionales/desactualizados como otros mirrors públicos
# (ej. overpass.osm.ch, que respondía rápido pero con 0 resultados para todo
# el Caribe: parece ser un extracto regional, no una réplica global), así que
# no hay riesgo de "responde rápido pero con datos incompletos".
OVERPASS_URLS = [
    "https://overpass-api.de/api/interpreter",
    "https://z.overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
]

_QUERY = """
[out:json][timeout:60];
(
  way["waterway"]({south},{west},{north},{east});
  way["natural"="water"]({south},{west},{north},{east});
  relation["natural"="water"]({south},{west},{north},{east});
  way["natural"="wetland"]({south},{west},{north},{east});
);
out body geom;
"""


def _query_overpass(query: str) -> dict:
    last_exc: Exception | None = None
    for url in OVERPASS_URLS:
        try:
            resp = requests.post(
                url,
                data={"data": query},
                headers={"User-Agent": "territorio-base/0.1 (analisis territorial preliminar)"},
                timeout=45,
            )
            resp.raise_for_status()
            return resp.json()
        except requests.RequestException as exc:
            last_exc = exc
            continue
    assert last_exc is not None
    raise last_exc


@dataclass
class HydrologyFeature:
    osm_id: int
    kind: str  # "waterway" | "water_body" | "wetland"
    name: str | None
    geometry: BaseGeometry


def _geometry_from_element(el: dict) -> BaseGeometry | None:
    geom = el.get("geometry")
    if not geom:
        return None
    coords = [(pt["lon"], pt["lat"]) for pt in geom]
    if len(coords) < 2:
        return Point(coords[0]) if coords else None
    if coords[0] == coords[-1] and len(coords) >= 4:
        return Polygon(coords)
    return LineString(coords)


def fetch_hydrology(aoi: AOI, buffer_m: float = 500) -> list[HydrologyFeature]:
    """Busca cursos/cuerpos de agua de OSM dentro de un buffer alrededor del AOI (por defecto 500m)."""
    search_area = aoi.buffer_wgs84(buffer_m)
    west, south, east, north = search_area.bounds

    data = _query_overpass(_QUERY.format(south=south, west=west, north=north, east=east))
    elements = data.get("elements", [])

    features = []
    for el in elements:
        geometry = _geometry_from_element(el)
        if geometry is None or not geometry.is_valid:
            continue
        tags = el.get("tags", {})
        if "waterway" in tags:
            kind = "waterway"
        elif tags.get("natural") == "wetland":
            kind = "wetland"
        else:
            kind = "water_body"
        features.append(
            HydrologyFeature(
                osm_id=el["id"], kind=kind, name=tags.get("name"), geometry=geometry
            )
        )
    return features


def summarize_hydrology(aoi: AOI, features: list[HydrologyFeature]) -> dict:
    import geopandas as gpd

    aoi_utm = aoi.to_utm()
    if not features:
        return {
            "features_found": 0,
            "intersects_aoi": False,
            "nearest_distance_m": None,
            "features": [],
        }

    gs = gpd.GeoSeries([f.geometry for f in features], crs="EPSG:4326").to_crs(epsg=aoi.utm_epsg)
    distances = gs.distance(aoi_utm)
    intersects = bool((distances == 0).any())

    return {
        "features_found": len(features),
        "intersects_aoi": intersects,
        "nearest_distance_m": float(distances.min()),
        "features": [
            {
                "osm_id": f.osm_id,
                "kind": f.kind,
                "name": f.name,
                "distance_m": float(d),
            }
            for f, d in sorted(zip(features, distances), key=lambda t: t[1])
        ],
    }
