"""Carga y normalización del área de interés (AOI)."""

from __future__ import annotations

import json
from dataclasses import dataclass

import geopandas as gpd
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry


@dataclass
class AOI:
    """AOI ya normalizada: geometría en WGS84 + su CRS proyectado (UTM) para métricas de área."""

    geometry_wgs84: BaseGeometry
    utm_epsg: int

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return self.geometry_wgs84.bounds

    def to_utm(self) -> BaseGeometry:
        gs = gpd.GeoSeries([self.geometry_wgs84], crs="EPSG:4326")
        return gs.to_crs(epsg=self.utm_epsg).iloc[0]

    @property
    def area_ha(self) -> float:
        return self.to_utm().area / 10_000

    def buffer_wgs84(self, meters: float) -> BaseGeometry:
        """Buffer en metros, hecho en UTM y devuelto en WGS84 (para queries de hidrología/áreas protegidas)."""
        gs = gpd.GeoSeries([self.geometry_wgs84], crs="EPSG:4326")
        buffered_utm = gs.to_crs(epsg=self.utm_epsg).buffer(meters)
        return buffered_utm.to_crs(epsg=4326).iloc[0]


def _utm_epsg_for(lon: float, lat: float) -> int:
    zone = int((lon + 180) / 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def load_aoi_from_geojson_dict(geojson: dict) -> AOI:
    """Acepta un Feature, FeatureCollection o Geometry dict (ej. lo que devuelve streamlit-folium Draw)."""
    if geojson.get("type") == "FeatureCollection":
        geoms = [shape(f["geometry"]) for f in geojson["features"]]
        geometry = geoms[0] if len(geoms) == 1 else gpd.GeoSeries(geoms).union_all()
    elif geojson.get("type") == "Feature":
        geometry = shape(geojson["geometry"])
    else:
        geometry = shape(geojson)

    centroid = geometry.centroid
    utm_epsg = _utm_epsg_for(centroid.x, centroid.y)
    return AOI(geometry_wgs84=geometry, utm_epsg=utm_epsg)


def load_aoi_from_file(path: str) -> AOI:
    """Carga KML, KMZ o GeoJSON. Si hay varias geometrías, las une en una sola (el 'polígono ampliado')."""
    gdf = gpd.read_file(path)
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    geometry = gdf.geometry.union_all() if len(gdf) > 1 else gdf.geometry.iloc[0]
    centroid = geometry.centroid
    utm_epsg = _utm_epsg_for(centroid.x, centroid.y)
    return AOI(geometry_wgs84=geometry, utm_epsg=utm_epsg)


def load_aoi_from_bytes(data: bytes, filename: str) -> AOI:
    """Para archivos subidos vía Streamlit (KML/KMZ/GeoJSON), que llegan como bytes en memoria."""
    import io

    suffix = filename.lower().rsplit(".", 1)[-1]
    if suffix in ("geojson", "json"):
        return load_aoi_from_geojson_dict(json.loads(data))

    if suffix == "kmz":
        import zipfile

        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            kml_name = next(n for n in zf.namelist() if n.lower().endswith(".kml"))
            data = zf.read(kml_name)

    gdf = gpd.read_file(io.BytesIO(data), driver="KML")
    if gdf.crs is not None and gdf.crs.to_epsg() != 4326:
        gdf = gdf.to_crs(epsg=4326)
    geometry = gdf.geometry.union_all() if len(gdf) > 1 else gdf.geometry.iloc[0]
    centroid = geometry.centroid
    utm_epsg = _utm_epsg_for(centroid.x, centroid.y)
    return AOI(geometry_wgs84=geometry, utm_epsg=utm_epsg)
