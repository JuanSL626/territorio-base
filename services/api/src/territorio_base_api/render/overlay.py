"""Raster -> PNG con transparencia + bounds WGS84, para `map.addSource({type:'image'})`.

=============================================================================
REGRESIÓN #1 DEL INVENTARIO — ORIENTACIÓN NORTE-SUR. NO BORRAR ESTE COMENTARIO.
=============================================================================
El bug histórico fue aplicar `np.flipud` a arrays que YA venían con la fila 0 =
norte. Un PNG tiene la fila 0 arriba, y unos bounds `[west, south, east, north]`
ponen `north` arriba: si el array ya es north-up, voltear lo espeja.

Este módulo **no voltea a ciegas en ninguna dirección**. Verifica la orientación
real contra la convención de bounds mirando el signo del eje `y` (que es la única
fuente de verdad: rioxarray guarda las coordenadas, no una suposición) y solo
invierte si el array llegara con la fila 0 = sur. Cualquier pipeline nuevo que
reemplace este módulo tiene que hacer la misma verificación explícita — es trivial
reintroducir el espejado con otra librería.
Test que lo fija: `tests/test_overlay_orientation.py`.
"""

from __future__ import annotations

import io
from dataclasses import dataclass

import numpy as np
import rioxarray  # noqa: F401  (registra el accessor .rio)
import xarray as xr
from matplotlib import colormaps
from matplotlib.colors import Normalize
from PIL import Image

from territorio_base_api.render.palettes import RasterSpec

LEGEND_RAMP_STEPS = 5


@dataclass(frozen=True)
class Overlay:
    png: bytes
    #  (west, south, east, north) en EPSG:4326 — la convención de bounds de MapLibre.
    bounds: tuple[float, float, float, float]
    width: int
    height: int
    vmin: float | None
    vmax: float | None
    legend: list[dict]

    @property
    def coordinates(self) -> list[list[float]]:
        """Las 4 esquinas que pide `ImageSource`: TL, TR, BR, BL."""
        west, south, east, north = self.bounds
        return [[west, north], [east, north], [east, south], [west, south]]


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    hex_color = hex_color.lstrip("#")
    return (
        int(hex_color[0:2], 16),
        int(hex_color[2:4], 16),
        int(hex_color[4:6], 16),
    )


def to_wgs84(da: xr.DataArray) -> xr.DataArray:
    if da.rio.crs is None:
        raise ValueError("El raster no tiene CRS; no se puede reproyectar a WGS84.")
    if da.rio.crs.to_epsg() == 4326:
        return da
    return da.rio.reproject("EPSG:4326")


def ensure_north_up(da: xr.DataArray) -> xr.DataArray:
    """Garantiza fila 0 = norte. Ver el bloque de arriba (regresión #1)."""
    y_dim = da.rio.y_dim
    y = np.asarray(da[y_dim].values)
    if y.size >= 2 and float(y[0]) < float(y[-1]):
        # Fila 0 = sur: ESTE es el único caso donde voltear es correcto.
        return da.isel({y_dim: slice(None, None, -1)})
    return da


def _values(da: xr.DataArray) -> np.ndarray:
    arr = np.asarray(da.values)
    if arr.ndim == 3 and arr.shape[0] == 1:
        arr = arr[0]
    if arr.ndim != 2:
        raise ValueError(f"Se esperaba un raster 2D; llegó forma {arr.shape}.")
    return arr


def _nodata_mask(arr: np.ndarray, nodata: float) -> np.ndarray:
    """True donde HAY dato."""
    if np.issubdtype(arr.dtype, np.floating):
        valid = np.isfinite(arr)
        if not (isinstance(nodata, float) and np.isnan(nodata)):
            valid &= arr != nodata
        return valid
    return arr != nodata


