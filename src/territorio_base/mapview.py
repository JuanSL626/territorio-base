"""Arma el mapa interactivo (folium) con las capas de resultados: raster como
ImageOverlay (con opacidad ajustable) y vectores (hidrología, áreas
protegidas, AOI) como GeoJson, más leyendas para las capas clasificadas.
"""

from __future__ import annotations

import base64
import io

import folium
import matplotlib.pyplot as plt
import numpy as np
import rioxarray  # noqa: F401  (registra el accessor .rio)
import xarray as xr

from territorio_base.aoi import AOI
from territorio_base.analysis.vegetation import NDVI_DENSITY_CLASSES, NDVI_DENSITY_COLORS
from territorio_base.sources.stac import WORLDCOVER_CLASSES

# Paleta oficial (aprox.) de ESA WorldCover.
WORLDCOVER_COLORS = {
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


def reproject_to_wgs84(da: xr.DataArray) -> xr.DataArray:
    return da.rio.reproject("EPSG:4326")


def _bounds_latlon(da: xr.DataArray) -> list[list[float]]:
    west, south, east, north = da.rio.bounds()
    return [[south, west], [north, east]]


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return tuple(int(hex_color[i : i + 2], 16) for i in (0, 2, 4))


def _continuous_to_rgba(arr: np.ndarray, cmap: str, vmin: float, vmax: float) -> np.ndarray:
    norm = plt.Normalize(vmin=vmin, vmax=vmax)
    rgba = plt.get_cmap(cmap)(norm(arr))
    rgba[..., 3] = np.where(np.isnan(arr), 0.0, 1.0)
    return rgba


def _categorical_to_rgba(arr: np.ndarray, color_by_code: dict) -> np.ndarray:
    h, w = arr.shape
    rgba = np.zeros((h, w, 4), dtype="float64")
    for code, hex_color in color_by_code.items():
        mask = arr == code
        if not mask.any():
            continue
        r, g, b = _hex_to_rgb(hex_color)
        rgba[mask] = [r / 255, g / 255, b / 255, 1.0]
    return rgba


def _rgba_to_data_uri(rgba: np.ndarray) -> str:
    # Los rasters ya vienen con fila 0 = norte (y descendente), que es lo que
    # espera un PNG (fila 0 = arriba) para calzar con bounds=[[south,west],[north,east]].
    # OJO: no voltear con flipud, o el mapa queda desfasado/espejado norte-sur.
    buf = io.BytesIO()
    plt.imsave(buf, rgba, format="png")
    return "data:image/png;base64," + base64.b64encode(buf.getvalue()).decode()


def continuous_overlay(da: xr.DataArray, cmap: str, vmin: float, vmax: float) -> tuple[str, list]:
    da_wgs84 = reproject_to_wgs84(da)
    rgba = _continuous_to_rgba(da_wgs84.values.astype("float64"), cmap, vmin, vmax)
    return _rgba_to_data_uri(rgba), _bounds_latlon(da_wgs84)


def categorical_overlay(da: xr.DataArray, color_by_code: dict) -> tuple[str, list]:
    da_wgs84 = reproject_to_wgs84(da)
    arr = da_wgs84.values
    rgba = _categorical_to_rgba(arr, color_by_code)
    # 0 / NaN / códigos sin color asignado -> transparente (nodata o fuera del AOI)
    valid = np.isin(arr, list(color_by_code.keys()))
    rgba[..., 3] = np.where(valid, rgba[..., 3], 0.0)
    return _rgba_to_data_uri(rgba), _bounds_latlon(da_wgs84)


def add_image_layer(m: folium.Map, data_uri: str, bounds: list, name: str, opacity: float) -> None:
    folium.raster_layers.ImageOverlay(
        image=data_uri,
        bounds=bounds,
        opacity=opacity,
        name=name,
        interactive=False,
        cross_origin=False,
    ).add_to(m)


def add_legend(m: folium.Map, title: str, items: list[tuple[str, str]], position_offset_px: int = 0) -> None:
    """items: lista de (color_hex, etiqueta). position_offset_px separa leyendas apiladas."""
    rows = "".join(
        f'<div style="display:flex;align-items:center;margin:2px 0;">'
        f'<span style="width:14px;height:14px;background:{color};display:inline-block;'
        f'margin-right:6px;border:1px solid #0003;"></span>'
        f'<span style="font-size:12px;">{label}</span></div>'
        for color, label in items
    )
    html = f"""
    <div style="
        position: fixed;
        bottom: {30 + position_offset_px}px;
        left: 30px;
        z-index: 9999;
        background: white;
        padding: 8px 10px;
        border-radius: 6px;
        box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        font-family: sans-serif;
        max-width: 240px;
    ">
        <div style="font-size:12px;font-weight:600;margin-bottom:4px;">{title}</div>
        {rows}
    </div>
    """
    m.get_root().html.add_child(folium.Element(html))


def ndvi_density_legend_items() -> list[tuple[str, str]]:
    return [(color, label) for color, (_, _, label) in zip(NDVI_DENSITY_COLORS, NDVI_DENSITY_CLASSES)]


def worldcover_legend_items(present_codes: set[int]) -> list[tuple[str, str]]:
    return [
        (WORLDCOVER_COLORS[code], WORLDCOVER_CLASSES[code])
        for code in WORLDCOVER_COLORS
        if code in present_codes
    ]


def build_base_map(aoi: AOI) -> folium.Map:
    minx, miny, maxx, maxy = aoi.bbox
    center = [(miny + maxy) / 2, (minx + maxx) / 2]
    m = folium.Map(location=center, zoom_start=15, tiles="OpenStreetMap")
    folium.GeoJson(
        aoi.geometry_wgs84.__geo_interface__,
        name="Límite del AOI",
        style_function=lambda _: {"color": "#3388ff", "weight": 2, "fillOpacity": 0},
    ).add_to(m)
    m.fit_bounds([[miny, minx], [maxy, maxx]])
    return m


def add_hydrology_layer(m: folium.Map, features: list, opacity: float) -> None:
    color_by_kind = {"waterway": "#1f78b4", "water_body": "#08519c", "wetland": "#41b6c4"}
    for f in features:
        folium.GeoJson(
            f.geometry.__geo_interface__,
            style_function=lambda _, k=f.kind: {
                "color": color_by_kind.get(k, "#1f78b4"),
                "weight": 3,
                "fillOpacity": opacity,
                "opacity": opacity,
            },
            tooltip=f.name or f.kind,
        ).add_to(m)


def add_protected_areas_layer(m: folium.Map, gdf, opacity: float) -> None:
    if gdf.empty:
        return
    folium.GeoJson(
        gdf.__geo_interface__,
        style_function=lambda _: {
            "color": "#d95f02",
            "weight": 2,
            "fillColor": "#d95f02",
            "fillOpacity": opacity * 0.5,
            "opacity": opacity,
        },
        tooltip=folium.GeoJsonTooltip(fields=[c for c in ["name", "desig"] if c in gdf.columns]),
    ).add_to(m)
