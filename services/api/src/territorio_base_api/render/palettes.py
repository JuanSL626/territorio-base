"""Paletas y especificación de render por capa raster.

Los hex de WorldCover y de densidad NDVI son los mismos que usaba el mapa folium
legacy (`mapview.py`), y están además tabulados en
`docs/migration/00-legacy-inventory.md` §4. Cambiarlos rompe la paridad visual con
los reportes ya emitidos.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from territorio_base_api.analysis.vegetation import NDVI_DENSITY_CLASSES, NDVI_DENSITY_COLORS
from territorio_base_api.sources.stac import WORLDCOVER_CLASSES

# Paleta oficial (aprox.) de ESA WorldCover.
WORLDCOVER_COLORS: dict[int, str] = {
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

NDVI_DENSITY_CODES: dict[int, str] = {
    index: label for index, (_lo, _hi, label) in enumerate(NDVI_DENSITY_CLASSES)
}
NDVI_DENSITY_COLORS_BY_CODE: dict[int, str] = dict(enumerate(NDVI_DENSITY_COLORS))

AOI_BOUNDARY_COLOR = "#3388ff"

Kind = Literal["continuous", "categorical"]
Bound = Literal["data_min", "data_max", "p98", "max_or_floor"]


@dataclass(frozen=True)
class RasterSpec:
    """Todo lo que hay que saber de una capa raster para guardarla y pintarla."""

    layer: str
    download_filename: str
    legend_title: str
    kind: Kind
    dtype: str
    nodata: float
    default_opacity: float
    cmap: str | None = None
    vmin: float | Bound = 0.0
    vmax: float | Bound = 1.0
    value_format: str = "{:.1f}"
    #  Solo categóricas:
    colors: dict[int, str] = field(default_factory=dict)
    labels: dict[int, str] = field(default_factory=dict)
    #  Enmascarar valores <= 0 (la mancha de inundación se dibuja solo donde hay agua).
    mask_non_positive: bool = False


RASTER_SPECS: dict[str, RasterSpec] = {
    "dem": RasterSpec(
        layer="dem",
        download_filename="elevacion.tif",
        legend_title="Elevación (m)",
        kind="continuous",
        dtype="float32",
        nodata=float("nan"),
        default_opacity=0.7,
        cmap="terrain",
        # Rango dinámico: min/max reales del AOI (igual que el legacy).
        vmin="data_min",
        vmax="data_max",
        value_format="{:.0f} m",
    ),
    "slope": RasterSpec(
        layer="slope",
        download_filename="pendiente.tif",
        legend_title="Pendiente (%)",
        kind="continuous",
        dtype="float32",
        nodata=float("nan"),
        default_opacity=0.7,
        cmap="YlOrRd",
        vmin=0.0,
        # Percentil 98: recorta outliers de borde para que la rampa siga siendo legible.
        vmax="p98",
        value_format="{:.0f}%",
    ),
    "aspect": RasterSpec(
        layer="aspect",
        download_filename="orientacion.tif",
        legend_title="Orientación (°)",
        kind="continuous",
        dtype="float32",
        nodata=float("nan"),
        default_opacity=0.7,
        cmap="twilight",
        vmin=0.0,
        vmax=360.0,
        value_format="{:.0f}°",
    ),
    "ndvi": RasterSpec(
        layer="ndvi",
        download_filename="ndvi.tif",
        legend_title="NDVI",
        kind="continuous",
        dtype="float32",
        nodata=float("nan"),
        default_opacity=0.7,
        cmap="RdYlGn",
        vmin=-1.0,
        vmax=1.0,
        value_format="{:.1f}",
    ),
    "ndvi_density": RasterSpec(
        layer="ndvi_density",
        download_filename="ndvi_clases.tif",
        legend_title="Densidad de vegetación",
        kind="categorical",
        dtype="uint8",
        nodata=255,
        default_opacity=0.75,
        colors=NDVI_DENSITY_COLORS_BY_CODE,
        labels=NDVI_DENSITY_CODES,
    ),
    "worldcover": RasterSpec(
        layer="worldcover",
        download_filename="worldcover.tif",
        legend_title="Cobertura de suelo (ESA WorldCover)",
        kind="categorical",
        dtype="uint8",
        nodata=0,
        default_opacity=0.7,
        colors=WORLDCOVER_COLORS,
        labels=WORLDCOVER_CLASSES,
    ),
    "coastal": RasterSpec(
        layer="coastal",
        download_filename="inundacion_costera.tif",
        legend_title="Profundidad de inundación (m)",
        kind="continuous",
        dtype="float32",
        nodata=float("nan"),
        default_opacity=0.8,
        cmap="Blues",
        vmin=0.0,
        # `max_or_floor`: max(profundidad máxima, 0.1). El inventario marca que el
        # legacy usaba este piso para el overlay pero el crudo para la leyenda, y
        # divergían con profundidades muy bajas. Acá render y leyenda usan el MISMO
        # valor: una sola fuente de verdad.
        vmax="max_or_floor",
        value_format="{:.1f} m",
        mask_non_positive=True,
    ),
}

OVERLAY_LAYERS = tuple(RASTER_SPECS)
