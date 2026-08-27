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

HYDROLOGY_COLORS = {"waterway": "#1f78b4", "water_body": "#08519c", "wetland": "#41b6c4"}
HYDROLOGY_LABELS = {"waterway": "Curso de agua", "water_body": "Cuerpo de agua", "wetland": "Humedal"}

PROTECTED_AREA_COLOR = "#d95f02"
AOI_BOUNDARY_COLOR = "#3388ff"



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


def legend_height_px(items: list[tuple[str, str]]) -> int:
    """Alto aproximado (px) de una leyenda con esta cantidad de filas, para apilar varias sin superponerse."""
    return 40 + 20 * len(items)


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


def continuous_legend_items(cmap: str, vmin: float, vmax: float, fmt: str = "{:.0f}", n: int = 5) -> list[tuple[str, str]]:
    """Muestrea n valores entre vmin y vmax (de mayor a menor) para armar una leyenda tipo rampa."""
    colormap = plt.get_cmap(cmap)
    values = np.linspace(vmax, vmin, n)
    items = []
    for v in values:
        t = (v - vmin) / (vmax - vmin) if vmax > vmin else 0.0
        r, g, b, _ = colormap(t)
        hex_color = "#%02x%02x%02x" % (int(r * 255), int(g * 255), int(b * 255))
        items.append((hex_color, fmt.format(v)))
    return items


def hydrology_legend_items(features: list) -> list[tuple[str, str]]:
    present = {f.kind for f in features}
    return [(HYDROLOGY_COLORS[kind], HYDROLOGY_LABELS[kind]) for kind in HYDROLOGY_COLORS if kind in present]


def protected_areas_legend_items() -> list[tuple[str, str]]:
    return [(PROTECTED_AREA_COLOR, "Área protegida (WDPA)")]


def aoi_boundary_legend_items() -> list[tuple[str, str]]:
    return [(AOI_BOUNDARY_COLOR, "Límite del AOI")]


def build_base_map(aoi: AOI) -> folium.Map:
    minx, miny, maxx, maxy = aoi.bbox
    center = [(miny + maxy) / 2, (minx + maxx) / 2]
    m = folium.Map(location=center, zoom_start=15, tiles="OpenStreetMap")
    folium.GeoJson(
        aoi.geometry_wgs84.__geo_interface__,
        name="Límite del AOI",
        style_function=lambda _: {"color": AOI_BOUNDARY_COLOR, "weight": 2, "fillOpacity": 0},
    ).add_to(m)
    m.fit_bounds([[miny, minx], [maxy, maxx]])
    return m


def add_hydrology_layer(m: folium.Map, features: list, opacity: float) -> None:
    for f in features:
        folium.GeoJson(
            f.geometry.__geo_interface__,
            style_function=lambda _, k=f.kind: {
                "color": HYDROLOGY_COLORS.get(k, "#1f78b4"),
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
            "color": PROTECTED_AREA_COLOR,
            "weight": 2,
            "fillColor": PROTECTED_AREA_COLOR,
            "fillOpacity": opacity * 0.5,
            "opacity": opacity,
        },
        tooltip=folium.GeoJsonTooltip(fields=[c for c in ["name", "desig"] if c in gdf.columns]),
    ).add_to(m)


# Paleta cualitativa (ColorBrewer Set3/Paired combinadas) para distinguir
# capas individuales dentro de un mismo grupo — se recicla por grupo, ya que
# lo que importa es distinguir entre capas de un mismo grupo activo, no que
# el color sea único en las ~35 capas del catálogo entero.
MEPYD_LAYER_PALETTE = [
    "#e41a1c", "#377eb8", "#4daf4a", "#984ea3", "#ff7f00",
    "#a65628", "#f781bf", "#999999", "#66c2a5", "#fc8d62",
    "#8da0cb", "#e78ac3",
]


def mepyd_legend_items(group: str, layers: dict) -> list[tuple[str, str]]:
    """Una entrada de leyenda por capa (no por grupo), en el mismo orden/color
    que usa add_mepyd_group_layer para ese grupo."""
    return [
        (MEPYD_LAYER_PALETTE[i % len(MEPYD_LAYER_PALETTE)], label)
        for i, label in enumerate(layers.keys())
    ]


def add_mepyd_group_layer(m: folium.Map, group: str, layers: dict, opacity: float) -> None:
    """layers: dict[etiqueta, GeoDataFrame] de un grupo del catálogo MEPyD.
    Cada capa del grupo se pinta con un color distinto (mepyd_legend_items
    genera la leyenda a juego) para poder distinguir, por ejemplo, cada
    amenaza dentro del grupo "Amenazas".

    Las capas de puntos (salud, escuelas, albergues, subestaciones...) se
    dibujan como círculos chicos en vez del pin por defecto de Leaflet: con
    el pin, capas de miles de puntos (ej. "Infraestructura de salud", ~1600
    en un AOI mediano) tapaban el mapa entero y no respetaban el color de
    la capa (folium solo aplica style_function a líneas/polígonos, no a
    markers)."""
    for i, (label, gdf) in enumerate(layers.items()):
        if gdf.empty:
            continue
        color = MEPYD_LAYER_PALETTE[i % len(MEPYD_LAYER_PALETTE)]
        name_field = next(
            (c for c in ("MUN_NOM", "NOMBRE", "nombre", "name") if c in gdf.columns), None
        )
        is_point = gdf.geometry.geom_type.isin(["Point", "MultiPoint"]).any()
        folium.GeoJson(
            gdf.__geo_interface__,
            name=f"{group} — {label}",
            marker=folium.CircleMarker(
                radius=4, color=color, weight=1, fill=True, fill_color=color, fill_opacity=opacity
            )
            if is_point
            else None,
            style_function=lambda _, c=color: {
                "color": c,
                "weight": 2,
                "fillColor": c,
                "fillOpacity": opacity * 0.4,
                "opacity": opacity,
            },
            tooltip=folium.GeoJsonTooltip(fields=[name_field]) if name_field else folium.Tooltip(label),
        ).add_to(m)
