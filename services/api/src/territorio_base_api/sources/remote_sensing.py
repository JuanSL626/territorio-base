"""Adaptadores aislados para el piloto de fuentes gratuitas de teledetección.

El módulo consulta un único ítem reciente por ejecución, normaliza únicamente
metadatos declarados por el proveedor y persiste una ficha saneada. No descarga
rásteres completos ni reemplaza el pipeline Sentinel-2 actual de ``stac.py``.
"""

from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import requests
from pyproj import CRS

from territorio_base_api.analysis.landsat import (
    QA_INVALID_BITS,
    SR_OFFSET,
    SR_SCALE,
    compute_landsat_ndvi,
)
from territorio_base_api.aoi import AOI
from territorio_base_api.models import (
    DerivedProductProvenance,
    LandsatNdviSummary,
    LandsatPilotResult,
    RemoteSensingAsset,
    RemoteSensingBand,
    RemoteSensingPilotResult,
    RemoteSensingScene,
    RemoteSensingSourceInfo,
    RemoteSensingSourceKey,
    RemoteSensingTemporalState,
)

UTC = dt.timezone.utc
ALGORITHM_VERSION = "pilot-v1"
HTTP_TIMEOUT_SECONDS = 25
LANDSAT_ALGORITHM_VERSION = "landsat-c2-l2-ndvi-v1"


class ProviderError(RuntimeError):
    """Error remoto apto para convertir en estado, sin filtrar secretos."""

    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class CredentialsRequired(ProviderError):
    def __init__(self, variables: list[str]):
        super().__init__("Faltan credenciales gratuitas del proveedor.")
        self.variables = variables


class AccessRequired(ProviderError):
    """La cuenta autentica, pero USGS todavía no aprobó el alcance M2M."""


def utc_now() -> dt.datetime:
    return dt.datetime.now(UTC)


def _iso(value: dt.datetime) -> str:
    return value.astimezone(UTC).isoformat().replace("+00:00", "Z")


def _parse_datetime(value: Any) -> dt.datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    raw = value.strip().replace("Z", "+00:00")
    try:
        parsed = dt.datetime.fromisoformat(raw)
    except ValueError:
        try:
            parsed = dt.datetime.combine(dt.date.fromisoformat(raw[:10]), dt.time(), UTC)
        except ValueError:
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def safe_remote_url(value: Any) -> str | None:
    """Elimina query y fragmento para no persistir SAS, OAuth ni API keys."""
    if not isinstance(value, str) or not value.startswith(("https://", "http://")):
        return None
    parts = urlsplit(value)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def _as_float(value: Any) -> float | None:
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _as_int(value: Any) -> int | None:
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def _projection_fields(epsg: int | None) -> tuple[str | None, str | None]:
    if epsg is None:
        return None, None
    try:
        crs = CRS.from_epsg(epsg)
        return crs.name, crs.datum.name if crs.datum else None
    except Exception:  # noqa: BLE001 - EPSG inválido del proveedor no rompe la ficha
        return f"EPSG:{epsg}", None


