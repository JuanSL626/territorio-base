"""Pruebas offline del contrato de teledetección y de la frontera de secretos."""

from __future__ import annotations

import datetime as dt
import json
from pathlib import Path

import pytest

from territorio_base_api.models import RemoteSensingScene
from territorio_base_api.aoi import load_aoi_from_geojson_dict
from territorio_base_api.sources import remote_sensing as rs


CHECKED = dt.datetime(2026, 9, 19, 12, tzinfo=dt.timezone.utc)
FIXTURE = Path(__file__).parent / "fixtures" / "remote_sources_pilot.json"


def _scene(scene_id: str, acquired: str, cloud: float) -> RemoteSensingScene:
    return RemoteSensingScene(
        source="fixture",
        mission="Sentinel-2",
        sensor="MSI",
        collection="sentinel-2-l2a",
        product_level="L2A",
        scene_id=scene_id,
        acquisition_datetime=acquired,
        last_checked_at="2026-09-19T12:00:00Z",
        cloud_cover_pct=cloud,
        cloud_validity="valid" if cloud <= 30 else "cloudy",
    )


def test_lista_exactamente_las_seis_fuentes(client) -> None:
    response = client.get("/remote-sensing/pilot/sources")
    assert response.status_code == 200
    rows = response.json()["sources"]
    assert {row["source"] for row in rows} == {
        "planetary-computer-sentinel-2-l2a",
        "cdse-sentinel-2-l2a",
        "cdse-sentinel-1-grd",
        "usgs-m2m-landsat-9-c2-l2",
        "nasa-earthdata-viirs-nrt",
        "nasa-gibs-wmts",
    }
    usgs = next(row for row in rows if row["source"].startswith("usgs"))
    assert usgs["credentials_required"] == [
        "TERRITORIO_USGS_M2M_USERNAME",
        "TERRITORIO_USGS_M2M_TOKEN",
    ]


def test_fixture_real_saneado_cubre_todas_las_fuentes() -> None:
    fixture = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert {row["source"] for row in fixture["sources"]} == set(rs.ADAPTERS)
    assert all(row["scene_id"] is not None for row in fixture["sources"])
    serialized = json.dumps(fixture)
    assert "?" not in serialized
    assert "Bearer " not in serialized


def test_url_firmada_nunca_cruza_el_contrato() -> None:
    assert (
        rs.safe_remote_url("https://example.test/B04.tif?sig=secreto&token=otro#fragmento")
        == "https://example.test/B04.tif"
    )


def test_temporalidad_distingue_ultima_nublada_y_ultima_valida() -> None:
    adapter = rs.CdseSentinel2Adapter()
    scenes = [
        _scene("reciente-nublada", "2026-09-19T10:00:00Z", 88),
        _scene("anterior-valida", "2026-09-17T10:00:00Z", 4),
    ]
    state = rs._build_temporal_state(adapter, scenes, CHECKED)
    assert state.status == "cloudy"
    assert state.last_scene_available.scene_id == "reciente-nublada"
    assert state.last_valid_cloud_free_scene.scene_id == "anterior-valida"
    assert state.last_scene_used.scene_id == "anterior-valida"
    assert state.observation_age_hours == 50.0


def test_sentinel1_es_alternativa_sar_no_optica() -> None:
    adapter = rs.CdseSentinel1Adapter()
    scene = _scene("s1", "2026-09-19T10:00:00Z", 99).model_copy(
        update={"mission": "Sentinel-1", "sensor": "C-SAR", "cloud_validity": "valid"}
    )
    state = rs._build_temporal_state(adapter, [scene], CHECKED)
    assert state.status == "updated"
    assert state.last_valid_cloud_free_scene is None
    assert "NDVI" in adapter.purpose


