"""Servicio HTTP raster de Territorio Base (FastAPI).

Alcance (ver docs/migration/01-engine-decision-memo.md, opción C — híbrida):
Python es dueño **solo de la grilla de píxeles**: STAC, firma SAS de Planetary
Computer, mosaico odc.stac, recorte al AOI, NDVI, pendiente, WorldCover, Aqueduct
y export GeoTIFF. Todo lo vectorial (Overpass, WDPA, MEPyD), el parseo de AOI y el
export shapefile/ZIP viven en TypeScript.
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, AsyncIterator

from fastapi import Depends, FastAPI, Header, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from sse_starlette.sse import EventSourceResponse

from territorio_base_api import __version__
from territorio_base_api.aoi import load_aoi_from_geojson_dict
from territorio_base_api.config import Settings, get_settings
from territorio_base_api.jobs import Job, JobStore
from territorio_base_api.models import (
    AnalysisJob,
    AnalysisRequest,
    CoastalRequest,
    CoastalResponse,
    ErrorResponse,
    HealthResponse,
    OverlayMetadata,
    PresetsResponse,
)
from territorio_base_api.render.overlay import render_overlay
from territorio_base_api.render.palettes import RASTER_SPECS
from territorio_base_api.render.raster_io import read_geotiff, write_geotiff
from territorio_base_api.service import (
    TOTAL_STEPS,
    analysis_pipeline,
    build_result_payload,
    coastal_cache_key,
    resolve_status,
)
from territorio_base_api.sources import aqueduct

log = logging.getLogger(__name__)

NOT_FOUND = {404: {"model": ErrorResponse, "description": "No existe."}}
CONFLICT = {409: {"model": ErrorResponse, "description": "El recurso todavía no está listo."}}

DESCRIPTION = """
Servicio raster de **Territorio Base**.

* `POST /analysis` es asíncrono: devuelve `202` con un id de job. El pipeline tarda
  entre 10 y 90 s (Sentinel-2 domina), así que el progreso se sigue por
  `GET /analysis/{id}/events` (Server-Sent Events, mensajes en español) o por polling.
* Cada capa raster se sirve de dos formas: **PNG + bounds WGS84** para el overlay de
  MapLibre, y **GeoTIFF** (DEFLATE + tag nodata) para descargar.
* Las fuentes están aisladas entre sí: que Sentinel-2 no encuentre escenas sin nubes
  no borra la topografía. El booleano `available` distingue "no se pudo consultar" de
  "consulté y no hay nada".
