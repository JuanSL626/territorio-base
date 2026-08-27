"""Store de jobs de análisis: dict en proceso + asyncio, persistido al volumen de datos.

El pipeline raster tarda entre 10 y 90 s (Sentinel-2 domina), así que `POST /analysis`
no puede ser síncrono: crea un job, devuelve 202 y el cliente sigue el progreso por
`GET /analysis/{id}/events` (SSE) o por polling de `GET /analysis/{id}`.

Persistencia: cada job vive en `<data_dir>/analyses/<id>/` con su `job.json` y sus
GeoTIFF. Al arrancar se relee el directorio, así que un reinicio del proceso no
pierde resultados ya calculados — solo aborta los que estaban a mitad de camino
(quedan marcados con un error explícito, nunca "corriendo" para siempre).
"""

from __future__ import annotations

import asyncio
import json
import logging
import shutil
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from territorio_base_api.aoi import AOI, load_aoi_from_geojson_dict
from territorio_base_api.config import Settings

log = logging.getLogger(__name__)

_SENTINEL = object()

INTERRUPTED_MESSAGE = (
    "El análisis se interrumpió porque el servicio se reinició. Volvé a lanzarlo."
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Job:
    id: str
    status: str = "pending"
    created_at: str = field(default_factory=_now)
    started_at: str | None = None
    finished_at: str | None = None
    aoi_geojson: dict | None = None
    aoi_info: dict | None = None
    params: dict = field(default_factory=dict)
    progress: list[dict] = field(default_factory=list)
    error: str | None = None
    result: dict | None = None

    #  No se serializan:
    subscribers: list[asyncio.Queue] = field(default_factory=list, repr=False)
    rasters: dict[str, Any] = field(default_factory=dict, repr=False)

    @property
    def terminal(self) -> bool:
        return self.status in ("ok", "partial", "error")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "status": self.status,
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "aoi_geojson": self.aoi_geojson,
            "aoi_info": self.aoi_info,
            "params": self.params,
            "progress": self.progress,
            "error": self.error,
            "result": self.result,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "Job":
        job = cls(id=data["id"])
        for key in (
            "status",
            "created_at",
            "started_at",
            "finished_at",
            "aoi_geojson",
            "aoi_info",
            "params",
            "progress",
            "error",
            "result",
        ):
            if key in data and data[key] is not None:
                setattr(job, key, data[key])
        return job


class JobStore:
    """Store en proceso. Un solo worker: no está pensado para N réplicas."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._jobs: dict[str, Job] = {}
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_jobs)
        self._tasks: set[asyncio.Task] = set()
        settings.analyses_dir.mkdir(parents=True, exist_ok=True)
        settings.coastal_dir.mkdir(parents=True, exist_ok=True)

    # -- persistencia ------------------------------------------------------

    def job_dir(self, job_id: str) -> Path:
        return self.settings.analyses_dir / job_id

    def _job_file(self, job_id: str) -> Path:
        return self.job_dir(job_id) / "job.json"

    def persist(self, job: Job) -> None:
        path = self._job_file(job.id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(job.to_dict(), ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)  # escritura atómica: nunca un job.json a medio escribir

    def load_from_disk(self) -> int:
        loaded = 0
        for path in sorted(self.settings.analyses_dir.glob("*/job.json")):
            try:
                job = Job.from_dict(json.loads(path.read_text(encoding="utf-8")))
            except (OSError, ValueError, KeyError) as exc:
                log.warning("job.json ilegible en %s: %s", path, exc)
                continue
            if not job.terminal:
                job.status = "error"
                job.error = INTERRUPTED_MESSAGE
                job.finished_at = _now()
                self.persist(job)
            self._jobs[job.id] = job
            loaded += 1
        return loaded

    def purge_expired(self) -> int:
        if self.settings.job_ttl_hours <= 0:
            return 0
        cutoff = datetime.now(timezone.utc) - timedelta(hours=self.settings.job_ttl_hours)
        removed = 0
        for job_id, job in list(self._jobs.items()):
            try:
                created = datetime.fromisoformat(job.created_at)
            except ValueError:
                continue
            if created < cutoff:
                self._jobs.pop(job_id, None)
                shutil.rmtree(self.job_dir(job_id), ignore_errors=True)
                removed += 1
        return removed

    # -- API ---------------------------------------------------------------

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def list(self) -> list[Job]:
        return sorted(self._jobs.values(), key=lambda j: j.created_at, reverse=True)

    @property
    def in_flight(self) -> int:
        return sum(1 for j in self._jobs.values() if not j.terminal)

    def create(self, aoi_geojson: dict, params: dict) -> Job:
        job = Job(id=uuid.uuid4().hex[:16], aoi_geojson=aoi_geojson, params=params)
        self._jobs[job.id] = job
        self.persist(job)
        return job

    # -- eventos -----------------------------------------------------------

    def subscribe(self, job: Job) -> asyncio.Queue:
        queue: asyncio.Queue = asyncio.Queue()
        job.subscribers.append(queue)
        return queue

    def unsubscribe(self, job: Job, queue: asyncio.Queue) -> None:
        try:
            job.subscribers.remove(queue)
        except ValueError:
            pass

    def _emit(self, job: Job, event: str, data: dict) -> None:
        payload = {"event": event, "data": data}
        for queue in list(job.subscribers):
            queue.put_nowait(payload)

    def close_stream(self, job: Job) -> None:
        for queue in list(job.subscribers):
            queue.put_nowait(_SENTINEL)

    @staticmethod
    def is_sentinel(item: Any) -> bool:
        return item is _SENTINEL

    # -- ejecución ---------------------------------------------------------

    def launch(
        self,
        job: Job,
        pipeline: Callable[[AOI, Callable[[str], None], dict], dict],
        on_success: Callable[[Job, dict], None],
    ) -> None:
        task = asyncio.create_task(self._run(job, pipeline, on_success), name=f"analysis-{job.id}")
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    async def _run(
        self,
        job: Job,
        pipeline: Callable[[AOI, Callable[[str], None], dict], dict],
        on_success: Callable[[Job, dict], None],
    ) -> None:
        loop = asyncio.get_running_loop()
        total_steps = job.params.get("total_steps", 3)

        def progress(message: str) -> None:
            """Se llama desde el thread del pipeline -> hay que volver al loop."""
            event = {
                "step": len(job.progress) + 1,
                "total": total_steps,
                "message": message,
                "at": _now(),
            }
            job.progress.append(event)
            loop.call_soon_threadsafe(self._emit, job, "progress", event)

        async with self._semaphore:
            job.status = "running"
            job.started_at = _now()
            self.persist(job)
            self._emit(job, "status", {"status": job.status})
            started = time.monotonic()
            try:
                aoi = load_aoi_from_geojson_dict(job.aoi_geojson or {})
                results = await asyncio.to_thread(pipeline, aoi, progress, job.params)
                on_success(job, results)
            except Exception as exc:  # noqa: BLE001 — un job que falla no tumba el proceso
                log.exception("Job %s falló", job.id)
                job.status = "error"
                job.error = str(exc) or exc.__class__.__name__
            finally:
                job.finished_at = _now()
                job.rasters.clear()
                self.persist(job)
                log.info("Job %s terminó en %.1fs con estado %s", job.id, time.monotonic() - started, job.status)
                self._emit(
                    job,
                    "done" if job.status != "error" else "error",
                    {"status": job.status, "error": job.error},
                )
                self.close_stream(job)