def test_stac_normaliza_campos_y_no_inventa_resolucion_radiometrica(monkeypatch) -> None:
    collection = {
        "license": "proprietary",
        "links": [{"rel": "license", "href": "https://license.test/legal"}],
        "summaries": {
            "eo:bands": [
                {
                    "name": "B04",
                    "common_name": "red",
                    "center_wavelength": 0.665,
                    "full_width_half_max": 0.038,
                }
            ]
        },
    }
    feature = {
        "id": "S2_FIXTURE_20260919",
        "properties": {
            "datetime": "2026-09-19T10:00:00Z",
            "created": "2026-09-19T11:00:00Z",
            "eo:cloud_cover": 5.5,
            "proj:epsg": 32619,
            "proj:shape": [10980, 10980],
        },
        "assets": {
            "B04": {
                "href": "https://assets.test/B04.tif?sig=nunca-persistir",
                "type": "image/tiff; application=geotiff; profile=cloud-optimized",
                "file:size": 123456,
                "gsd": 10,
                "raster:bands": [{"data_type": "uint16"}],
            },
            "thumbnail": {"href": "https://assets.test/thumb.jpg?token=nunca"},
        },
    }

    def fake_json(method, url, **kwargs):
        return collection if "/collections/" in url else {"features": [feature]}

    monkeypatch.setattr(rs, "_request_json", fake_json)
    scenes, preview, _limits = rs.CdseSentinel2Adapter().fetch(
        (-70, 18, -69, 19), CHECKED - dt.timedelta(days=2), CHECKED, 30, CHECKED
    )
    scene = scenes[0]
    asset = next(row for row in scene.assets if row.key == "B04")
    assert scene.cloud_validity == "valid"
    assert scene.total_band_count == 1
    assert scene.spectral_range_um == pytest.approx((0.646, 0.684))
    assert asset.file_size_bytes == 123456
    assert asset.raster_dimensions_px == (10980, 10980)
    assert asset.epsg == 32619
    assert asset.data_type == "uint16"
    assert asset.effective_radiometric_resolution_bits is None
    assert asset.href == "https://assets.test/B04.tif"
    assert preview == "https://assets.test/thumb.jpg"


