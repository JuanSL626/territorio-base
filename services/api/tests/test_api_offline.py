"""API HTTP sin red: contrato OpenAPI, ciclo de vida del job, SSE y aislamiento de fallas.

El pipeline raster se reemplaza por un doble que escribe GeoTIFF sintéticos, así que
todo esto corre en CI sin tocar Planetary Computer.
"""

from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest

from conftest import load_aoi_geojson
from helpers import dem_with_nan_border, utm_raster
from territorio_base_api.analysis.report import STEP_DEM, STEP_NDVI, STEP_WORLDCOVER
from territorio_base_api.render.palettes import RASTER_SPECS
from territorio_base_api.render.raster_io import write_geotiff

AOI = load_aoi_geojson("santo-domingo-urbano")["geometry"]


# --- doble del pipeline ----------------------------------------------------


def _resumen_topografia() -> dict:
    return {
        "elevation_min_m": 44.5,
        "elevation_max_m": 68.3,
        "elevation_mean_m": 56.0,
        "elevation_range_m": 23.8,
        "slope_mean_pct": 8.3,
        "slope_max_pct": 39.6,
        "slope_class_pct": {
            "Plano (0-5%)": 32.6,
            "Suave (5-15%)": 58.2,
            "Moderado (15-30%)": 7.7,
            "Fuerte (>30%)": 1.5,
        },
    }


def _resumen_vegetacion() -> dict:
    return {
        "ndvi_mean": 0.1,
        "ndvi_median": 0.06,
        "ndvi_p90": 0.25,
        "ndvi_density_class_pct": {
            "Sin vegetación / suelo desnudo o agua": 84.5,
            "Vegetación dispersa / matorral bajo": 12.2,
            "Vegetación densa / bosque secundario": 2.8,
            "Vegetación muy densa / dosel maduro": 0.5,
        },
        "worldcover_tree_cover_pct": 0.7,
        "worldcover_landcover_pct": {"Bosque / cobertura arbórea": 0.7, "Área construida": 99.3},
    }


def fake_pipeline_ok(aoi, progress, params) -> dict:
    job_dir = Path(params["job_dir"])
    for mensaje in (STEP_DEM, STEP_NDVI, STEP_WORLDCOVER):
        progress(mensaje)

    escritas = []
    dem = utm_raster(dem_with_nan_border(np.arange(36, dtype="float64").reshape(6, 6)))
    for capa in ("dem", "slope", "ndvi"):
        write_geotiff(dem, job_dir / f"{capa}.tif", RASTER_SPECS[capa])
        escritas.append(capa)
    codigos = utm_raster(np.array([[10, 50, 50], [10, 10, 0], [50, 50, 10]], dtype="uint8"))
    write_geotiff(codigos, job_dir / "worldcover.tif", RASTER_SPECS["worldcover"])
    escritas.append("worldcover")

    return {
        "aoi": {"area_ha": 23.3681, "bbox": (-69.935, 18.47, -69.93, 18.474), "utm_epsg": 32619},
        "topography": {"available": True, "error": None, "summary": _resumen_topografia()},
        "vegetation": {
            "available": True,
            "ndvi_available": True,
            "worldcover_available": True,
            "error": None,
            "ndvi_error": None,
            "worldcover_error": None,
            "summary": _resumen_vegetacion(),
        },
        "provenance": {"worldcover_epoch_year": 2021, "sentinel2_boa_offsets_applied": [-1000.0]},
        "rasters": {},
        "written_layers": escritas,
    }


def fake_pipeline_ndvi_caido(aoi, progress, params) -> dict:
    resultado = fake_pipeline_ok(aoi, progress, params)
    resultado["vegetation"] = {
        "available": True,
        "ndvi_available": False,
        "worldcover_available": True,
        "error": None,
        "ndvi_error": "No se encontraron escenas Sentinel-2 con poca nubosidad en el rango de fechas.",
        "worldcover_error": None,
        "summary": {
            "ndvi_mean": None,
            "ndvi_median": None,
            "ndvi_p90": None,
            "ndvi_density_class_pct": None,
            "worldcover_tree_cover_pct": 0.7,
            "worldcover_landcover_pct": {"Área construida": 99.3},
        },
    }
    resultado["written_layers"] = [c for c in resultado["written_layers"] if c != "ndvi"]
    (Path(params["job_dir"]) / "ndvi.tif").unlink(missing_ok=True)
    return resultado