def resolve_bounds(
    arr: np.ndarray, spec: RasterSpec, vmin: float | None = None, vmax: float | None = None
) -> tuple[float, float]:
    """vmin/vmax efectivos: overrides del query param > regla de la capa."""
    finite = arr[np.isfinite(arr)]
    if finite.size == 0:
        finite = np.array([0.0, 1.0])

    def resolve(value: float | str, fallback: float) -> float:
        if isinstance(value, (int, float)):
            return float(value)
        if value == "data_min":
            return float(np.min(finite))
        if value == "data_max":
            return float(np.max(finite))
        if value == "p98":
            return float(np.percentile(finite, 98))
        if value == "max_or_floor":
            return float(max(np.max(finite), 0.1))
        return fallback

    lo = float(vmin) if vmin is not None else resolve(spec.vmin, 0.0)
    hi = float(vmax) if vmax is not None else resolve(spec.vmax, 1.0)
    if hi <= lo:
        hi = lo + 1e-6
    return lo, hi


def build_legend(
    spec: RasterSpec, arr: np.ndarray, vmin: float, vmax: float, present_codes: set[int]
) -> list[dict]:
    if spec.kind == "categorical":
        # Solo las clases realmente presentes en el AOI (igual que el legacy).
        return [
            {"code": code, "color": spec.colors[code], "label": spec.labels.get(code, str(code))}
            for code in sorted(present_codes)
            if code in spec.colors
        ]

    cmap = colormaps[spec.cmap or "viridis"]
    stops = np.linspace(vmin, vmax, LEGEND_RAMP_STEPS)
    legend = []
    for value in stops:
        rgba = cmap(Normalize(vmin=vmin, vmax=vmax)(value))
        color = "#{:02x}{:02x}{:02x}".format(
            int(round(rgba[0] * 255)), int(round(rgba[1] * 255)), int(round(rgba[2] * 255))
        )
        legend.append({"value": float(value), "color": color, "label": spec.value_format.format(value)})
    return legend


def render_overlay(
    da: xr.DataArray,
    spec: RasterSpec,
    opacity: float = 1.0,
    vmin: float | None = None,
    vmax: float | None = None,
) -> Overlay:
    da = ensure_north_up(to_wgs84(da))
    west, south, east, north = (float(v) for v in da.rio.bounds())
    arr = _values(da)

    valid = _nodata_mask(arr, spec.nodata)
    if spec.mask_non_positive:
        with np.errstate(invalid="ignore"):
            valid &= np.nan_to_num(arr.astype("float64"), nan=0.0) > 0

    height, width = arr.shape
    rgba = np.zeros((height, width, 4), dtype="uint8")
    present_codes: set[int] = set()
    lo = hi = None

    if spec.kind == "categorical":
        # `np.nan_to_num` antes del cast: convertir NaN a int64 es UB y numpy avisa.
        codes = np.nan_to_num(
            np.asarray(arr, dtype="float64"), nan=-1.0, posinf=-1.0, neginf=-1.0
        ).astype("int64")
        for code, hex_color in spec.colors.items():
            hit = valid & (codes == code)
            if not hit.any():
                continue
            present_codes.add(int(code))
            r, g, b = _hex_to_rgb(hex_color)
            rgba[hit] = (r, g, b, 255)
        # Códigos sin color asignado quedan transparentes (nodata o fuera del AOI).
        painted = rgba[..., 3] > 0
        rgba[..., 3] = np.where(painted, 255, 0)
    else:
        floats = arr.astype("float64", copy=False)
        lo, hi = resolve_bounds(np.where(valid, floats, np.nan), spec, vmin, vmax)
        cmap = colormaps[spec.cmap or "viridis"]
        normed = Normalize(vmin=lo, vmax=hi, clip=True)(np.where(valid, floats, lo))
        colored = cmap(np.ma.filled(normed, 0.0))
        rgba[..., :3] = np.clip(np.round(colored[..., :3] * 255), 0, 255).astype("uint8")
        rgba[..., 3] = np.where(valid, 255, 0)

    if opacity < 1.0:
        rgba[..., 3] = (rgba[..., 3].astype("float32") * max(opacity, 0.0)).astype("uint8")

    buf = io.BytesIO()
    Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)

    return Overlay(
        png=buf.getvalue(),
        bounds=(west, south, east, north),
        width=width,
        height=height,
        vmin=lo,
        vmax=hi,
        legend=build_legend(spec, arr.astype("float64", copy=False), lo or 0.0, hi or 1.0, present_codes),
    )
