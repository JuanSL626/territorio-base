"""Store de jobs: persistencia al volumen y recuperación tras un reinicio."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from territorio_base_api.config import Settings
from territorio_base_api.jobs import INTERRUPTED_MESSAGE, Job, JobStore


@pytest.fixture
def store(tmp_path: Path) -> JobStore:
    return JobStore(Settings(data_dir=tmp_path, job_ttl_hours=72))


def test_create_persiste_al_disco(store: JobStore) -> None:
    job = store.create({"type": "Polygon", "coordinates": []}, {"lookback_days": 180})
    guardado = json.loads((store.job_dir(job.id) / "job.json").read_text(encoding="utf-8"))
    assert guardado["id"] == job.id
    assert guardado["status"] == "pending"


def test_reinicio_recupera_los_terminados_y_aborta_los_que_estaban_corriendo(
    store: JobStore,
) -> None:
    """Un job 'running' que sobrevive a un reinicio no puede quedar corriendo para siempre."""
    listo = store.create({"type": "Polygon"}, {})
    listo.status = "ok"
    listo.result = {"aoi": {"area_ha": 1.0}}
    store.persist(listo)

    a_medias = store.create({"type": "Polygon"}, {})
    a_medias.status = "running"
    store.persist(a_medias)

    nuevo = JobStore(store.settings)
    assert nuevo.load_from_disk() == 2

    assert nuevo.get(listo.id).status == "ok"
    abortado = nuevo.get(a_medias.id)
    assert abortado.status == "error"
    assert abortado.error == INTERRUPTED_MESSAGE
    assert abortado.finished_at is not None


def test_job_json_ilegible_no_tumba_el_arranque(store: JobStore, tmp_path: Path) -> None:
    roto = tmp_path / "analyses" / "roto"
    roto.mkdir(parents=True)
    (roto / "job.json").write_text("{ no es json", encoding="utf-8")
    bueno = store.create({"type": "Polygon"}, {})
    bueno.status = "ok"
    store.persist(bueno)

    nuevo = JobStore(store.settings)
    assert nuevo.load_from_disk() == 1
    assert nuevo.get(bueno.id) is not None


def test_purge_borra_los_jobs_vencidos_y_sus_rasters(tmp_path: Path) -> None:
    store = JobStore(Settings(data_dir=tmp_path, job_ttl_hours=1))
    viejo = store.create({"type": "Polygon"}, {})
    viejo.created_at = "2020-01-01T00:00:00+00:00"
    viejo.status = "ok"
    store.persist(viejo)
    (store.job_dir(viejo.id) / "dem.tif").write_bytes(b"II*\x00")
    nuevo_job = store.create({"type": "Polygon"}, {})

    assert store.purge_expired() == 1
    assert store.get(viejo.id) is None
    assert not store.job_dir(viejo.id).exists()
    assert store.get(nuevo_job.id) is not None


def test_in_flight_cuenta_solo_los_no_terminales(store: JobStore) -> None:
    a = store.create({"type": "Polygon"}, {})
    b = store.create({"type": "Polygon"}, {})
    b.status = "ok"
    assert store.in_flight == 1
    a.status = "error"
    assert store.in_flight == 0


def test_roundtrip_del_dict_serializado() -> None:
    job = Job(id="abc", status="partial", error="NDVI caído")
    job.progress.append({"step": 1, "total": 4, "message": "hola", "at": "2026-01-01T00:00:00+00:00"})
    vuelto = Job.from_dict(job.to_dict())
    assert vuelto.id == "abc"
    assert vuelto.status == "partial"
    assert vuelto.error == "NDVI caído"
    assert vuelto.progress == job.progress