"""


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    settings: Settings = get_settings()
    store = JobStore(settings)
    loaded = store.load_from_disk()
    purged = store.purge_expired()
    log.info("Store listo: %d job(s) recuperados, %d purgados, data_dir=%s", loaded, purged, settings.data_dir)
    app.state.settings = settings
    app.state.store = store
    yield


def get_store(request: Request) -> JobStore:
    return request.app.state.store


StoreDep = Annotated[JobStore, Depends(get_store)]


async def require_token(
    request: Request, authorization: Annotated[str | None, Header()] = None
) -> None:
    """Token interno opcional. El servicio lo llama el SSR, no el browser."""
    settings: Settings = request.app.state.settings
    if not settings.api_token:
        return
    expected = f"Bearer {settings.api_token}"
    if authorization != expected:
        raise HTTPException(status_code=401, detail="Token inválido o ausente.")


app = FastAPI(
    title="Territorio Base — API raster",
    version=__version__,
    description=DESCRIPTION,
    lifespan=lifespan,
    openapi_tags=[
        {"name": "salud", "description": "Liveness/readiness."},
        {"name": "análisis", "description": "Pipeline raster asíncrono sobre un AOI."},
        {"name": "capas", "description": "Overlays PNG y GeoTIFF de cada capa."},
        {"name": "costera", "description": "Inundación costera WRI Aqueduct, on-demand."},
    ],
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    # Sin esto el browser no ve los bounds del overlay.
    expose_headers=["X-Bounds", "X-Overlay-Coordinates", "X-Overlay-Metadata-Url", "Location"],
)


# ---------------------------------------------------------------------------
# Salud
# ---------------------------------------------------------------------------


@app.get(
    "/healthz",
    tags=["salud"],
    operation_id="healthz",
    summary="Estado del servicio",
    response_model=HealthResponse,
)
async def healthz(store: StoreDep) -> HealthResponse:
    return HealthResponse(status="ok", version=__version__, jobs_in_flight=store.in_flight)


# ---------------------------------------------------------------------------
# Análisis
# ---------------------------------------------------------------------------


def _job_to_model(job: Job) -> AnalysisJob:
    return AnalysisJob(
        id=job.id,
        status=job.status,  # type: ignore[arg-type]
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
        aoi=job.aoi_info,  # type: ignore[arg-type]
        progress=job.progress,  # type: ignore[arg-type]
        error=job.error,
        result=job.result,  # type: ignore[arg-type]
        events_url=f"/analysis/{job.id}/events",
        self_url=f"/analysis/{job.id}",
    )


def _require_job(store: JobStore, analysis_id: str) -> Job:
    job = store.get(analysis_id)
    if job is None:
        raise HTTPException(status_code=404, detail=f"No existe el análisis {analysis_id}.")
    return job


@app.post(
    "/analysis",
    tags=["análisis"],
    operation_id="createAnalysis",
    summary="Lanzar un análisis raster sobre un AOI",
    status_code=status.HTTP_202_ACCEPTED,
    response_model=AnalysisJob,
    responses={422: {"model": ErrorResponse, "description": "AOI inválido."}},
    dependencies=[Depends(require_token)],
)
async def create_analysis(
    payload: AnalysisRequest, store: StoreDep, response: Response
) -> AnalysisJob:
    aoi_geojson = payload.aoi.model_dump(mode="json")
    try:
        aoi = load_aoi_from_geojson_dict(aoi_geojson)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    job = store.create(
        aoi_geojson,
        {
            "ndvi_resolution_m": payload.ndvi_resolution_m,
            "lookback_days": payload.lookback_days,
            "max_cloud_cover": payload.max_cloud_cover,
            "total_steps": TOTAL_STEPS,
        },
    )
    #  El id se conoce recién acá, así que el directorio de trabajo se completa ahora.
    job.params["job_dir"] = str(store.job_dir(job.id))
    job.aoi_info = {"area_ha": aoi.area_ha, "bbox": list(aoi.bbox), "utm_epsg": aoi.utm_epsg}
    store.persist(job)

    def on_success(finished: Job, results: dict) -> None:
        finished.result = build_result_payload(finished.id, results)
        finished.status, error = resolve_status(results)
        finished.error = error

    store.launch(job, analysis_pipeline, on_success)

    response.headers["Location"] = f"/analysis/{job.id}"
    return _job_to_model(job)


@app.get(
    "/analysis/{analysis_id}",
    tags=["análisis"],
    operation_id="getAnalysis",
    summary="Estado y resultado de un análisis",
    response_model=AnalysisJob,
    responses=NOT_FOUND,
    dependencies=[Depends(require_token)],
)
async def get_analysis(analysis_id: str, store: StoreDep) -> AnalysisJob:
    return _job_to_model(_require_job(store, analysis_id))


@app.get(
    "/analysis/{analysis_id}/events",
    tags=["análisis"],
    operation_id="streamAnalysisEvents",
    summary="Progreso del análisis (Server-Sent Events)",
    response_class=EventSourceResponse,
    response_model=None,
    description=(
        "Stream SSE con los eventos `progress`, `status`, `done` y `error`. Los "
        "mensajes de `progress` son exactamente los strings en español que mostraba "
        "la app legacy. Al conectarse se reenvía el progreso ya ocurrido, así que un "
        "cliente que llega tarde no pierde pasos."
    ),
    responses={
        200: {"content": {"text/event-stream": {}}, "description": "Stream de eventos."},
        **NOT_FOUND,
    },
    dependencies=[Depends(require_token)],
)
async def stream_analysis_events(analysis_id: str, store: StoreDep, request: Request):
    job = _require_job(store, analysis_id)
    queue = store.subscribe(job)

    async def event_source() -> AsyncIterator[dict]:
        try:
            sent_steps = 0
            # Replay: lo que ya pasó antes de que este cliente se conectara.
            for event in list(job.progress):
                sent_steps = max(sent_steps, event["step"])
                yield {"event": "progress", "data": json.dumps(event, ensure_ascii=False)}
            if job.terminal:
                yield {
                    "event": "done" if job.status != "error" else "error",
                    "data": json.dumps(
                        {"status": job.status, "error": job.error}, ensure_ascii=False
                    ),
                }
                return

            while True:
                if await request.is_disconnected():
                    break
                try:
                    item = await asyncio.wait_for(queue.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield {"event": "ping", "data": "{}"}
                    continue
                if store.is_sentinel(item):
                    break
                if item["event"] == "progress":
                    if item["data"]["step"] <= sent_steps:
                        continue  # ya lo mandamos en el replay
                    sent_steps = item["data"]["step"]
                yield {
                    "event": item["event"],
                    "data": json.dumps(item["data"], ensure_ascii=False),
                }
                if item["event"] in ("done", "error"):
                    break
        finally:
            store.unsubscribe(job, queue)

    return EventSourceResponse(event_source())


# ---------------------------------------------------------------------------
# Capas
# ---------------------------------------------------------------------------


def _spec_or_404(layer: str):
    spec = RASTER_SPECS.get(layer)
    if spec is None:
        raise HTTPException(
            status_code=404,
            detail=f"Capa desconocida: {layer!r}. Válidas: {sorted(RASTER_SPECS)}.",
        )
    return spec


def _raster_path(base: Path, layer: str) -> Path:
    path = base / f"{layer}.tif"
    if not path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                f"La capa {layer!r} no se generó en esta corrida "
                "(la fuente falló, o todavía no terminó el análisis)."
            ),
        )
    return path


def _build_overlay(base: Path, layer: str, opacity: float, vmin, vmax):
    spec = _spec_or_404(layer)
    da = read_geotiff(_raster_path(base, layer))
    return spec, render_overlay(da, spec, opacity=opacity, vmin=vmin, vmax=vmax)


OpacityQuery = Annotated[float, Query(ge=0.0, le=1.0, description="Alfa del overlay, 0–1.")]
VminQuery = Annotated[
    float | None,
    Query(description="Override del extremo inferior de la rampa (solo capas continuas)."),
]
VmaxQuery = Annotated[
    float | None,
    Query(
        description=(
            "Override del extremo superior. Defaults por capa: pendiente = percentil 98, "
            "NDVI = 1.0 fijo, DEM = máximo real del AOI, costera = max(profundidad, 0.1)."
        )
    ),
]


def _overlay_response(base: Path, analysis_id: str, layer: str, opacity: float, vmin, vmax) -> Response:
    _spec, overlay = _build_overlay(base, layer, opacity, vmin, vmax)
    return Response(
        content=overlay.png,
        media_type="image/png",
        headers={
            # Bounds en la convención de MapLibre: [west, south, east, north].
            "X-Bounds": json.dumps(list(overlay.bounds)),
            "X-Overlay-Coordinates": json.dumps(overlay.coordinates),
            "X-Overlay-Metadata-Url": f"/analysis/{analysis_id}/overlay/{layer}.json",
            "Cache-Control": "public, max-age=3600",
        },
    )


def _overlay_metadata(
    base: Path, png_url: str, layer: str, opacity: float, vmin, vmax
) -> OverlayMetadata:
    spec, overlay = _build_overlay(base, layer, opacity, vmin, vmax)
    return OverlayMetadata(
        layer=layer,  # type: ignore[arg-type]
        bounds=overlay.bounds,
        coordinates=overlay.coordinates,
        width=overlay.width,
        height=overlay.height,
        vmin=overlay.vmin,
        vmax=overlay.vmax,
        opacity=opacity,
        legend_title=spec.legend_title,
        legend=overlay.legend,  # type: ignore[arg-type]
        png_url=png_url,
    )


@app.get(
    "/analysis/{analysis_id}/overlay/{layer}.png",
    tags=["capas"],
    operation_id="getAnalysisOverlay",
    summary="Overlay PNG de una capa, con sus bounds WGS84 en headers",
    description=(
        "PNG RGBA reproyectado a EPSG:4326, listo para `map.addSource({type:'image'})`.\n\n"
        "Los bounds vienen en el header `X-Bounds` como `[west, south, east, north]` y las "
        "4 esquinas ya ordenadas para `ImageSource` en `X-Overlay-Coordinates`. El sidecar "
        "JSON del mismo path (`.json` en vez de `.png`) trae además la leyenda."
    ),
    response_class=Response,
    responses={
        200: {"content": {"image/png": {}}, "description": "El overlay."},
        **NOT_FOUND,
    },
    dependencies=[Depends(require_token)],
)
async def get_analysis_overlay(
    analysis_id: str,
    layer: str,
    store: StoreDep,
    opacity: OpacityQuery = 1.0,
    vmin: VminQuery = None,
    vmax: VmaxQuery = None,
) -> Response:
    _require_job(store, analysis_id)
    return _overlay_response(store.job_dir(analysis_id), analysis_id, layer, opacity, vmin, vmax)


@app.get(
    "/analysis/{analysis_id}/overlay/{layer}.json",
    tags=["capas"],
    operation_id="getAnalysisOverlayMetadata",
    summary="Bounds, rampa y leyenda del overlay (sidecar del PNG)",
    response_model=OverlayMetadata,
    responses=NOT_FOUND,
    dependencies=[Depends(require_token)],
)
async def get_analysis_overlay_metadata(
    analysis_id: str,
    layer: str,
    store: StoreDep,
    opacity: OpacityQuery = 1.0,
    vmin: VminQuery = None,
    vmax: VmaxQuery = None,
) -> OverlayMetadata:
    _require_job(store, analysis_id)
    return _overlay_metadata(
        store.job_dir(analysis_id),
        f"/analysis/{analysis_id}/overlay/{layer}.png",
        layer,
        opacity,
        vmin,
        vmax,
    )


@app.get(
    "/analysis/{analysis_id}/raster/{layer}.tif",
    tags=["capas"],
    operation_id="getAnalysisRaster",
    summary="GeoTIFF recortado al AOI",
    description=(
        "GeoTIFF en la UTM local del AOI, con **compresión DEFLATE** y **tag nodata "
        "explícito** (el export legacy no tenía ninguno de los dos, así que el relleno "
        "de fuera del AOI se abría en QGIS como si fuera dato)."
    ),
    response_class=FileResponse,
    responses={
        200: {"content": {"image/tiff": {}}, "description": "El GeoTIFF."},
        **NOT_FOUND,
    },
    dependencies=[Depends(require_token)],
)
async def get_analysis_raster(analysis_id: str, layer: str, store: StoreDep) -> FileResponse:
    _require_job(store, analysis_id)
    spec = _spec_or_404(layer)
    path = _raster_path(store.job_dir(analysis_id), layer)
    return FileResponse(path, media_type="image/tiff", filename=spec.download_filename)


# ---------------------------------------------------------------------------
# Inundación costera (Aqueduct) — on-demand y cacheada
# ---------------------------------------------------------------------------


@app.get(
    "/coastal/presets",
    tags=["costera"],
    operation_id="listCoastalPresets",
    summary="Los 5 escenarios de inundación costera",
    response_model=PresetsResponse,
)
async def list_coastal_presets() -> PresetsResponse:
    return PresetsResponse(presets=list(aqueduct.PRESET_KEYS))


def _coastal_dir(settings: Settings, cache_key: str) -> Path:
    return settings.coastal_dir / cache_key


@app.post(
    "/coastal",
    tags=["costera"],
    operation_id="computeCoastalFlood",
    summary="Traer (o reusar de caché) la inundación costera de un AOI",
    description=(
        "Cacheado por `(AOI, preset)`: repetir el mismo escenario no vuelve a leer el "
        "GeoTIFF global de WRI. Se puede pasar `analysis_id` (el AOI sale del análisis) "
        "o un `aoi` suelto."
    ),
    response_model=CoastalResponse,
    responses={**NOT_FOUND, 422: {"model": ErrorResponse, "description": "AOI inválido."}},
    dependencies=[Depends(require_token)],
)
async def compute_coastal_flood(
    payload: CoastalRequest, store: StoreDep, request: Request
) -> CoastalResponse:
    settings: Settings = request.app.state.settings

    if payload.analysis_id:
        job = _require_job(store, payload.analysis_id)
        aoi_geojson = job.aoi_geojson or {}
    elif payload.aoi is not None:
        aoi_geojson = payload.aoi.model_dump(mode="json")
    else:
        raise HTTPException(status_code=422, detail="Hay que pasar `analysis_id` o `aoi`.")

    try:
        aoi = load_aoi_from_geojson_dict(aoi_geojson)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    key = coastal_cache_key(aoi, payload.preset)
    target = _coastal_dir(settings, key)
    summary_path = target / "summary.json"
    urls = {
        "overlay_url": f"/coastal/{key}/overlay.png",
        "overlay_metadata_url": f"/coastal/{key}/overlay.json",
        "raster_url": f"/coastal/{key}/raster.tif",
    }

    if summary_path.exists():
        summary = json.loads(summary_path.read_text(encoding="utf-8"))
        return CoastalResponse(
            cache_key=key,
            preset=payload.preset,
            analysis_id=payload.analysis_id,
            cached=True,
            available=True,
            summary=summary,
            **(urls if (target / "coastal.tif").exists() else {}),
        )

    def work() -> dict:
        da = aqueduct.fetch_preset(aoi, payload.preset)
        summary = aqueduct.summarize_coastal_flood(da)
        target.mkdir(parents=True, exist_ok=True)
        if summary.get("has_data"):
            write_geotiff(da, target / "coastal.tif", RASTER_SPECS["coastal"])
        summary_path.write_text(
            json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return summary

    try:
        summary = await asyncio.to_thread(work)
    except Exception as exc:  # noqa: BLE001 — aislamiento por fuente (regresión #3):
        # que WRI esté caído no puede tumbar nada más.
        log.warning("Aqueduct falló para %s: %s", payload.preset, exc, exc_info=True)
        return CoastalResponse(
            cache_key=key,
            preset=payload.preset,
            analysis_id=payload.analysis_id,
            cached=False,
            available=False,
            error=str(exc) or exc.__class__.__name__,
        )

    return CoastalResponse(
        cache_key=key,
        preset=payload.preset,
        analysis_id=payload.analysis_id,
        cached=False,
        available=True,
        summary=summary,
        **(urls if summary.get("has_data") else {}),
    )


@app.get(
    "/coastal/{cache_key}/overlay.png",
    tags=["costera"],
    operation_id="getCoastalOverlay",
    summary="Overlay PNG de la inundación costera",
    response_class=Response,
    responses={200: {"content": {"image/png": {}}}, **NOT_FOUND},
    dependencies=[Depends(require_token)],
)
async def get_coastal_overlay(
    cache_key: str,
    request: Request,
    opacity: OpacityQuery = 1.0,
    vmin: VminQuery = None,
    vmax: VmaxQuery = None,
) -> Response:
    settings: Settings = request.app.state.settings
    base = _coastal_dir(settings, cache_key)
    if not (base / "coastal.tif").exists():
        raise HTTPException(
            status_code=404,
            detail="No hay raster costero para esa clave (pedilo primero con POST /coastal).",
        )
    _, overlay = _build_overlay_coastal(base, opacity, vmin, vmax)
    return Response(
        content=overlay.png,
        media_type="image/png",
        headers={
            "X-Bounds": json.dumps(list(overlay.bounds)),
            "X-Overlay-Coordinates": json.dumps(overlay.coordinates),
            "X-Overlay-Metadata-Url": f"/coastal/{cache_key}/overlay.json",
            "Cache-Control": "public, max-age=3600",
        },
    )


def _build_overlay_coastal(base: Path, opacity: float, vmin, vmax):
    spec = RASTER_SPECS["coastal"]
    da = read_geotiff(base / "coastal.tif")
    return spec, render_overlay(da, spec, opacity=opacity, vmin=vmin, vmax=vmax)


@app.get(
    "/coastal/{cache_key}/overlay.json",
    tags=["costera"],
    operation_id="getCoastalOverlayMetadata",
    summary="Bounds y leyenda del overlay costero",
    response_model=OverlayMetadata,
    responses=NOT_FOUND,
    dependencies=[Depends(require_token)],
)
async def get_coastal_overlay_metadata(
    cache_key: str,
    request: Request,
    opacity: OpacityQuery = 1.0,
    vmin: VminQuery = None,
    vmax: VmaxQuery = None,
) -> OverlayMetadata:
    settings: Settings = request.app.state.settings
    base = _coastal_dir(settings, cache_key)
    if not (base / "coastal.tif").exists():
        raise HTTPException(status_code=404, detail="No hay raster costero para esa clave.")
    spec, overlay = _build_overlay_coastal(base, opacity, vmin, vmax)
    return OverlayMetadata(
        layer="coastal",
        bounds=overlay.bounds,
        coordinates=overlay.coordinates,
        width=overlay.width,
        height=overlay.height,
        vmin=overlay.vmin,
        vmax=overlay.vmax,
        opacity=opacity,
        legend_title=spec.legend_title,
        legend=overlay.legend,  # type: ignore[arg-type]
        png_url=f"/coastal/{cache_key}/overlay.png",
    )


@app.get(
    "/coastal/{cache_key}/raster.tif",
    tags=["costera"],
    operation_id="getCoastalRaster",
    summary="GeoTIFF de la inundación costera",
    response_class=FileResponse,
    responses={200: {"content": {"image/tiff": {}}}, **NOT_FOUND},
    dependencies=[Depends(require_token)],
)
async def get_coastal_raster(cache_key: str, request: Request) -> FileResponse:
    settings: Settings = request.app.state.settings
    path = _coastal_dir(settings, cache_key) / "coastal.tif"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No hay raster costero para esa clave.")
    return FileResponse(
        path, media_type="image/tiff", filename=RASTER_SPECS["coastal"].download_filename
    )


@app.exception_handler(ValueError)
async def value_error_handler(_request: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


__all__ = ["app"]
