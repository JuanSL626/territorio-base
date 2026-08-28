"""Configuración por variables de entorno (sin dependencias extra)."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path


def _bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on", "si", "sí")


def _int(name: str, default: int) -> int:
    raw = os.environ.get(name)
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


@dataclass(frozen=True)
class Settings:
    data_dir: Path
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:3000"])
    max_concurrent_jobs: int = 2
    job_ttl_hours: int = 72
    #  Token interno opcional: si está seteado, todo endpoint que no sea /healthz
    #  exige `Authorization: Bearer <token>`. El servicio es interno (lo llama el
    #  SSR de TanStack Start), no público.
    api_token: str | None = None
    debug: bool = False

    @property
    def analyses_dir(self) -> Path:
        return self.data_dir / "analyses"

    @property
    def coastal_dir(self) -> Path:
        return self.data_dir / "coastal"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    data_dir = Path(os.environ.get("TERRITORIO_DATA_DIR", "./data")).expanduser().resolve()
    origins_raw = os.environ.get("TERRITORIO_CORS_ORIGINS", "http://localhost:3000")
    return Settings(
        data_dir=data_dir,
        cors_origins=[o.strip() for o in origins_raw.split(",") if o.strip()],
        max_concurrent_jobs=_int("TERRITORIO_MAX_CONCURRENT_JOBS", 2),
        job_ttl_hours=_int("TERRITORIO_JOB_TTL_HOURS", 72),
        api_token=os.environ.get("TERRITORIO_API_TOKEN") or None,
        debug=_bool("TERRITORIO_DEBUG", False),
    )