def fake_pipeline_explota(aoi, progress, params) -> dict:
    progress(STEP_DEM)
    raise RuntimeError("Planetary Computer devolvió 503.")


def esperar_job(client, job_id: str, timeout: float = 15.0) -> dict:
    limite = time.monotonic() + timeout
    while time.monotonic() < limite:
        cuerpo = client.get(f"/analysis/{job_id}").json()
        if cuerpo["status"] in ("ok", "partial", "error"):
            return cuerpo
        time.sleep(0.05)
    raise AssertionError(f"el job {job_id} no terminó en {timeout}s")


def lanzar(client, monkeypatch, pipeline) -> dict:
    import territorio_base_api.main as main

    monkeypatch.setattr(main, "analysis_pipeline", pipeline)
    respuesta = client.post("/analysis", json={"aoi": AOI})
    assert respuesta.status_code == 202
    return respuesta.json()


# --- salud y OpenAPI -------------------------------------------------------


def test_healthz(client) -> None:
    cuerpo = client.get("/healthz").json()
    assert cuerpo["status"] == "ok"
    assert cuerpo["version"]
    assert cuerpo["jobs_in_flight"] == 0


def test_openapi_tiene_operation_ids_unicos_y_legibles(client) -> None:
    spec = client.get("/openapi.json").json()
    ops = [
        op["operationId"]
        for path in spec["paths"].values()
        for op in path.values()
        if isinstance(op, dict) and "operationId" in op
    ]
    assert len(ops) == len(set(ops)), "operationId duplicado: el cliente TS saldría roto"
    assert "createAnalysis" in ops and "streamAnalysisEvents" in ops
    #  FastAPI genera ids feos por default (`create_analysis_analysis_post`);
    #  si aparece uno así es que alguien agregó una ruta sin operation_id.
    assert all("__" not in op and not op.endswith(("_post", "_get")) for op in ops)


def test_toda_ruta_json_declara_response_model(client) -> None:
    spec = client.get("/openapi.json").json()
    sin_modelo = []
    for path, metodos in spec["paths"].items():
        for metodo, op in metodos.items():
            contenido = op.get("responses", {}).get("200", {}).get("content", {})
            if "application/json" in contenido and "$ref" not in json.dumps(contenido):
                sin_modelo.append(f"{metodo.upper()} {path}")
    assert not sin_modelo, f"rutas sin response_model: {sin_modelo}"


def test_presets_costeros_expuestos(client) -> None:
    presets = client.get("/coastal/presets").json()["presets"]
    assert len(presets) == 5
    assert presets[0] == "Hoy (histórico) — 100 años de retorno"


# --- validación ------------------------------------------------------------


@pytest.mark.parametrize(
    "aoi",
    [
        {"type": "Point", "coordinates": [-69.9, 18.4]},
        {"type": "FeatureCollection", "features": []},
    ],
)
def test_aoi_invalido_da_422(client, aoi: dict) -> None:
    assert client.post("/analysis", json={"aoi": aoi}).status_code == 422


def test_aoi_ausente_da_422(client) -> None:
    assert client.post("/analysis", json={}).status_code == 422


def test_parametros_fuera_de_rango_dan_422(client) -> None:
    assert client.post("/analysis", json={"aoi": AOI, "ndvi_resolution_m": 1}).status_code == 422
    assert client.post("/analysis", json={"aoi": AOI, "max_cloud_cover": 500}).status_code == 422


def test_analisis_inexistente_da_404(client) -> None:
    respuesta = client.get("/analysis/no-existe")
    assert respuesta.status_code == 404
    assert "no-existe" in respuesta.json()["detail"]


# --- ciclo de vida ---------------------------------------------------------


