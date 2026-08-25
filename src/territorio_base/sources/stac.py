"""Acceso a datos abiertos vía STAC de Microsoft Planetary Computer (sin registro).

Fuentes usadas:
- cop-dem-glo-30: Copernicus DEM (elevación, ~30m)
- sentinel-2-l2a: Sentinel-2 nivel 2A (reflectancia de superficie, 10m) -> NDVI
- esa-worldcover: ESA WorldCover 2021 (cobertura de suelo, 10m, incluye clase "Tree cover")
"""

from __future__ import annotations

import odc.stac
import planetary_computer
import pystac_client
import rioxarray  # noqa: F401  (registra el accessor .rio en xarray)
import xarray as xr

from territorio_base.aoi import AOI

STAC_URL = "https://planetarycomputer.microsoft.com/api/stac/v1"

WORLDCOVER_CLASSES = {
    10: "Bosque / cobertura arbórea",
    20: "Matorral (shrubland)",
    30: "Pastizal",
    40: "Cultivos",
    50: "Área construida",
    60: "Suelo desnudo / disperso",
    70: "Nieve/hielo",
    80: "Cuerpo de agua permanente",
    90: "Humedal herbáceo",
    95: "Manglar",
    100: "Musgo y liquen",
}

TREE_COVER_CLASS = 10


def _client() -> pystac_client.Client:
    return pystac_client.Client.open(STAC_URL, modifier=planetary_computer.sign_inplace)


def fetch_dem(aoi: AOI, resolution_m: int = 30) -> xr.DataArray:
    catalog = _client()
    search = catalog.search(collections=["cop-dem-glo-30"], bbox=aoi.bbox)
    items = list(search.items())
    if not items:
        raise RuntimeError("No se encontró cobertura de Copernicus DEM para esta zona.")

    ds = odc.stac.load(
        items,
        bands=["data"],
        bbox=aoi.bbox,
        crs=f"EPSG:{aoi.utm_epsg}",
        resolution=resolution_m,
    )
    dem = ds["data"].isel(time=0) if "time" in ds["data"].dims else ds["data"]
    return dem.rio.write_crs(f"EPSG:{aoi.utm_epsg}").rio.clip(
        [aoi.to_utm()], from_disk=True, drop=True
    )


def fetch_sentinel2_ndvi(
    aoi: AOI, resolution_m: int = 10, max_cloud_cover: int = 30, lookback_days: int = 180
) -> xr.DataArray:
    """Compone una mediana de las escenas menos nubladas de los últimos `lookback_days` y calcula NDVI."""
    import datetime

    catalog = _client()
    end = datetime.date.today()
    start = end - datetime.timedelta(days=lookback_days)
    search = catalog.search(
        collections=["sentinel-2-l2a"],
        bbox=aoi.bbox,
        datetime=f"{start.isoformat()}/{end.isoformat()}",
        query={"eo:cloud_cover": {"lt": max_cloud_cover}},
    )
    items = list(search.items())
    if not items:
        raise RuntimeError(
            "No se encontraron escenas Sentinel-2 con poca nubosidad en el rango de fechas. "
            "Prueba subiendo max_cloud_cover o lookback_days."
        )
    items = sorted(items, key=lambda it: it.properties.get("eo:cloud_cover", 100))[:6]

    ds = odc.stac.load(
        items,
        bands=["B04", "B08", "SCL"],
        bbox=aoi.bbox,
        crs=f"EPSG:{aoi.utm_epsg}",
        resolution=resolution_m,
        chunks={},
    )

    # SCL: máscara de nubes/sombras del propio Sentinel-2 (Scene Classification Layer).
    # Clases válidas: 4 (vegetación), 5 (suelo desnudo), 6 (agua), 7 (nubes baja prob.), 11 (nieve)
    valid = ds["SCL"].isin([4, 5, 6, 7, 11])
    red = ds["B04"].where(valid).astype("float32")
    nir = ds["B08"].where(valid).astype("float32")

    ndvi = (nir - red) / (nir + red)
    ndvi_median = ndvi.median(dim="time", skipna=True)
    ndvi_median = ndvi_median.rio.write_crs(f"EPSG:{aoi.utm_epsg}")
    return ndvi_median.rio.clip([aoi.to_utm()], from_disk=True, drop=True)


def fetch_worldcover(aoi: AOI, resolution_m: int = 10) -> xr.DataArray:
    catalog = _client()
    search = catalog.search(collections=["esa-worldcover"], bbox=aoi.bbox)
    items = list(search.items())
    if not items:
        raise RuntimeError("No se encontró cobertura de ESA WorldCover para esta zona.")

    ds = odc.stac.load(
        items,
        bands=["map"],
        bbox=aoi.bbox,
        crs=f"EPSG:{aoi.utm_epsg}",
        resolution=resolution_m,
    )
    worldcover = ds["map"]
    if "time" in worldcover.dims:
        worldcover = worldcover.max(dim="time")
    worldcover = worldcover.rio.write_crs(f"EPSG:{aoi.utm_epsg}")
    return worldcover.rio.clip([aoi.to_utm()], from_disk=True, drop=True)
