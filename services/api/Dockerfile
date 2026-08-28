# syntax=docker/dockerfile:1.9
#
# Servicio raster de Territorio Base.
#
# Base Debian (bookworm-slim), NO Alpine: rasterio/pyproj/shapely publican wheels
# manylinux contra glibc. Con musl habría que compilar GDAL y PROJ a mano —
# `01-engine-decision-memo.md` marca esto explícitamente y el devcontainer del repo
# ya era `python:1-3.11-bookworm`.

# ---------------------------------------------------------------------------
# Etapa 1 — dependencias
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

WORKDIR /app

# Capa cacheable: las dependencias solo se reinstalan si cambia el lockfile.
# `--frozen` falla si pyproject.toml y uv.lock divergieron — regresión #9 del
# inventario (drift entre lockfile y dependencias desplegadas).
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --frozen --no-install-project --no-dev

COPY pyproject.toml uv.lock README.md ./
COPY src/ ./src/

RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ---------------------------------------------------------------------------
# Etapa 2 — runtime
# ---------------------------------------------------------------------------
FROM python:3.11-slim-bookworm AS runtime

# curl para el HEALTHCHECK; ca-certificates para HTTPS contra Planetary Computer y WRI.
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 territorio \
    && useradd --system --uid 10001 --gid territorio --create-home territorio

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    TERRITORIO_DATA_DIR=/data \
    # GDAL leyendo COGs remotos por HTTP: sin esto cada lectura por ventana
    # reabre la conexión y el pipeline se va al doble de tiempo.
    GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR \
    GDAL_HTTP_MULTIPLEX=YES \
    GDAL_HTTP_VERSION=2 \
    VSI_CACHE=TRUE \
    VSI_CACHE_SIZE=67108864

# NO se setea `CPL_VSIL_CURL_ALLOWED_EXTENSIONS`. Es tentador, y es una trampa:
# los assets de Planetary Computer llegan firmados, con la SAS como query string
# (`…_B04.tif?st=…&se=…&sig=…`), y la comprobación de extensión de GDAL ha
# tropezado históricamente con eso — el resultado sería que TODA lectura remota
# falla, en runtime y sólo contra el servicio real. Además no aporta nada acá:
# el ahorro de peticiones ya lo da `GDAL_DISABLE_READDIR_ON_OPEN=EMPTY_DIR`.

WORKDIR /app

COPY --from=builder --chown=territorio:territorio /app/.venv /app/.venv
COPY --chown=territorio:territorio src/ ./src/

# Volumen de datos: jobs, GeoTIFF y caché de Aqueduct.
RUN mkdir -p /data && chown territorio:territorio /data
VOLUME ["/data"]

USER territorio
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8787/healthz || exit 1

# Un solo worker a propósito: el store de jobs vive en el proceso. Escalar es
# subir `TERRITORIO_MAX_CONCURRENT_JOBS`, no `--workers`, hasta que el store sea
# externo (Redis/DB).
CMD ["uvicorn", "territorio_base_api.main:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1"]