def test_post_analysis_devuelve_202_con_location_y_urls(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    assert job["status"] in ("pending", "running")
    assert job["events_url"] == f"/analysis/{job['id']}/events"
    assert job["self_url"] == f"/analysis/{job['id']}"
    assert job["aoi"]["utm_epsg"] == 32619
    assert job["aoi"]["area_ha"] == pytest.approx(23.3681, abs=1e-3)


def test_job_completo_y_su_resultado(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    final = esperar_job(client, job["id"])

    assert final["status"] == "ok"
    assert final["error"] is None
    assert [p["message"] for p in final["progress"]] == [
        STEP_DEM,
        STEP_NDVI,
        STEP_WORLDCOVER,
    ]
    assert [p["step"] for p in final["progress"]] == [1, 2, 3]

    resultado = final["result"]
    assert resultado["topography"]["available"] is True
    assert resultado["topography"]["summary"]["slope_class_pct"]["Suave (5-15%)"] == 58.2
    assert resultado["vegetation"]["summary"]["worldcover_landcover_pct"] == {
        "Bosque / cobertura arbórea": 0.7,
        "Área construida": 99.3,
    }
    assert resultado["provenance"]["worldcover_epoch_year"] == 2021


def test_solo_se_listan_las_capas_que_esta_corrida_produjo(client, monkeypatch) -> None:
    """Antipatrón del brief: ofrecer un formato/capa que el backend no generó."""
    job = lanzar(client, monkeypatch, fake_pipeline_ndvi_caido)
    resultado = esperar_job(client, job["id"])["result"]

    por_capa = {c["layer"]: c for c in resultado["layers"]}
    assert por_capa["dem"]["available"] is True
    assert por_capa["dem"]["raster_url"] == f"/analysis/{job['id']}/raster/dem.tif"
    assert por_capa["ndvi"]["available"] is False
    assert por_capa["ndvi"]["raster_url"] is None
    assert "coastal" not in por_capa, "la costera es on-demand, no se anuncia sola"


def test_una_fuente_caida_no_tumba_el_analisis(client, monkeypatch) -> None:
    """Regresión #3 del inventario, ahora a nivel HTTP."""
    job = lanzar(client, monkeypatch, fake_pipeline_ndvi_caido)
    final = esperar_job(client, job["id"])

    assert final["status"] == "partial"
    veg = final["result"]["vegetation"]
    assert veg["available"] is True
    assert veg["ndvi_available"] is False
    assert veg["worldcover_available"] is True
    assert "Sentinel-2" in veg["ndvi_error"]
    #  Y la topografía, que ya se había descargado, sigue intacta:
    assert final["result"]["topography"]["available"] is True


def test_un_pipeline_que_explota_deja_el_job_en_error(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_explota)
    final = esperar_job(client, job["id"])
    assert final["status"] == "error"
    assert "503" in final["error"]
    assert final["result"] is None


def test_el_job_se_persiste_en_el_volumen(client, monkeypatch, data_dir: Path) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])

    guardado = json.loads((data_dir / "analyses" / job["id"] / "job.json").read_text(encoding="utf-8"))
    assert guardado["status"] == "ok"
    assert guardado["result"]["aoi"]["utm_epsg"] == 32619


# --- SSE -------------------------------------------------------------------


def test_sse_emite_los_mensajes_en_espanol(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])

    with client.stream("GET", f"/analysis/{job['id']}/events") as respuesta:
        assert respuesta.status_code == 200
        assert respuesta.headers["content-type"].startswith("text/event-stream")
        cuerpo = "".join(respuesta.iter_text())

    assert STEP_DEM in cuerpo
    assert STEP_NDVI in cuerpo
    assert STEP_WORLDCOVER in cuerpo
    assert "event: done" in cuerpo


def test_sse_de_un_job_inexistente_da_404(client) -> None:
    assert client.get("/analysis/nope/events").status_code == 404


# --- capas -----------------------------------------------------------------


