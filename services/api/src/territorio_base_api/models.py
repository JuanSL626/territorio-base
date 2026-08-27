"""Contrato HTTP del servicio raster.

Estos modelos son la fuente de la que se genera el cliente TypeScript
(`packages/api-client`), así que la calidad del esquema importa tanto como la del
código: todo campo lleva descripción y ejemplo, y los nombres espejan
`docs/migration/00-legacy-inventory.md` §3 (contrato de datos de `run_analysis`).

Dos reglas del inventario que se preservan tal cual:

1. **`available` no es "no encontré nada".** Distingue "el servicio no respondió"
   de "consulté y el resultado es cero". La UI pinta banners distintos para cada
   caso, así que el booleano tiene que viajar aparte del dato.
2. **`worldcover_landcover_pct` es DISPERSO.** Las clases con 0 % se omiten; no
   aparecen con valor 0.0.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from territorio_base_api.sources.aqueduct import PRESET_KEYS

AnalysisStatus = Literal["pending", "running", "ok", "partial", "error"]
OverlayLayer = Literal["dem", "slope", "aspect", "ndvi", "ndvi_density", "worldcover", "coastal"]
RasterLayer = OverlayLayer
CoastalPreset = Literal[
    "Hoy (histórico) — 100 años de retorno",
    "2050 · RCP4.5 (optimista) — 100 años",
    "2050 · RCP8.5 (pesimista) — 100 años",
    "2080 · RCP8.5 (pesimista) — 100 años",
    "2080 · RCP8.5 (pesimista) — 1000 años (extremo)",
]

# Falla ruidosamente si alguien edita PRESETS sin actualizar el Literal de arriba:
# el selectbox de la UI y el esquema OpenAPI tienen que coincidir exactamente.
assert set(PRESET_KEYS) == set(CoastalPreset.__args__), (
    "Los presets de Aqueduct y el Literal CoastalPreset divergieron."
)


class ErrorResponse(BaseModel):
    """Cuerpo de error uniforme."""

    detail: str = Field(description="Mensaje en español, apto para mostrar al usuario.")


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    version: str
    jobs_in_flight: int = Field(description="Análisis corriendo en este proceso ahora mismo.")


class AoiGeometry(BaseModel):
    """GeoJSON del AOI. Se acepta Geometry, Feature o FeatureCollection."""

    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "example": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-69.94, 18.47],
                        [-69.93, 18.47],
                        [-69.93, 18.48],
                        [-69.94, 18.48],
                        [-69.94, 18.47],
                    ]
                ],
            }
        },
    )

    type: Literal["Polygon", "MultiPolygon", "Feature", "FeatureCollection"]


class AoiInfo(BaseModel):
    area_ha: float = Field(description="Área en hectáreas, calculada en la UTM local del AOI.")
    bbox: tuple[float, float, float, float] = Field(
        description="(lon_min, lat_min, lon_max, lat_max) en WGS84."
    )
    utm_epsg: int = Field(
        description="EPSG de la zona UTM usada para áreas y distancias (ej. 32619).", examples=[32619]
    )


class TopographySummary(BaseModel):
    """Idéntico a `topography.summary` del contrato legacy."""

    elevation_min_m: float
    elevation_max_m: float
    elevation_mean_m: float
    elevation_range_m: float = Field(description="max - min.")
    slope_mean_pct: float = Field(
        description="PORCENTAJE de pendiente (rise/run × 100), NO grados."
    )
    slope_max_pct: float = Field(description="Porcentaje de pendiente, no grados.")
    slope_class_pct: dict[str, float] = Field(
        description=(
            "Porcentajes 0–100 por clase, ya escalados. Las claves son las etiquetas "
            "exactas en español y llegan en orden de inserción."
        ),
        examples=[
            {
                "Plano (0-5%)": 42.1,
                "Suave (5-15%)": 31.4,
                "Moderado (15-30%)": 18.0,
                "Fuerte (>30%)": 8.5,
            }
        ],
    )


class TopographyResult(BaseModel):
    available: bool = Field(
        description="False = no se pudo consultar la fuente. Distinto de 'no hay datos'."
    )
    error: str | None = Field(default=None, description="Motivo en español si available=False.")
    summary: TopographySummary | None = None


class VegetationSummary(BaseModel):
    """Idéntico a `vegetation.summary` del legacy, con los campos anulables.

    NDVI (Sentinel-2) y WorldCover son fuentes independientes: si una se cae, la
    otra igual reporta. Por eso los campos son opcionales — el legacy no podía
    representar ese estado porque un fallo tiraba abajo el análisis entero.
    """

    ndvi_mean: float | None = Field(default=None, description="-1..1")
    ndvi_median: float | None = None
    ndvi_p90: float | None = None
    ndvi_density_class_pct: dict[str, float] | None = Field(
        default=None,
        description="Porcentajes 0–100 por clase de densidad; suman ~100.",
        examples=[
            {
                "Sin vegetación / suelo desnudo o agua": 0.6,
                "Vegetación dispersa / matorral bajo": 2.2,
                "Vegetación densa / bosque secundario": 12.4,
                "Vegetación muy densa / dosel maduro": 84.8,
            }
        ],
    )
    worldcover_tree_cover_pct: float | None = Field(
        default=None, description="% de píxeles con código 10 (cobertura arbórea)."
    )
    worldcover_landcover_pct: dict[str, float] | None = Field(
        default=None,
        description=(
            "DISPERSO: solo las clases con porcentaje > 0. Una clase ausente NO "
            "aparece con 0.0, directamente no está."
        ),
        examples=[{"Área construida": 61.2, "Pastizal": 21.4, "Bosque / cobertura arbórea": 7.3}],
    )


class VegetationResult(BaseModel):
    available: bool = Field(description="True si al menos una de las dos fuentes respondió.")
    ndvi_available: bool
    worldcover_available: bool
    error: str | None = Field(default=None, description="Solo si fallaron las dos fuentes.")
    ndvi_error: str | None = None
    worldcover_error: str | None = None
    summary: VegetationSummary | None = None


class Provenance(BaseModel):
    """Qué se usó realmente en esta corrida (alimenta la tabla 'Fuentes y metodología')."""

    dem_source: str | None = None
    dem_item_count: int | None = Field(
        default=None,
        description=(
            "Ítems STAC mosaiqueados para el DEM. > 1 significa que el AOI cruza una "
            "costura de tiles de 1°×1° de Copernicus."
        ),
    )
    sentinel2_scene_count: int | None = None
    sentinel2_scene_ids: list[str] | None = None
    sentinel2_boa_offsets_applied: list[float] | None = Field(
        default=None,
        description=(
            "Offsets BOA_ADD_OFFSET (en DN) aplicados por escena antes del NDVI. "
            "[-1000.0] es lo esperable para baseline >= 04.00. Ver corrección H1."
        ),
    )
    sentinel2_lookback_days: int | None = None
    sentinel2_max_cloud_cover: int | None = None
    worldcover_epoch_year: int | None = Field(
        default=None, description="Época única seleccionada (corrección H2). Nunca es una mezcla."
    )


class LayerAvailability(BaseModel):
    layer: RasterLayer
    kind: Literal["continuous", "categorical"]
    label: str
    default_opacity: float
    available: bool
    overlay_url: str | None = None
    overlay_metadata_url: str | None = None
    raster_url: str | None = None
    download_filename: str


class AnalysisResult(BaseModel):
    aoi: AoiInfo
    topography: TopographyResult
    vegetation: VegetationResult
    provenance: Provenance
    layers: list[LayerAvailability] = Field(
        description="Solo se listan las capas que esta corrida produjo de verdad."
    )


class ProgressEvent(BaseModel):
    step: int = Field(description="Índice 1-based del paso.")
    total: int = Field(
        description="Pasos totales: 3 descargas + el «Análisis completo» final.", examples=[4]
    )
    message: str = Field(
        description="Texto en español, el mismo que mostraba la app legacy.",
        examples=["Descargando DEM (Copernicus GLO-30)…"],
    )
    at: str = Field(description="Timestamp ISO-8601 UTC.")


class AnalysisJob(BaseModel):
    id: str
    status: AnalysisStatus = Field(
        description=(
            "pending/running mientras corre; 'ok' si todas las fuentes respondieron; "
            "'partial' si alguna falló pero hay resultado; 'error' si no hay nada utilizable."
        )
    )
    created_at: str
    started_at: str | None = None
    finished_at: str | None = None
    aoi: AoiInfo | None = None
    progress: list[ProgressEvent] = Field(default_factory=list)
    error: str | None = None
    result: AnalysisResult | None = None
    events_url: str
    self_url: str


class AnalysisRequest(BaseModel):
    aoi: AoiGeometry
    ndvi_resolution_m: int = Field(
        default=10,
        ge=10,
        le=60,
        description="Resolución del compuesto Sentinel-2. Subir a 20 m para AOIs grandes.",
    )
    lookback_days: int = Field(default=180, ge=30, le=730)
    max_cloud_cover: int = Field(default=30, ge=0, le=100)


class LegendEntry(BaseModel):
    label: str
    color: str = Field(description="Hex #rrggbb.")
    value: float | None = Field(default=None, description="Solo en rampas continuas.")
    code: int | None = Field(default=None, description="Solo en capas categóricas.")


class OverlayMetadata(BaseModel):
    """Sidecar del PNG: lo que MapLibre necesita para posicionarlo."""

    layer: RasterLayer
    bounds: tuple[float, float, float, float] = Field(
        description="(west, south, east, north) en EPSG:4326."
    )
    coordinates: list[list[float]] = Field(
        description="Las 4 esquinas en el orden de `ImageSource`: TL, TR, BR, BL."
    )
    width: int
    height: int
    vmin: float | None = None
    vmax: float | None = None
    opacity: float
    legend_title: str
    legend: list[LegendEntry]
    png_url: str


class CoastalSummary(BaseModel):
    """Idéntico a `summarize_coastal_flood` del legacy."""

    has_data: bool = Field(description="False = el AOI está fuera de la cobertura de Aqueduct.")
    resolution_m_approx: float | None = None
    pct_area_flooded: float | None = None
    max_depth_m: float | None = None
    mean_depth_where_flooded_m: float | None = None


class CoastalRequest(BaseModel):
    preset: CoastalPreset = Field(description="Una de las 5 claves exactas del selectbox.")
    analysis_id: str | None = Field(
        default=None, description="Si se pasa, el AOI se toma del análisis y el resultado se adjunta a él."
    )
    aoi: AoiGeometry | None = Field(
        default=None, description="Requerido si no se pasa analysis_id."
    )


class CoastalResponse(BaseModel):
    cache_key: str = Field(description="Clave de caché (aoi, preset). Repetir la consulta no recomputa.")
    preset: CoastalPreset
    analysis_id: str | None = None
    cached: bool = Field(description="True si se sirvió desde caché.")
    available: bool = Field(description="False = el servicio de Aqueduct no respondió.")
    error: str | None = None
    summary: CoastalSummary | None = None
    overlay_url: str | None = None
    overlay_metadata_url: str | None = None
    raster_url: str | None = None


class PresetsResponse(BaseModel):
    presets: list[str] = Field(description="Las 5 claves exactas, en el orden del selectbox legacy.")