def test_usgs_sin_token_devuelve_estado_explicito_y_cache_sin_secretos(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.delenv("TERRITORIO_USGS_M2M_TOKEN", raising=False)
    monkeypatch.delenv("TERRITORIO_USGS_M2M_USERNAME", raising=False)
    result = rs.inspect_source(
        source="usgs-m2m-landsat-9-c2-l2",
        bbox=(-69.95, 18.45, -69.90, 18.50),
        lookback_days=21,
        max_cloud_cover=30,
        cache_dir=tmp_path,
        cache_hours=6,
    )
    assert result.temporal.status == "credentials_required"
    assert result.credentials_required == [
        "TERRITORIO_USGS_M2M_USERNAME",
        "TERRITORIO_USGS_M2M_TOKEN",
    ]
    stored = json.loads((tmp_path / f"{result.cache_key}.json").read_text(encoding="utf-8"))
    serialized = json.dumps(stored)
    assert "sig=" not in serialized
    assert "Bearer " not in serialized


def test_usgs_intercambia_application_token_por_api_key_solo_en_memoria(monkeypatch) -> None:
    monkeypatch.setenv("TERRITORIO_USGS_M2M_USERNAME", "usuario-fixture")
    monkeypatch.setenv("TERRITORIO_USGS_M2M_TOKEN", "application-token-fixture")
    calls = []

    def fake_json(method, url, **kwargs):
        calls.append((url, kwargs))
        if url.endswith("login-token"):
            assert kwargs["payload"] == {
                "username": "usuario-fixture",
                "token": "application-token-fixture",
            }
            return {"errorCode": None, "data": "api-key-temporal-fixture"}
        assert kwargs["headers"] == {"X-Auth-Token": "api-key-temporal-fixture"}
        return {
            "errorCode": None,
            "data": {
                "results": [
                    {
                        "displayId": "LC09_FIXTURE",
                        "temporalCoverage": {
                            "startDate": "2026-09-18 00:00:00",
                            "endDate": "2026-09-18 23:59:59",
                        },
                        "cloudCover": 3,
                    }
                ]
            },
        }

    monkeypatch.setattr(rs, "_request_json", fake_json)
    scenes, _preview, _limits = rs.UsgsM2MAdapter().fetch(
        (-70, 18, -69, 19), CHECKED - dt.timedelta(days=30), CHECKED, 30, CHECKED
    )
    assert scenes[0].scene_id == "LC09_FIXTURE"
    assert scenes[0].acquisition_datetime == "2026-09-18 00:00:00"
    assert "api-key-temporal-fixture" not in scenes[0].model_dump_json()
    assert len(calls) == 2


def test_cache_incluye_aoi_fuente_coleccion_fecha_y_algoritmo() -> None:
    key = rs.cache_key(
        (-69.95, 18.45, -69.90, 18.50),
        "cdse-sentinel-2-l2a",
        "sentinel-2-l2a",
        dt.date(2026, 9, 19),
    )
    assert len(key) == 32
    assert key != rs.cache_key(
        (-69.96, 18.45, -69.90, 18.50),
        "cdse-sentinel-2-l2a",
        "sentinel-2-l2a",
        dt.date(2026, 9, 19),
    )


def test_usgs_selecciona_descargas_individuales_sin_ids_hardcodeados() -> None:
    selected = rs.UsgsM2MAdapter()._select_band_options(
        [
            {
                "productName": "Product Bundle",
                "secondaryDownloads": [
                    {"id": "dynamic-red", "available": True, "fileName": "x_SR_B4.TIF"},
                    {"id": "dynamic-nir", "available": True, "fileName": "x_SR_B5.TIF"},
                    {"id": "dynamic-qa", "available": True, "fileName": "x_QA_PIXEL.TIF"},
                ],
            }
        ]
    )
    assert {role: option["id"] for role, option in selected.items()} == {
        "SR_B4": "dynamic-red",
        "SR_B5": "dynamic-nir",
        "QA_PIXEL": "dynamic-qa",
    }


def test_landsat_pilot_informa_aprobacion_m2m_pendiente_sin_filtrar_secretos(
    tmp_path, monkeypatch
) -> None:
    monkeypatch.setenv("TERRITORIO_USGS_M2M_USERNAME", "usuario-fixture")
    monkeypatch.setenv("TERRITORIO_USGS_M2M_TOKEN", "token-super-secreto")

    def access_required(*args, **kwargs):
        raise rs.AccessRequired("no aprobado")

    monkeypatch.setattr(rs.UsgsM2MAdapter, "request_ndvi_assets", access_required)
    aoi = load_aoi_from_geojson_dict(
        {
            "type": "Polygon",
            "coordinates": [
                [[-69.95, 18.45], [-69.9, 18.45], [-69.9, 18.5], [-69.95, 18.5], [-69.95, 18.45]]
            ],
        }
    )
    result = rs.run_usgs_landsat_pilot(
        aoi=aoi,
        lookback_days=90,
        max_cloud_cover=30,
        cache_dir=tmp_path,
        cache_hours=6,
    )
    assert result.status == "access_required"
    stored = (tmp_path / "landsat" / result.cache_key / "metadata.json").read_text()
    assert "token-super-secreto" not in stored
    assert "https://" not in stored


def test_endpoint_landsat_delega_a_workflow(client, monkeypatch) -> None:
    expected = rs.LandsatPilotResult(
        status="access_required",
        message="Pendiente",
        cached=False,
        cache_key="a" * 32,
        checked_at="2026-09-19T12:00:00Z",
    )
    monkeypatch.setattr(rs, "run_usgs_landsat_pilot", lambda **kwargs: expected)
    response = client.post(
        "/remote-sensing/pilot/landsat",
        json={
            "aoi": {
                "type": "Polygon",
                "coordinates": [
                    [
                        [-69.95, 18.45],
                        [-69.9, 18.45],
                        [-69.9, 18.5],
                        [-69.95, 18.5],
                        [-69.95, 18.45],
                    ]
                ],
            }
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "access_required"


def test_ruta_landsat_rechaza_clave_invalida(client) -> None:
    response = client.get("/remote-sensing/pilot/landsat/../../etc/passwd/preview.png")
    assert response.status_code in {404, 405}


@pytest.mark.network
@pytest.mark.parametrize(
    "source",
    [
        "planetary-computer-sentinel-2-l2a",
        "cdse-sentinel-2-l2a",
        "cdse-sentinel-1-grd",
        "nasa-earthdata-viirs-nrt",
        "nasa-gibs-wmts",
    ],
)
def test_fuentes_publicas_devuelven_un_dato_real(source, tmp_path) -> None:
    result = rs.inspect_source(
        source=source,
        bbox=(-69.95, 18.45, -69.90, 18.50),
        lookback_days=30,
        max_cloud_cover=30,
        cache_dir=tmp_path,
        cache_hours=0,
    )
    assert result.temporal.status not in {"provider_error", "credentials_required", "no_valid_data"}
    assert result.temporal.last_scene_available is not None
    assert result.temporal.last_scene_available.scene_id != "unknown"