def test_overlay_png_con_bounds_en_headers(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])

    respuesta = client.get(f"/analysis/{job['id']}/overlay/dem.png")
    assert respuesta.status_code == 200
    assert respuesta.headers["content-type"] == "image/png"
    assert respuesta.content[:8] == b"\x89PNG\r\n\x1a\n"

    west, south, east, north = json.loads(respuesta.headers["X-Bounds"])
    assert north > south and east > west
    esquinas = json.loads(respuesta.headers["X-Overlay-Coordinates"])
    assert esquinas == [[west, north], [east, north], [east, south], [west, south]]


def test_overlay_json_trae_leyenda(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])

    meta = client.get(f"/analysis/{job['id']}/overlay/worldcover.json").json()
    assert meta["layer"] == "worldcover"
    assert meta["legend_title"] == "Cobertura de suelo (ESA WorldCover)"
    assert {e["code"] for e in meta["legend"]} == {10, 50}
    assert meta["png_url"] == f"/analysis/{job['id']}/overlay/worldcover.png"
    assert len(meta["coordinates"]) == 4


def test_overlay_acepta_opacidad_y_rampa(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])

    meta = client.get(
        f"/analysis/{job['id']}/overlay/dem.json", params={"opacity": 0.5, "vmin": 0, "vmax": 100}
    ).json()
    assert meta["opacity"] == 0.5
    assert (meta["vmin"], meta["vmax"]) == (0.0, 100.0)

    assert client.get(f"/analysis/{job['id']}/overlay/dem.png", params={"opacity": 5}).status_code == 422


def test_capa_desconocida_da_404(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])
    respuesta = client.get(f"/analysis/{job['id']}/overlay/lo-que-sea.png")
    assert respuesta.status_code == 404
    assert "desconocida" in respuesta.json()["detail"]


def test_capa_que_esta_corrida_no_genero_da_404_explicativo(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ndvi_caido)
    esperar_job(client, job["id"])
    respuesta = client.get(f"/analysis/{job['id']}/raster/ndvi.tif")
    assert respuesta.status_code == 404
    assert "no se generó" in respuesta.json()["detail"]


def test_descarga_de_geotiff_con_nombre_en_espanol(client, monkeypatch) -> None:
    job = lanzar(client, monkeypatch, fake_pipeline_ok)
    esperar_job(client, job["id"])

    respuesta = client.get(f"/analysis/{job['id']}/raster/dem.tif")
    assert respuesta.status_code == 200
    assert respuesta.content[:4] in (b"II*\x00", b"MM\x00*")
    assert "elevacion.tif" in respuesta.headers["content-disposition"]


# --- costera ---------------------------------------------------------------


def test_coastal_sin_aoi_ni_analysis_id_da_422(client) -> None:
    respuesta = client.post(
        "/coastal", json={"preset": "Hoy (histórico) — 100 años de retorno"}
    )
    assert respuesta.status_code == 422


def test_coastal_con_preset_invalido_da_422(client) -> None:
    respuesta = client.post("/coastal", json={"preset": "2100 · lo que sea", "aoi": AOI})
    assert respuesta.status_code == 422


def test_coastal_con_analysis_id_inexistente_da_404(client) -> None:
    respuesta = client.post(
        "/coastal",
        json={"preset": "Hoy (histórico) — 100 años de retorno", "analysis_id": "nope"},
    )
    assert respuesta.status_code == 404


def test_overlay_costero_sin_datos_da_404(client) -> None:
    assert client.get("/coastal/inexistente/overlay.png").status_code == 404


# --- token interno opcional ------------------------------------------------


@pytest.mark.parametrize(
    "token, header, ok",
    [
        (None, None, True),  # sin token configurado, todo pasa
        ("s3cr3t", "Bearer s3cr3t", True),
        ("s3cr3t", "Bearer otro", False),
        ("s3cr3t", None, False),
    ],
)
def test_require_token(token, header, ok) -> None:
    import asyncio
    from types import SimpleNamespace

    from fastapi import HTTPException

    from territorio_base_api.config import Settings
    from territorio_base_api.main import require_token

    request = SimpleNamespace(
        app=SimpleNamespace(state=SimpleNamespace(settings=Settings(data_dir=Path("."), api_token=token)))
    )
    if ok:
        asyncio.run(require_token(request, header))
    else:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(require_token(request, header))
        assert exc.value.status_code == 401
