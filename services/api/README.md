# services/api — Territorio Base, servicio raster

FastAPI + `odc-stac`. Es la mitad **raster** del seam híbrido descrito en
`docs/migration/01-engine-decision-memo.md`: Python es dueño de la grilla de
píxeles y de nada más.

| Es de este servicio | NO es de este servicio |
|---|---|
| STAC + firma SAS de Planetary Computer | Overpass / hidrología |
| Mosaico `odc.stac.load` y recorte al AOI | WDPA / áreas protegidas |
| NDVI (con offset BOA), pendiente/orientación, WorldCover | Catálogo MEPyD |
| WRI Aqueduct (inundación costera) | Parseo de KML/KMZ/GeoJSON subidos |
| Export GeoTIFF (DEFLATE + nodata) y overlays PNG | Export shapefile / ZIP |
| | Render del reporte (Markdown / story-map) |

Todo lo de la columna derecha vive en `packages/geo` y `apps/web`.

## Correr

```bash
uv sync                 # crea services/api/.venv
uv run uvicorn territorio_base_api.main:app --reload --port 8787
# OpenAPI: http://localhost:8787/openapi.json · docs: /docs
```

Variables de entorno (todas opcionales):

| Variable | Default | Para qué |
|---|---|---|
| `TERRITORIO_DATA_DIR` | `./data` | Dónde viven los jobs y sus GeoTIFF. En Docker: `/data`. |
| `TERRITORIO_CORS_ORIGINS` | `http://localhost:3000` | Lista separada por comas. |
| `TERRITORIO_API_TOKEN` | *(vacío)* | Si está seteada, todo menos `/healthz` exige `Authorization: Bearer …`. |
| `TERRITORIO_MAX_CONCURRENT_JOBS` | `2` | Análisis en paralelo. |
| `TERRITORIO_JOB_TTL_HOURS` | `72` | Purga de jobs viejos al arrancar. |

## Tests

```bash
uv run pytest -m "not network"   # subset offline — el que corre en CI
uv run pytest                    # incluye los que golpean PC/WRI de verdad
```

Ver `tests/README.md` para los AOI de aceptación y sus tolerancias.

## Correcciones de corrección heredadas

`docs/migration/04-correctness-fixes.md` documenta H1 (offset BOA de Sentinel-2),
H2 (época de WorldCover) y H3 (máscara compartida elevación/pendiente). Los tests
`tests/test_h1_*.py`, `tests/test_h2_*.py` y `tests/test_h3_*.py` fallan contra el
código viejo a propósito.
