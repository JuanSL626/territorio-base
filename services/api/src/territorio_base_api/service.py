"""Pegamento entre el store de jobs y el pipeline raster.

Todo lo que hay acá corre en un thread worker (`asyncio.to_thread`), porque
rasterio/numpy bloquean el GIL de forma larga y no queremos congelar el event loop
que está sirviendo el SSE de progreso.
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from typing import Callable

from territorio_base_api.analysis.report import STEPS, run_analysis
from territorio_base_api.aoi import AOI
from territorio_base_api.render.palettes import RASTER_SPECS
from territorio_base_api.render.raster_io import write_geotiff

log = logging.getLogger(__name__)

#  3 pasos de descarga + el "Análisis completo" final, que también se emite como
#  evento de progreso (así el cliente no tiene que inferir el 100 % del `done`).
TOTAL_STEPS = len(STEPS) + 1

LAYER_LABELS = {
    "dem": "Elevación (DEM)",
    "slope": "Pendiente (%)",
    "aspect": "Orientación",
    "ndvi": "NDVI (continuo)",
    "ndvi_density": "Densidad de vegetación (clasificada)",
    "worldcover": "Cobertura de suelo (WorldCover)",
    "coastal": "Inundación costera (WRI Aqueduct)",
}


def coastal_cache_key(aoi: AOI, preset: str) -> str:
    payload = json.dumps({"aoi": aoi.canonical_json(), "preset": preset}, sort_keys=True)
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()[:32]


def analysis_pipeline(aoi: AOI, progress: Callable[[str], None], params: dict) -> dict:
    """Corre el análisis y deja los GeoTIFF escritos en el directorio del job."""
    job_dir = Path(params["job_dir"])
    results = run_analysis(
        aoi,
        progress,
        ndvi_resolution_m=int(params.get("ndvi_resolution_m", 10)),
        lookback_days=int(params.get("lookback_days", 180)),
        max_cloud_cover=int(params.get("max_cloud_cover", 30)),
    )

    written: list[str] = []
    for layer, da in results["rasters"].items():
        spec = RASTER_SPECS.get(layer)
        if spec is None:
            continue
        try:
            write_geotiff(da, job_dir / f"{layer}.tif", spec)
            written.append(layer)
        except Exception as exc:  # noqa: BLE001 — un TIFF que no se pudo escribir
            # no invalida las estadísticas ya calculadas.
            log.warning("No se pudo escribir %s.tif: %s", layer, exc, exc_info=True)

    results["written_layers"] = written
    return results


def build_layer_list(job_id: str, written: list[str]) -> list[dict]:
    layers = []
    for layer in RASTER_SPECS:
        spec = RASTER_SPECS[layer]
        available = layer in written
        if layer == "coastal" and not available:
            # La costera es on-demand: no se anuncia hasta que POST /coastal la traiga.
            continue
        layers.append(
            {
                "layer": layer,
                "kind": spec.kind,
                "label": LAYER_LABELS.get(layer, layer),
                "default_opacity": spec.default_opacity,
                "available": available,
                "overlay_url": f"/analysis/{job_id}/overlay/{layer}.png" if available else None,
                "overlay_metadata_url": f"/analysis/{job_id}/overlay/{layer}.json"
                if available
                else None,
                "raster_url": f"/analysis/{job_id}/raster/{layer}.tif" if available else None,
                "download_filename": spec.download_filename,
            }
        )
    return layers


def build_result_payload(job_id: str, results: dict) -> dict:
    written = results.get("written_layers", [])
    return {
        "aoi": results["aoi"],
        "topography": results["topography"],
        "vegetation": results["vegetation"],
        "provenance": results["provenance"],
        "layers": build_layer_list(job_id, written),
    }


def resolve_status(results: dict) -> tuple[str, str | None]:
    """'ok' / 'partial' / 'error' según cuántas fuentes respondieron."""
    topo_ok = results["topography"]["available"]
    ndvi_ok = results["vegetation"]["ndvi_available"]
    wc_ok = results["vegetation"]["worldcover_available"]

    if topo_ok and ndvi_ok and wc_ok:
        return "ok", None
    if not (topo_ok or ndvi_ok or wc_ok):
        reasons = [
            results["topography"].get("error"),
            results["vegetation"].get("ndvi_error"),
            results["vegetation"].get("worldcover_error"),
        ]
        detail = " · ".join(r for r in reasons if r) or "Ninguna fuente raster respondió."
        return "error", f"Ninguna fuente respondió: {detail}"
    return "partial", None
