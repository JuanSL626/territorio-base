"""Inundación costera (profundidad, en metros) vía WRI Aqueduct Floods v2.

Fuente abierta (CC-BY, sin registro): Ward, P.J. et al. 2020, "Aqueduct
Floods Methodology" — https://www.wri.org/data/aqueduct-floods-hazard-maps
Los GeoTIFFs (globales) se leen directo por HTTP con lectura por ventana
(vsicurl), sin descargar el archivo completo (~45 MB c/u).

Limitaciones a tener en cuenta (documentadas también en la UI):
- Resolución ~927 m (30 arco-segundos) — grosera para polígonos de pocas
  hectáreas; sirve como screening, no como diseño de detalle.
- Proyecciones hasta el año 2080 (no llega a horizontes tipo 2150).
- Metodología de 2020 basada en RCPs (no en los SSP más recientes de IPCC AR6).
- No corrige el sesgo de dosel en el DEM subyacente en zonas boscosas.
"""

from __future__ import annotations

import numpy as np
import rioxarray
import xarray as xr

from territorio_base_api.aoi import AOI

BASE_URL = "https://aqueduct.wridata.org/AqueductFloods20"

RETURN_PERIODS = [1.5, 2, 5, 10, 25, 50, 100, 250, 500, 1000]

PRESETS = {
    "Hoy (histórico) — 100 años de retorno": dict(
        scenario="historical", subsidence="wtsub", year="hist", return_period=100, percentile=95
    ),
    "2050 · RCP4.5 (optimista) — 100 años": dict(
        scenario="rcp4p5", subsidence="wtsub", year="2050", return_period=100, percentile=95
    ),
    "2050 · RCP8.5 (pesimista) — 100 años": dict(
        scenario="rcp8p5", subsidence="wtsub", year="2050", return_period=100, percentile=95
    ),
    "2080 · RCP8.5 (pesimista) — 100 años": dict(
        scenario="rcp8p5", subsidence="wtsub", year="2080", return_period=100, percentile=95
    ),
    "2080 · RCP8.5 (pesimista) — 1000 años (extremo)": dict(
        scenario="rcp8p5", subsidence="wtsub", year="2080", return_period=1000, percentile=95
    ),
}


def _format_return_period(rp: float) -> str:
    whole = int(rp)
    frac = round((rp - whole) * 10)
    return f"{whole:04d}_{frac}"


def build_filename(scenario: str, subsidence: str, year: str, return_period: float, percentile: int = 95) -> str:
    rp_str = _format_return_period(return_period)
    if scenario == "historical":
        return f"inuncoast_historical_{subsidence}_hist_rp{rp_str}.tif"
    name = f"inuncoast_{scenario}_{subsidence}_{year}_rp{rp_str}"
    if percentile == 50:
        name += "_perc_50"
    elif percentile == 5:
        name += "_perc_05"
    return name + ".tif"


def fetch_coastal_flood_depth(
    aoi: AOI,
    scenario: str = "historical",
    subsidence: str = "wtsub",
    year: str = "hist",
    return_period: float = 100,
    percentile: int = 95,
    buffer_deg: float = 0.02,
) -> xr.DataArray:
    """Profundidad de inundación costera (m) recortada al AOI + un buffer (para dar contexto,
    dada la resolución gruesa del dataset)."""
    filename = build_filename(scenario, subsidence, year, return_period, percentile)
    url = f"/vsicurl/{BASE_URL}/{filename}"
    da = rioxarray.open_rasterio(url, masked=True)
    if "band" in da.dims:
        da = da.squeeze("band", drop=True)

    minx, miny, maxx, maxy = aoi.bbox
    clipped = da.rio.clip_box(
        minx - buffer_deg, miny - buffer_deg, maxx + buffer_deg, maxy + buffer_deg
    ).load()
    # 0 = seco (dato válido, no inundado). Se deja tal cual; quien consuma esto
    # decide si lo enmascara para visualizar solo la mancha de inundación.
    return clipped


def summarize_coastal_flood(depth: xr.DataArray) -> dict:
    vals = depth.values
    valid = vals[~np.isnan(vals)]
    if valid.size == 0:
        return {"has_data": False}

    flooded = valid[valid > 0]
    res_deg = abs(float(depth.rio.resolution()[0]))
    return {
        "has_data": True,
        "resolution_m_approx": res_deg * 111_000,
        "pct_area_flooded": float((valid > 0).sum() / valid.size * 100),
        "max_depth_m": float(valid.max()),
        "mean_depth_where_flooded_m": float(flooded.mean()) if flooded.size else 0.0,
    }


PRESET_KEYS = tuple(PRESETS.keys())


def resolve_preset(preset: str) -> dict:
    """Traduce una de las 5 claves exactas del inventario a los parámetros del dataset."""
    try:
        return dict(PRESETS[preset])
    except KeyError:
        raise ValueError(
            "Escenario de inundación costera desconocido: "
            f"{preset!r}. Opciones válidas: {list(PRESET_KEYS)}"
        ) from None


def fetch_preset(aoi: AOI, preset: str, buffer_deg: float = 0.02) -> xr.DataArray:
    params = resolve_preset(preset)
    da = fetch_coastal_flood_depth(aoi, buffer_deg=buffer_deg, **params)
    da.attrs["source"] = "WRI Aqueduct Floods v2 (Ward et al., 2020) — CC-BY"
    da.attrs["preset"] = preset
    da.attrs["filename"] = build_filename(**params)
    return da
