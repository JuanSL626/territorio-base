"""Configuración común de la suite.

`TERRITORIO_DATA_DIR` se setea ANTES de importar nada del paquete, porque
`config.get_settings()` está cacheada y `main.py` la lee al importarse (para el CORS).
"""

from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path

import pytest

_TMP_DATA_DIR = Path(tempfile.mkdtemp(prefix="territorio-tests-"))
os.environ.setdefault("TERRITORIO_DATA_DIR", str(_TMP_DATA_DIR))
os.environ.setdefault("TERRITORIO_CORS_ORIGINS", "http://localhost:3000")
os.environ.pop("TERRITORIO_API_TOKEN", None)

FIXTURES = Path(__file__).parent / "fixtures"
AOI_DIR = FIXTURES / "aoi"

AOI_NAMES = (
    "santo-domingo-urbano",
    "cordillera-central",
    "cruce-72w",
    "borde-tile-dem",
    "multipolygon-con-hueco",
)


def load_aoi_geojson(name: str) -> dict:
    return json.loads((AOI_DIR / f"{name}.geojson").read_text(encoding="utf-8"))


@pytest.fixture(scope="session")
def expected() -> dict:
    return json.loads((FIXTURES / "expected.json").read_text(encoding="utf-8"))


@pytest.fixture(params=AOI_NAMES)
def aoi_name(request: pytest.FixtureRequest) -> str:
    return request.param


@pytest.fixture
def data_dir() -> Path:
    return _TMP_DATA_DIR


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from territorio_base_api.main import app

    with TestClient(app) as test_client:
        yield test_client
