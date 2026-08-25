"""Áreas protegidas (WDPA) vía el ArcGIS FeatureServer público de UNEP-WCMC — sin token.

Es la misma base de datos que expone Protected Planet, pero este servicio
permite consultas espaciales directas (intersección con un polígono) sin
necesidad de registrarse por un API token.
"""

from __future__ import annotations

import geopandas as gpd
import requests
from shapely.geometry import shape

from territorio_base.aoi import AOI

_QUERY_URL = (
    "https://data-gis.unep-wcmc.org/arcgis/rest/services/ProtectedSites/"
    "The_World_Database_of_Protected_Areas/FeatureServer/1/query"
)


def fetch_protected_areas(aoi: AOI, buffer_m: float = 1000) -> gpd.GeoDataFrame:
    """Áreas WDPA que intersectan un buffer alrededor del AOI (por defecto 1 km)."""
    search_area = aoi.buffer_wgs84(buffer_m)
    rings = [list(search_area.exterior.coords)]

    params = {
        "geometry": {"rings": rings, "spatialReference": {"wkid": 4326}},
        "geometryType": "esriGeometryPolygon",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "name,desig,desig_eng,iucn_cat,status,mang_auth",
        "returnGeometry": "true",
        "outSR": 4326,
        "f": "geojson",
    }
    resp = requests.post(_QUERY_URL, data={k: (v if isinstance(v, str) else __import__("json").dumps(v)) for k, v in params.items()}, timeout=60)
    resp.raise_for_status()
    fc = resp.json()

    if not fc.get("features"):
        return gpd.GeoDataFrame(columns=["name", "desig", "iucn_cat", "status", "geometry"], geometry="geometry", crs="EPSG:4326")

    return gpd.GeoDataFrame.from_features(fc, crs="EPSG:4326")


def summarize_protected_areas(aoi: AOI, gdf: gpd.GeoDataFrame) -> dict:
    aoi_utm = aoi.to_utm()
    aoi_area_ha = aoi_utm.area / 10_000

    if gdf.empty:
        return {
            "areas_found": 0,
            "intersects_aoi": False,
            "overlap_ha": 0.0,
            "overlap_pct_of_aoi": 0.0,
            "nearest_distance_m": None,
            "areas": [],
        }

    gdf_utm = gdf.to_crs(epsg=aoi.utm_epsg)
    distances = gdf_utm.geometry.distance(aoi_utm)
    intersections = gdf_utm.geometry.intersection(aoi_utm)
    overlap_ha = float(intersections.area.sum() / 10_000)

    areas = [
        {
            "name": row.get("name"),
            "desig": row.get("desig_eng") or row.get("desig"),
            "iucn_cat": row.get("iucn_cat"),
            "status": row.get("status"),
            "distance_m": float(dist),
            "overlap_ha": float(inter.area / 10_000),
        }
        for row, dist, inter in sorted(
            zip(gdf.to_dict("records"), distances, intersections), key=lambda t: t[1]
        )
    ]

    return {
        "areas_found": len(gdf),
        "intersects_aoi": bool((distances == 0).any()),
        "overlap_ha": overlap_ha,
        "overlap_pct_of_aoi": (overlap_ha / aoi_area_ha * 100) if aoi_area_ha else 0.0,
        "nearest_distance_m": float(distances.min()),
        "areas": areas,
    }
