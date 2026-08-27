"""Carga y normalización del área de interés (AOI).

El servicio de Python es **solo raster**: acá el AOI llega ya como GeoJSON desde
TypeScript (que es quien parsea KML/KMZ/GeoJSON subidos por el usuario). Por eso
este módulo ya no depende de geopandas/pyogrio — le alcanza shapely + pyproj, que
son dependencias que rasterio/rioxarray ya arrastran.
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from functools import cached_property

from pyproj import Transformer
from shapely.geometry import mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform
from shapely.ops import unary_union

log = logging.getLogger(__name__)


@dataclass(frozen=True)
class AOI:
    """AOI normalizada: geometría en WGS84 + su CRS proyectado (UTM) para métricas de área."""

    geometry_wgs84: BaseGeometry
    utm_epsg: int

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        return tuple(float(v) for v in self.geometry_wgs84.bounds)  # type: ignore[return-value]

    @cached_property
    def _to_utm(self) -> Transformer:
        return Transformer.from_crs("EPSG:4326", f"EPSG:{self.utm_epsg}", always_xy=True)

    @cached_property
    def _to_wgs84(self) -> Transformer:
        return Transformer.from_crs(f"EPSG:{self.utm_epsg}", "EPSG:4326", always_xy=True)

    def to_utm(self) -> BaseGeometry:
        return shapely_transform(self._to_utm.transform, self.geometry_wgs84)

    @property
    def area_ha(self) -> float:
        return float(self.to_utm().area) / 10_000

    def buffer_wgs84(self, meters: float) -> BaseGeometry:
        """Buffer en metros, hecho en UTM y devuelto en WGS84."""
        buffered = self.to_utm().buffer(meters)
        return shapely_transform(self._to_wgs84.transform, buffered)

    def to_geojson(self) -> dict:
        return mapping(self.geometry_wgs84)

    def canonical_json(self) -> str:
        """Serialización estable, para usar como clave de caché."""
        return json.dumps(self.to_geojson(), sort_keys=True, separators=(",", ":"))


def utm_epsg_for(lon: float, lat: float) -> int:
    zone = int((lon + 180) / 6) + 1
    return (32600 if lat >= 0 else 32700) + zone


def _pick_utm_epsg(geometry: BaseGeometry) -> int:
    """Zona UTM a partir de un punto GARANTIZADO dentro de la geometría.

    H16 del critique: el legacy usaba `geometry.centroid`, que para un MultiPolygon
    (o un polígono en forma de C) puede caer **fuera de todas las partes**. En RD,
    con AOIs cerca de 72°W —el límite entre las zonas UTM 18N y 19N— eso elige la
    zona equivocada y desplaza todas las métricas de área/distancia. `representative_point()`
    siempre devuelve un punto sobre la geometría.
    """
    point = geometry.representative_point()
    epsg = utm_epsg_for(point.x, point.y)

    minx, _, maxx, _ = geometry.bounds
    if utm_epsg_for(minx, point.y) != utm_epsg_for(maxx, point.y):
        log.warning(
            "El AOI cruza un límite de zona UTM (lon %.4f..%.4f); se usa EPSG:%d para todo el AOI.",
            minx,
            maxx,
            epsg,
        )
    return epsg


def load_aoi_from_geojson_dict(geojson: dict) -> AOI:
    """Acepta un Feature, FeatureCollection o Geometry dict."""
    if not isinstance(geojson, dict) or "type" not in geojson:
        raise ValueError("El AOI debe ser un objeto GeoJSON con la clave 'type'.")

    kind = geojson.get("type")
    if kind == "FeatureCollection":
        features = geojson.get("features") or []
        geoms = [shape(f["geometry"]) for f in features if f.get("geometry")]
        if not geoms:
            raise ValueError("El FeatureCollection no tiene ninguna geometría.")
        geometry = geoms[0] if len(geoms) == 1 else unary_union(geoms)
    elif kind == "Feature":
        if not geojson.get("geometry"):
            raise ValueError("El Feature no tiene geometría.")
        geometry = shape(geojson["geometry"])
    else:
        geometry = shape(geojson)

    if geometry.is_empty:
        raise ValueError("La geometría del AOI está vacía.")
    if geometry.geom_type not in ("Polygon", "MultiPolygon"):
        raise ValueError(
            f"El AOI tiene que ser un polígono; se recibió {geometry.geom_type}."
        )
    if not geometry.is_valid:
        # buffer(0) es el saneado estándar de shapely para auto-intersecciones.
        geometry = geometry.buffer(0)
        if geometry.is_empty or not geometry.is_valid:
            raise ValueError("La geometría del AOI es inválida y no se pudo sanear.")

    return AOI(geometry_wgs84=geometry, utm_epsg=_pick_utm_epsg(geometry))