def _request_json(
    method: str,
    url: str,
    *,
    params: dict[str, Any] | None = None,
    payload: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    try:
        response = requests.request(
            method,
            url,
            params=params,
            json=payload,
            headers=headers,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
        data = response.json()
    except requests.RequestException as exc:
        status_code = exc.response.status_code if exc.response is not None else None
        raise ProviderError(
            f"El proveedor no respondió correctamente: {exc.__class__.__name__}",
            status_code=status_code,
        ) from exc
    except ValueError as exc:
        raise ProviderError("El proveedor devolvió JSON inválido.") from exc
    if not isinstance(data, dict):
        raise ProviderError("Respuesta JSON inesperada del proveedor.")
    return data


def _request_text(url: str, *, timeout_seconds: int = HTTP_TIMEOUT_SECONDS) -> str:
    try:
        response = requests.get(url, timeout=timeout_seconds)
        response.raise_for_status()
        return response.text
    except requests.RequestException as exc:
        raise ProviderError(
            f"El proveedor no respondió correctamente: {exc.__class__.__name__}"
        ) from exc


class RemoteSensingAdapter(ABC):
    key: RemoteSensingSourceKey
    provider: str
    collection: str
    mission: str
    sensor: str | None
    product_level: str | None
    purpose: str
    credentials: list[str] = []
    optical = False
    expected_latency_hours = 120
    attribution: str

    def info(self) -> RemoteSensingSourceInfo:
        return RemoteSensingSourceInfo(
            source=self.key,
            provider=self.provider,
            collection=self.collection,
            credentials_required=self.credentials,
            purpose=self.purpose,
        )

    @abstractmethod
    def fetch(
        self,
        bbox: tuple[float, float, float, float],
        start: dt.datetime,
        end: dt.datetime,
        max_cloud_cover: int,
        checked_at: dt.datetime,
    ) -> tuple[list[RemoteSensingScene], str | None, list[str]]:
        """Devuelve escenas ordenables, preview público y limitaciones."""


class StacAdapter(RemoteSensingAdapter):
    catalog_url: str

    def _collection_metadata(self) -> dict[str, Any]:
        return _request_json("GET", f"{self.catalog_url}/collections/{self.collection}")

    def fetch(
        self,
        bbox: tuple[float, float, float, float],
        start: dt.datetime,
        end: dt.datetime,
        max_cloud_cover: int,
        checked_at: dt.datetime,
    ) -> tuple[list[RemoteSensingScene], str | None, list[str]]:
        collection = self._collection_metadata()
        body: dict[str, Any] = {
            "collections": [self.collection],
            "bbox": list(bbox),
            "datetime": f"{_iso(start)}/{_iso(end)}",
            "limit": 20,
        }
        # No filtramos nubes en servidor: necesitamos distinguir la última escena
        # disponible de la última escena válida.
        result = _request_json("POST", f"{self.catalog_url}/search", payload=body)
        features = result.get("features")
        if not isinstance(features, list):
            raise ProviderError("La respuesta STAC no contiene una lista de features.")
        scenes = [
            self._normalize_item(item, collection, checked_at, max_cloud_cover)
            for item in features
            if isinstance(item, dict)
        ]
        preview = next((self._preview(item) for item in features if self._preview(item)), None)
        return (
            scenes,
            preview,
            [
                "El catálogo describe assets; el piloto no descarga escenas completas.",
                "Tamaño, dtype o resolución radiométrica quedan nulos si STAC no los publica.",
            ],
        )

    def _preview(self, item: Any) -> str | None:
        if not isinstance(item, dict):
            return None
        assets = item.get("assets") or {}
        for preferred in ("thumbnail", "rendered_preview", "visual"):
            asset = assets.get(preferred)
            if isinstance(asset, dict):
                href = safe_remote_url(asset.get("href"))
                if href:
                    return href
        return None

    def _normalize_item(
        self,
        item: dict[str, Any],
        collection: dict[str, Any],
        checked_at: dt.datetime,
        max_cloud_cover: int,
    ) -> RemoteSensingScene:
        props = item.get("properties") if isinstance(item.get("properties"), dict) else {}
        assets_raw = item.get("assets") if isinstance(item.get("assets"), dict) else {}
        collection_bands = (collection.get("summaries") or {}).get("eo:bands") or []
        item_epsg = _as_int(props.get("proj:epsg"))
        item_shape = props.get("proj:shape")
        assets = [
            self._normalize_asset(key, asset, item_epsg, item_shape, collection_bands)
            for key, asset in assets_raw.items()
            if isinstance(asset, dict)
        ]
        cloud = _as_float(props.get("eo:cloud_cover"))
        cloud_validity: str = "unknown"
        if cloud is not None:
            cloud_validity = "valid" if cloud <= max_cloud_cover else "cloudy"
        elif not self.optical:
            cloud_validity = "valid"

        band_rows = [band for asset in assets for band in asset.bands]
        centers = [band.center_wavelength_um for band in band_rows if band.center_wavelength_um]
        half_widths = [
            (band.full_width_half_max_um or 0.0) / 2
            for band in band_rows
            if band.center_wavelength_um
        ]
        spectral_range = None
        if centers:
            spectral_range = (
                min(c - w for c, w in zip(centers, half_widths)),
                max(c + w for c, w in zip(centers, half_widths)),
            )

        license_value = collection.get("license")
        if license_value in (None, "proprietary", "various"):
            license_value = next(
                (
                    safe_remote_url(link.get("href"))
                    for link in collection.get("links", [])
                    if isinstance(link, dict) and link.get("rel") == "license"
                ),
                license_value,
            )
        acquired = props.get("datetime") or props.get("start_datetime")
        published = props.get("published") or props.get("created") or props.get("updated")
        return RemoteSensingScene(
            source=self.provider,
            mission=self.mission,
            sensor=self.sensor,
            collection=self.collection,
            product_level=self.product_level,
            scene_id=str(item.get("id") or "unknown"),
            acquisition_datetime=acquired,
            published_or_processed_at=published,
            last_checked_at=_iso(checked_at),
            cloud_cover_pct=cloud,
            cloud_validity=cloud_validity,  # type: ignore[arg-type]
            license=str(license_value) if license_value else None,
            attribution=self.attribution,
            assets=assets,
            total_band_count=len({band.id for band in band_rows}) or None,
            spectral_range_um=spectral_range,
            metadata_origin={
                "acquisition_datetime": "provider" if acquired else "unavailable",
                "published_or_processed_at": "provider" if published else "unavailable",
                "cloud_cover_pct": "provider" if cloud is not None else "unavailable",
                "spectral_range_um": "derived" if spectral_range else "unavailable",
                "projection": "provider" if item_epsg else "unavailable",
                "last_checked_at": "derived",
            },
        )

    def _normalize_asset(
        self,
        key: str,
        raw: dict[str, Any],
        item_epsg: int | None,
        item_shape: Any,
        collection_bands: list[Any],
    ) -> RemoteSensingAsset:
        epsg = _as_int(raw.get("proj:epsg")) or item_epsg
        projection, datum = _projection_fields(epsg)
        shape = raw.get("proj:shape") or item_shape
        dimensions = None
        if isinstance(shape, list) and len(shape) >= 2:
            dimensions = (_as_int(shape[-1]), _as_int(shape[-2]))
            if None in dimensions:
                dimensions = None
        raster_bands = raw.get("raster:bands") if isinstance(raw.get("raster:bands"), list) else []
        eo_bands = raw.get("eo:bands") if isinstance(raw.get("eo:bands"), list) else []
        declared_bands = eo_bands
        if not declared_bands and collection_bands:
            # Las summaries de colección enumeran todas las bandas, pero un
            # asset B04/B04_10m contiene una sola. Asociarlas todas a cada COG
            # falsearía el total y la resolución por asset.
            key_prefix = key.split("_")[0].lower()
            declared_bands = [
                band
                for band in collection_bands
                if isinstance(band, dict)
                and str(band.get("name") or band.get("common_name") or "").lower() == key_prefix
            ]
        bands: list[RemoteSensingBand] = []
        for index, band in enumerate(declared_bands):
            if not isinstance(band, dict):
                continue
            center = _as_float(band.get("center_wavelength"))
            width = _as_float(band.get("full_width_half_max"))
            bands.append(
                RemoteSensingBand(
                    id=str(band.get("name") or band.get("common_name") or f"band-{index + 1}"),
                    name=band.get("name"),
                    common_name=band.get("common_name"),
                    resolution_m=_as_float(raw.get("gsd") or band.get("gsd")),
                    center_wavelength_um=center,
                    full_width_half_max_um=width,
                    wavelength_min_um=center - width / 2
                    if center is not None and width is not None
                    else None,
                    wavelength_max_um=center + width / 2
                    if center is not None and width is not None
                    else None,
                )
            )
        first_raster = raster_bands[0] if raster_bands and isinstance(raster_bands[0], dict) else {}
        return RemoteSensingAsset(
            key=key,
            title=raw.get("title"),
            format=raw.get("type"),
            file_size_bytes=_as_int(raw.get("file:size")),
            raster_dimensions_px=dimensions,  # type: ignore[arg-type]
            epsg=epsg,
            projection=projection,
            datum=datum,
            data_type=first_raster.get("data_type"),
            effective_radiometric_resolution_bits=_as_float(first_raster.get("bits_per_sample")),
            bands=bands,
            href=safe_remote_url(raw.get("href")),
        )


class PlanetaryComputerSentinel2Adapter(StacAdapter):
    key = "planetary-computer-sentinel-2-l2a"
    provider = "Microsoft Planetary Computer"
    catalog_url = "https://planetarycomputer.microsoft.com/api/stac/v1"
    collection = "sentinel-2-l2a"
    mission = "Sentinel-2"
    sensor = "MSI"
    product_level = "L2A"
    purpose = "Continuidad del NDVI óptico actual y ficha técnica trazable."
    optical = True
    expected_latency_hours = 120
    attribution = (
        "Copernicus Sentinel data (ESA/European Commission), via Microsoft Planetary Computer"
    )


class CdseSentinel2Adapter(StacAdapter):
    key = "cdse-sentinel-2-l2a"
    provider = "Copernicus Data Space Ecosystem"
    catalog_url = "https://stac.dataspace.copernicus.eu/v1"
    collection = "sentinel-2-l2a"
    mission = "Sentinel-2"
    sensor = "MSI"
    product_level = "L2A"
    purpose = "Fuente óptica primaria alternativa para reflectancia e índices."
    optical = True
    expected_latency_hours = 120
    attribution = "Copernicus Sentinel data (ESA/European Commission), via CDSE"


class CdseSentinel1Adapter(StacAdapter):
    key = "cdse-sentinel-1-grd"
    provider = "Copernicus Data Space Ecosystem"
    catalog_url = "https://stac.dataspace.copernicus.eu/v1"
    collection = "sentinel-1-grd"
    mission = "Sentinel-1"
    sensor = "C-SAR"
    product_level = "GRD"
    purpose = "Alternativa SAR bajo nubes para inundación y detección de cambios; no NDVI."
    expected_latency_hours = 72
    attribution = "Copernicus Sentinel data (ESA/European Commission), via CDSE"


class UsgsM2MAdapter(RemoteSensingAdapter):
    key = "usgs-m2m-landsat-9-c2-l2"
    provider = "USGS M2M"
    collection = "landsat_ot_c2_l2"
    mission = "Landsat 9"
    sensor = "OLI-2 / TIRS-2"
    product_level = "Collection 2 Level-2"
    purpose = "Reflectancia y temperatura Landsat con historial largo."
    credentials = ["TERRITORIO_USGS_M2M_USERNAME", "TERRITORIO_USGS_M2M_TOKEN"]
    optical = True
    expected_latency_hours = 384
    attribution = "USGS/NASA Landsat Program"
    api_base = "https://m2m.cr.usgs.gov/api/api/json/stable"

    def _api_key(self) -> str:
        username = os.environ.get("TERRITORIO_USGS_M2M_USERNAME")
        token = os.environ.get("TERRITORIO_USGS_M2M_TOKEN")
        if not username or not token:
            raise CredentialsRequired(self.credentials)
        login = _request_json(
            "POST",
            f"{self.api_base}/login-token",
            payload={"username": username, "token": token},
        )
        if login.get("errorCode") or not isinstance(login.get("data"), str):
            raise ProviderError(
                f"USGS M2M rechazó el application token: {login.get('errorCode') or 'sin API key'}"
            )
        # La API key es temporal: vive solo durante esta llamada y nunca entra
        # en el modelo normalizado, la caché, los logs ni los fixtures.
        return login["data"]

    def _post(self, endpoint: str, payload: dict[str, Any], api_key: str) -> dict[str, Any]:
        try:
            result = _request_json(
                "POST",
                f"{self.api_base}/{endpoint}",
                payload=payload,
                headers={"X-Auth-Token": api_key},
            )
        except ProviderError as exc:
            if exc.status_code == 403 and endpoint.startswith("download-"):
                raise AccessRequired(
                    "La cuenta autentica, pero USGS todavía no aprobó el acceso M2M de descarga."
                ) from exc
            raise
        if result.get("errorCode"):
            raise ProviderError(f"USGS M2M rechazó {endpoint}: {result.get('errorCode')}")
        return result

    def _search_rows(
        self,
        bbox: tuple[float, float, float, float],
        start: dt.datetime,
        end: dt.datetime,
        max_cloud_cover: int,
        api_key: str,
    ) -> list[dict[str, Any]]:
        payload = {
            "datasetName": self.collection,
            "maxResults": 20,
            "startingNumber": 1,
            "sortDirection": "DESC",
            "sortField": "acquisitionDate",
            "sceneFilter": {
                "spatialFilter": {
                    "filterType": "mbr",
                    "lowerLeft": {"longitude": bbox[0], "latitude": bbox[1]},
                    "upperRight": {"longitude": bbox[2], "latitude": bbox[3]},
                },
                "acquisitionFilter": {
                    "start": start.date().isoformat(),
                    "end": end.date().isoformat(),
                },
                "cloudCoverFilter": {
                    "min": 0,
                    "max": max_cloud_cover,
                    "includeUnknown": False,
                },
            },
        }
        data = self._post("scene-search", payload, api_key)
        rows = (data.get("data") or {}).get("results") or []
        return [row for row in rows if isinstance(row, dict)]

    def fetch(self, bbox, start, end, max_cloud_cover, checked_at):
        api_key = self._api_key()
        # La ficha temporal necesita también escenas nubladas para distinguir
        # "última disponible" de "última válida".
        rows = self._search_rows(bbox, start, end, 100, api_key)
        scenes = [self._normalize(row, checked_at, max_cloud_cover) for row in rows]
        return (
            scenes,
            None,
            [
                "USGS M2M exige una cuenta gratuita y token solo en el backend.",
                "Los detalles de bandas/GeoTIFF se completan al obtener los metadatos de descarga.",
            ],
        )

    @staticmethod
    def _flatten_options(options: list[Any]):
        for option in options:
            if not isinstance(option, dict):
                continue
            yield option
            yield from UsgsM2MAdapter._flatten_options(option.get("secondaryDownloads") or [])

    @staticmethod
    def _option_text(option: dict[str, Any]) -> str:
        fields = (
            "productName",
            "displayId",
            "downloadCode",
            "fileName",
            "name",
        )
        return " ".join(str(option.get(field) or "") for field in fields).upper()

    def _select_band_options(self, options: list[Any]) -> dict[str, dict[str, Any]]:
        patterns = {
            "SR_B4": (r"(?:^|[^A-Z0-9])SR[_ -]?B4(?:[^A-Z0-9]|$)", r"SURFACE REFLECTANCE BAND 4"),
            "SR_B5": (r"(?:^|[^A-Z0-9])SR[_ -]?B5(?:[^A-Z0-9]|$)", r"SURFACE REFLECTANCE BAND 5"),
            "QA_PIXEL": (r"(?:^|[^A-Z0-9])QA[_ -]?PIXEL(?:[^A-Z0-9]|$)", r"PIXEL QUALITY"),
        }
        selected: dict[str, dict[str, Any]] = {}
        flattened = list(self._flatten_options(options))
        for role, role_patterns in patterns.items():
            matches = [
                option
                for option in flattened
                if option.get("available") is True
                and option.get("id")
                and any(re.search(pattern, self._option_text(option)) for pattern in role_patterns)
            ]
            if matches:
                selected[role] = matches[0]
        missing = sorted(set(patterns) - set(selected))
        if missing:
            raise ProviderError(
                "USGS no ofreció las bandas individuales requeridas: " + ", ".join(missing)
            )
        return selected

    def request_ndvi_assets(
        self,
        *,
        bbox: tuple[float, float, float, float],
        start: dt.datetime,
        end: dt.datetime,
        max_cloud_cover: int,
        label: str,
        checked_at: dt.datetime,
    ) -> tuple[RemoteSensingScene, dict[str, str], bool]:
        """Obtiene URLs temporales B4/B5/QA en memoria; nunca las serializa."""
        api_key = self._api_key()
        rows = self._search_rows(bbox, start, end, max_cloud_cover, api_key)
        if not rows:
            raise ProviderError("No hay una escena Landsat 9 válida en el periodo solicitado.")
        row = rows[0]
        entity_id = row.get("entityId")
        if not entity_id:
            raise ProviderError("USGS no devolvió entityId para la escena seleccionada.")
        options_response = self._post(
            "download-options",
            {"datasetName": self.collection, "entityIds": [entity_id]},
            api_key,
        )
        selected = self._select_band_options(options_response.get("data") or [])
        requested = [
            {"entityId": entity_id, "productId": option["id"]} for option in selected.values()
        ]
        download_response = self._post(
            "download-request",
            {"downloads": requested, "label": label, "returnAvailable": True},
            api_key,
        )
        data = download_response.get("data") or {}
        available = [
            item for item in data.get("availableDownloads") or [] if isinstance(item, dict)
        ]
        preparing = [
            item for item in data.get("preparingDownloads") or [] if isinstance(item, dict)
        ]

        role_by_product = {str(option["id"]): role for role, option in selected.items()}
        role_by_download: dict[str, str] = {}
        for role, item in zip(selected, available + preparing, strict=False):
            if item.get("downloadId"):
                role_by_download[str(item["downloadId"])] = role

        urls: dict[str, str] = {}

        def collect(items: list[dict[str, Any]]) -> None:
            for item in items:
                url = item.get("url")
                product_id = str(item.get("productId") or item.get("id") or "")
                role = role_by_product.get(product_id)
                if role is None and item.get("downloadId"):
                    role = role_by_download.get(str(item["downloadId"]))
                if role is None and isinstance(url, str):
                    upper_url = urlsplit(url).path.upper()
                    role = next(
                        (
                            candidate
                            for candidate in ("SR_B4", "SR_B5", "QA_PIXEL")
                            if candidate in upper_url
                        ),
                        None,
                    )
                if role and isinstance(url, str) and url.startswith("https://"):
                    urls[role] = url

        collect(available)
        attempts = 0
        while len(urls) < 3 and preparing and attempts < 4:
            attempts += 1
            time.sleep(attempts)
            retrieve = self._post("download-retrieve", {"label": label}, api_key)
            retrieve_data = retrieve.get("data") or {}
            ready = retrieve_data.get("available") or retrieve_data.get("availableDownloads") or []
            collect([item for item in ready if isinstance(item, dict)])

        scene = self._normalize(row, checked_at, max_cloud_cover)
        return scene, urls, len(urls) < 3

    def _normalize(self, row, checked_at, max_cloud_cover):
        cloud = _as_float(row.get("cloudCover"))
        acquired = row.get("acquisitionDate")
        temporal_coverage = row.get("temporalCoverage")
        if not acquired and isinstance(temporal_coverage, dict):
            acquired = temporal_coverage.get("startDate") or temporal_coverage.get("endDate")
        elif not acquired and isinstance(temporal_coverage, str):
            acquired = temporal_coverage
        return RemoteSensingScene(
            source=self.provider,
            mission=self.mission,
            sensor=self.sensor,
            collection=self.collection,
            product_level=self.product_level,
            scene_id=str(row.get("displayId") or row.get("entityId") or "unknown"),
            acquisition_datetime=acquired,
            published_or_processed_at=row.get("publishDate"),
            last_checked_at=_iso(checked_at),
            cloud_cover_pct=cloud,
            cloud_validity="valid" if cloud is not None and cloud <= max_cloud_cover else "cloudy",
            license="Public domain (USGS Landsat data policy)",
            attribution=self.attribution,
            assets=[],
            total_band_count=None,
            metadata_origin={
                "acquisition_datetime": "provider" if acquired else "unavailable",
                "cloud_cover_pct": "provider" if cloud is not None else "unavailable",
                "assets": "unavailable",
                "last_checked_at": "derived",
            },
        )


class NasaEarthdataViirsAdapter(RemoteSensingAdapter):
    key = "nasa-earthdata-viirs-nrt"
    provider = "NASA Earthdata / CMR"
    collection = "VNP02IMG_NRT"
    mission = "Suomi NPP"
    sensor = "VIIRS"
    product_level = "Level-1B imagery, near real time"
    purpose = "Imagen VIIRS de baja latencia para contexto regional."
    credentials = ["TERRITORIO_EARTHDATA_TOKEN (solo si se descarga el granulo)"]
    expected_latency_hours = 48
    attribution = "NASA EOSDIS / LANCE"
    endpoint = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"

    def fetch(self, bbox, start, end, max_cloud_cover, checked_at):
        short_name = os.environ.get("TERRITORIO_EARTHDATA_SHORT_NAME", self.collection)
        params = {
            "short_name": short_name,
            "bounding_box": ",".join(str(v) for v in bbox),
            "temporal": f"{_iso(start)},{_iso(end)}",
            "page_size": 20,
            "sort_key": "-start_date",
        }
        result = _request_json("GET", self.endpoint, params=params)
        rows = result.get("items") or []
        scenes = [self._normalize(row, checked_at) for row in rows if isinstance(row, dict)]
        preview = next((self._preview(row) for row in rows if self._preview(row)), None)
        return (
            scenes,
            preview,
            [
                "CMR permite descubrir metadatos sin token; algunos granulos exigen Earthdata Login para descarga.",
                "El producto NRT y su short name pueden cambiarse con TERRITORIO_EARTHDATA_SHORT_NAME.",
            ],
        )

    def _preview(self, row):
        umm = row.get("umm") or {}
        for link in umm.get("RelatedUrls") or []:
            if isinstance(link, dict) and "BROWSE" in str(link.get("Type", "")):
                url = safe_remote_url(link.get("URL"))
                if url:
                    return url
        return None

    def _normalize(self, row, checked_at):
        meta = row.get("meta") or {}
        umm = row.get("umm") or {}
        range_dt = (umm.get("TemporalExtent") or {}).get("RangeDateTime") or {}
        acquired = range_dt.get("BeginningDateTime")
        size_mb = None
        data_granule = umm.get("DataGranule") or {}
        for size in data_granule.get("ArchiveAndDistributionInformation") or []:
            if isinstance(size, dict) and size.get("Size") is not None:
                units = str(size.get("SizeUnit", "MB")).upper()
                factor = {"BYTES": 1, "KB": 1000, "MB": 1_000_000, "GB": 1_000_000_000}.get(units)
                if factor:
                    size_mb = int(float(size["Size"]) * factor)
                    break
        assets = []
        for index, link in enumerate(umm.get("RelatedUrls") or []):
            if not isinstance(link, dict) or link.get("Type") != "GET DATA":
                continue
            assets.append(
                RemoteSensingAsset(
                    key=f"data-{index + 1}",
                    title=link.get("Description"),
                    format=link.get("Format"),
                    file_size_bytes=size_mb,
                    href=safe_remote_url(link.get("URL")),
                )
            )
        return RemoteSensingScene(
            source=self.provider,
            mission=self.mission,
            sensor=self.sensor,
            collection=str(umm.get("CollectionReference", {}).get("ShortName") or self.collection),
            product_level=self.product_level,
            scene_id=str(umm.get("GranuleUR") or meta.get("concept-id") or "unknown"),
            acquisition_datetime=acquired,
            published_or_processed_at=meta.get("revision-date"),
            last_checked_at=_iso(checked_at),
            cloud_cover_pct=_as_float(umm.get("CloudCover")),
            cloud_validity="valid",
            license="NASA Earth Science Data and Information Policy",
            attribution=self.attribution,
            assets=assets,
            total_band_count=None,
            metadata_origin={
                "acquisition_datetime": "provider" if acquired else "unavailable",
                "file_size_bytes": "provider" if size_mb is not None else "unavailable",
                "projection": "unavailable",
                "last_checked_at": "derived",
            },
        )


class NasaGibsAdapter(RemoteSensingAdapter):
    key = "nasa-gibs-wmts"
    provider = "NASA GIBS"
    collection = "MODIS_Terra_CorrectedReflectance_TrueColor"
    mission = "Terra"
    sensor = "MODIS"
    product_level = "Visualization layer"
    purpose = "Capa temporal de visualización rápida; no fuente analítica."
    expected_latency_hours = 48
    attribution = "NASA EOSDIS GIBS"
    capabilities_url = (
        "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/1.0.0/WMTSCapabilities.xml"
    )

    def fetch(self, bbox, start, end, max_cloud_cover, checked_at):
        layer_id = os.environ.get("TERRITORIO_GIBS_LAYER", self.collection)
        try:
            # El capabilities global ronda varios MB y GIBS puede tardar más que
            # un JSON STAC pequeño aun cuando el servicio está sano.
            root = ET.fromstring(_request_text(self.capabilities_url, timeout_seconds=75))
        except ET.ParseError as exc:
            raise ProviderError("NASA GIBS devolvió capabilities XML inválido.") from exc
        ns = {"wmts": "http://www.opengis.net/wmts/1.0", "ows": "http://www.opengis.net/ows/1.1"}
        layer = next(
            (
                candidate
                for candidate in root.findall(".//wmts:Layer", ns)
                if candidate.findtext("ows:Identifier", default="", namespaces=ns) == layer_id
            ),
            None,
        )
        if layer is None:
            raise ProviderError(f"La capa GIBS configurada no existe: {layer_id}")
        dimension = layer.find("wmts:Dimension", ns)
        values = [node.text for node in layer.findall("wmts:Dimension/wmts:Value", ns) if node.text]
        default_time = (
            dimension.findtext("wmts:Default", default="", namespaces=ns)
            if dimension is not None
            else ""
        )
        dates: list[dt.datetime] = []
        parsed_default = _parse_datetime(default_time)
        if parsed_default and start <= parsed_default <= end:
            dates.append(parsed_default)
        for value in values:
            for token in value.split(","):
                # Un Value puede ser una fecha o un intervalo ISO
                # inicio/fin/periodo. Para "última disponible" interesa también
                # el extremo final; tomar solo el inicio hacía parecer antiguas
                # capas que GIBS actualiza a diario.
                for endpoint in token.split("/")[:2]:
                    parsed = _parse_datetime(endpoint)
                    if parsed and start <= parsed <= end:
                        dates.append(parsed)
        acquired = max(dates) if dates else None
        resource = layer.find("wmts:ResourceURL", ns)
        template = resource.get("template") if resource is not None else None
        preview = (
            safe_remote_url(template.replace("{Time}", acquired.date().isoformat()))
            if template and acquired
            else safe_remote_url(template)
        )
        scene = RemoteSensingScene(
            source=self.provider,
            mission=self.mission,
            sensor=self.sensor,
            collection=layer_id,
            product_level=self.product_level,
            scene_id=f"{layer_id}:{acquired.date().isoformat() if acquired else 'undated'}",
            acquisition_datetime=_iso(acquired) if acquired else None,
            published_or_processed_at=None,
            last_checked_at=_iso(checked_at),
            cloud_cover_pct=None,
            cloud_validity="valid",
            license="NASA Earth Science Data and Information Policy",
            attribution=self.attribution,
            assets=[
                RemoteSensingAsset(
                    key="wmts",
                    format=resource.get("format") if resource is not None else None,
                    href=preview,
                )
            ],
            total_band_count=3,
            metadata_origin={
                "acquisition_datetime": "provider" if acquired else "unavailable",
                "total_band_count": "derived",
                "projection": "provider",
                "last_checked_at": "derived",
            },
        )
        return (
            [scene],
            preview,
            [
                "GIBS es una visualización renderizada, no un COG científico ni fuente para índices.",
                "La plantilla WMTS conserva placeholders de tesela y se sirve sin credenciales.",
            ],
        )


ADAPTERS: dict[RemoteSensingSourceKey, RemoteSensingAdapter] = {
    adapter.key: adapter
    for adapter in (
        PlanetaryComputerSentinel2Adapter(),
        CdseSentinel2Adapter(),
        CdseSentinel1Adapter(),
        UsgsM2MAdapter(),
        NasaEarthdataViirsAdapter(),
        NasaGibsAdapter(),
    )
}


def list_sources() -> list[RemoteSensingSourceInfo]:
    return [adapter.info() for adapter in ADAPTERS.values()]


def cache_key(
    bbox: tuple[float, float, float, float],
    source: RemoteSensingSourceKey,
    collection: str,
    query_date: dt.date,
) -> str:
    payload = json.dumps(
        {
            "algorithm": ALGORITHM_VERSION,
            "aoi_bbox": [round(value, 7) for value in bbox],
            "source": source,
            "collection": collection,
            "date": query_date.isoformat(),
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def _build_temporal_state(
    adapter: RemoteSensingAdapter,
    scenes: list[RemoteSensingScene],
    checked_at: dt.datetime,
) -> RemoteSensingTemporalState:
    ordered = sorted(
        scenes,
        key=lambda scene: (
            _parse_datetime(scene.acquisition_datetime) or dt.datetime.min.replace(tzinfo=UTC)
        ),
        reverse=True,
    )
    latest = ordered[0] if ordered else None
    valid = next((scene for scene in ordered if scene.cloud_validity == "valid"), None)
    age = None
    acquired = _parse_datetime(valid.acquisition_datetime) if valid else None
    if acquired:
        age = round(max(0.0, (checked_at - acquired).total_seconds() / 3600), 2)

    if not latest:
        status = "no_valid_data"
        message = (
            "El proveedor respondió, pero no hay observaciones en el AOI y periodo solicitado."
        )
    elif adapter.optical and latest.cloud_validity == "cloudy":
        status = "cloudy"
        if valid:
            message = "La última escena está nublada; se conserva aparte la última escena válida anterior."
        else:
            message = "La última escena está nublada y no hay una escena válida en el periodo."
    elif not valid:
        status = "no_valid_data"
        message = "Hay metadatos, pero ninguna observación puede declararse válida."
    elif age is not None and age > adapter.expected_latency_hours:
        status = "delayed"
        message = "La última observación válida supera la latencia esperada para esta fuente."
    else:
        status = "updated"
        message = "La observación válida más reciente está dentro de la latencia esperada."

    return RemoteSensingTemporalState(
        last_scene_available=latest,
        last_valid_cloud_free_scene=valid if adapter.optical else None,
        last_scene_used=valid,
        observation_age_hours=age,
        status=status,  # type: ignore[arg-type]
        message=message,
    )


def inspect_source(
    *,
    source: RemoteSensingSourceKey,
    bbox: tuple[float, float, float, float],
    lookback_days: int,
    max_cloud_cover: int,
    cache_dir: Path,
    cache_hours: int,
) -> RemoteSensingPilotResult:
    adapter = ADAPTERS[source]
    checked_at = utc_now()
    key = cache_key(bbox, source, adapter.collection, checked_at.date())
    path = cache_dir / f"{key}.json"
    if path.exists():
        try:
            cached = RemoteSensingPilotResult.model_validate_json(path.read_text(encoding="utf-8"))
            cached_at = _parse_datetime(cached.checked_at)
            if cached_at and checked_at - cached_at <= dt.timedelta(hours=max(0, cache_hours)):
                return cached.model_copy(update={"cached": True})
        except (OSError, ValueError):
            pass

    start = checked_at - dt.timedelta(days=lookback_days)
    credentials: list[str] = []
    limitations: list[str] = []
    preview = None
    try:
        scenes, preview, limitations = adapter.fetch(
            bbox, start, checked_at, max_cloud_cover, checked_at
        )
        temporal = _build_temporal_state(adapter, scenes, checked_at)
    except CredentialsRequired as exc:
        credentials = exc.variables
        temporal = RemoteSensingTemporalState(
            status="credentials_required",
            message="La prueba requiere credenciales gratuitas no configuradas en el backend.",
        )
        limitations = [str(exc)]
    except ProviderError as exc:
        temporal = RemoteSensingTemporalState(status="provider_error", message=str(exc))
    except (TypeError, ValueError):
        # Un proveedor puede cambiar la forma de un campo sin avisar. Eso es un
        # estado observable del adaptador, no un 500 ni un motivo para exponer
        # el payload remoto completo (que podría contener enlaces sensibles).
        temporal = RemoteSensingTemporalState(
            status="provider_error",
            message="El proveedor devolvió metadatos incompatibles con el contrato normalizado.",
        )

    result = RemoteSensingPilotResult(
        source=source,
        cached=False,
        cache_key=key,
        checked_at=_iso(checked_at),
        temporal=temporal,
        preview_url=preview,
        limitations=limitations,
        credentials_required=credentials,
    )
    cache_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    return result


def _landsat_cache_key(
    aoi: AOI, checked_on: dt.date, lookback_days: int, max_cloud_cover: int
) -> str:
    raw = json.dumps(
        {
            "aoi": json.loads(aoi.canonical_json()),
            "source": UsgsM2MAdapter.key,
            "collection": UsgsM2MAdapter.collection,
            "date": checked_on.isoformat(),
            "algorithm": LANDSAT_ALGORITHM_VERSION,
            "lookback_days": lookback_days,
            "max_cloud_cover": max_cloud_cover,
        },
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(raw.encode()).hexdigest()[:32]


def _remote_file_size(href: str) -> int | None:
    """Consulta el tamaño sin registrar ni devolver la URL temporal firmada."""
    try:
        response = requests.head(href, allow_redirects=True, timeout=HTTP_TIMEOUT_SECONDS)
        response.raise_for_status()
        return _as_int(response.headers.get("content-length"))
    except requests.RequestException:
        return None


def _landsat_asset(fact) -> RemoteSensingAsset:
    return RemoteSensingAsset(
        key=fact.key,
        title=f"Landsat 9 {fact.key}",
        format="image/tiff; application=geotiff",
        file_size_bytes=fact.file_size_bytes,
        raster_dimensions_px=(fact.width, fact.height),
        epsg=fact.epsg,
        projection=fact.projection,
        datum=fact.datum,
        data_type=fact.data_type,
        effective_radiometric_resolution_bits=None,
        bands=[
            RemoteSensingBand(
                id=fact.key,
                name=fact.key,
                resolution_m=fact.resolution_m,
            )
        ],
        # Las URLs de descarga M2M caducan y pueden incluir secretos.
        href=None,
    )


def run_usgs_landsat_pilot(
    *,
    aoi: AOI,
    lookback_days: int,
    max_cloud_cover: int,
    cache_dir: Path,
    cache_hours: int,
) -> LandsatPilotResult:
    """Descarga solo B4/B5/QA del AOI y genera un NDVI pequeño y trazable."""
    checked_at = utc_now()
    key = _landsat_cache_key(aoi, checked_at.date(), lookback_days, max_cloud_cover)
    output_dir = cache_dir / "landsat" / key
    metadata_path = output_dir / "metadata.json"
    raster_path = output_dir / "landsat-ndvi.tif"
    preview_path = output_dir / "landsat-ndvi.png"

    if metadata_path.exists() and raster_path.exists() and preview_path.exists():
        try:
            cached = LandsatPilotResult.model_validate_json(
                metadata_path.read_text(encoding="utf-8")
            )
            cached_at = _parse_datetime(cached.checked_at)
            if (
                cached.status == "ready"
                and cached_at
                and checked_at - cached_at <= dt.timedelta(hours=max(0, cache_hours))
            ):
                return cached.model_copy(update={"cached": True})
        except (OSError, ValueError):
            pass

    adapter = UsgsM2MAdapter()
    base = {
        "cached": False,
        "cache_key": key,
        "checked_at": _iso(checked_at),
    }
    try:
        scene, urls, preparing = adapter.request_ndvi_assets(
            bbox=aoi.bbox,
            start=checked_at - dt.timedelta(days=lookback_days),
            end=checked_at,
            max_cloud_cover=max_cloud_cover,
            label=f"territorio-base-{key}",
            checked_at=checked_at,
        )
        if preparing:
            result = LandsatPilotResult(
                **base,
                status="preparing",
                message="USGS aceptó la solicitud; las tres bandas todavía se están preparando.",
                scene=scene,
            )
        else:
            sizes = {role: _remote_file_size(href) for role, href in urls.items()}
            artifact = compute_landsat_ndvi(
                red_href=urls["SR_B4"],
                nir_href=urls["SR_B5"],
                qa_href=urls["QA_PIXEL"],
                aoi=aoi,
                output_dir=output_dir,
                file_sizes=sizes,
            )
            assets = [_landsat_asset(fact) for fact in artifact.facts]
            scene = scene.model_copy(
                update={
                    "assets": assets,
                    "metadata_origin": {
                        **scene.metadata_origin,
                        "assets": "derived",
                        "total_band_count": "unavailable",
                        "raster_dimensions_px": "provider",
                        "projection": "provider",
                        "data_type": "provider",
                        "file_size_bytes": (
                            "provider"
                            if all(size is not None for size in sizes.values())
                            else "unavailable"
                        ),
                        "effective_radiometric_resolution_bits": "unavailable",
                    },
                }
            )
            provenance = DerivedProductProvenance(
                product="NDVI Landsat 9 Collection 2 Level-2",
                formula=(
                    "NDVI = (NIR_reflectance - red_reflectance) / "
                    "(NIR_reflectance + red_reflectance)"
                ),
                parameters={
                    "surface_reflectance_scale": SR_SCALE,
                    "surface_reflectance_offset": SR_OFFSET,
                    "qa_pixel_invalid_bits": list(QA_INVALID_BITS),
                    "algorithm_version": LANDSAT_ALGORITHM_VERSION,
                },
                source=adapter.provider,
                scene_ids=[scene.scene_id],
                bands_used=["SR_B4", "SR_B5", "QA_PIXEL"],
            )
            result = LandsatPilotResult(
                **base,
                status="ready",
                message="NDVI generado con reflectancia superficial y máscara QA_PIXEL.",
                scene=scene,
                source_assets=assets,
                derived_product=provenance,
                summary=LandsatNdviSummary(**artifact.summary),
                preview_url=f"/remote-sensing/pilot/landsat/{key}/preview.png",
                raster_url=f"/remote-sensing/pilot/landsat/{key}/ndvi.tif",
            )
    except CredentialsRequired as exc:
        result = LandsatPilotResult(
            **base,
            status="credentials_required",
            message="Faltan las credenciales gratuitas de USGS en el backend.",
            credentials_required=exc.variables,
        )
    except AccessRequired:
        result = LandsatPilotResult(
            **base,
            status="access_required",
            message=(
                "La cuenta autentica, pero USGS aún debe aprobar el acceso gratuito "
                "M2M de descarga."
            ),
        )
    except ProviderError as exc:
        status = "no_valid_data" if "No hay una escena" in str(exc) else "provider_error"
        result = LandsatPilotResult(**base, status=status, message=str(exc))
    except (KeyError, TypeError, ValueError):
        result = LandsatPilotResult(
            **base,
            status="provider_error",
            message="No se pudo generar el NDVI con las bandas devueltas por USGS.",
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    metadata_path.write_text(result.model_dump_json(indent=2), encoding="utf-8")
    return result
