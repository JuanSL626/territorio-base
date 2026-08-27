"""Capas del Sistema de Información para la GRD y la AC (MEPyD, República
Dominicana) — https://riesgos.mepyd.gob.do — vía sus FeatureServers públicos
de ArcGIS Online (sin token), consultadas por intersección espacial con el AOI.

Solo aplica cuando el AOI cae dentro (o cerca) de República Dominicana; para
cualquier otra zona esta fuente no aporta nada y se omite.

Las capas están agrupadas exactamente igual que en su "Explorador de Riesgo
2.1" (mismo árbol de capas que usa esa herramienta), para que el resultado
sea reconocible por alguien que ya conoce ese portal. Quedan fuera de este
catálogo capas del mismo mapa que son feeds globales/efímeros y no datos
propios de MEPyD (imágenes satelitales GOES en vivo, huracanes activos de
NOAA, cobertura de suelo Sentinel-2 — esta última ya la cubre nuestra propia
fuente ESA WorldCover).
"""

from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, as_completed

import geopandas as gpd
import requests

from territorio_base.aoi import AOI

# bbox aproximado de República Dominicana (lon_min, lat_min, lon_max, lat_max),
# con margen — solo para decidir si vale la pena consultar estos servicios.
RD_BBOX = (-72.05, 17.45, -68.30, 19.95)

_SIARDCC_PRUEBA = "https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/SIARDCC_PRUEBA/FeatureServer"
_NUEVAS_CAPAS = "https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/nuevas_capas/FeatureServer"
_CAPAS_SIRED = "https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services/CAPAS_SIRED/FeatureServer"
_CENSO_SISMICO = "https://services3.arcgis.com/DYnzeQNyuMo2mJ1o/arcgis/rest/services"

# Grupo -> {etiqueta: url del FeatureLayer (servicio + índice de capa)}.
LAYERS: dict[str, dict[str, str]] = {
    "División Político-Administrativa": {
        "Municipios (límites, provincia, región, población)": f"{_SIARDCC_PRUEBA}/26",
    },
    "Amenaza sísmica (por nivel censal 2010)": {
        "Barrio/paraje": f"{_CENSO_SISMICO}/BPCenso2010_amenaza_sismica/FeatureServer/0",
        "Sección": f"{_CENSO_SISMICO}/SECCenso2010_amenaza_sismica/FeatureServer/0",
        "Distrito municipal": f"{_CENSO_SISMICO}/DMCenso2010_amenaza_sismica/FeatureServer/0",
        "Municipio": f"{_CENSO_SISMICO}/MUNCenso2010_amenaza_sismica/FeatureServer/0",
        "Vulnerabilidad física de edificaciones (municipio)": f"{_CENSO_SISMICO}/Municipios_vulnerabilidad_sísmica/FeatureServer/0",
        "Riesgo sísmico (municipio)": f"{_CENSO_SISMICO}/Municipios_riesgo_sísmico_entero/FeatureServer/0",
    },
    "Amenazas": {
        "Gasoductos y oleoductos (buffer 500 m)": f"{_SIARDCC_PRUEBA}/8",
        "Almacenamiento de combustibles (buffer 1000 m)": f"{_SIARDCC_PRUEBA}/9",
        "Vertederos (buffer 1500 m)": f"{_SIARDCC_PRUEBA}/11",
        "Área propensa a licuefacción": f"{_NUEVAS_CAPAS}/14",
        "Amenaza de deslizamiento": f"{_SIARDCC_PRUEBA}/22",
        "Áreas propensas a deslizamientos (SGN)": f"{_NUEVAS_CAPAS}/23",
        "Amenaza sísmica (zonificación)": f"{_SIARDCC_PRUEBA}/19",
        "Área propensa a tsunami": f"{_NUEVAS_CAPAS}/17",
        "Área propensa a inundación": f"{_NUEVAS_CAPAS}/18",
        "Amenaza de ciclón": f"{_SIARDCC_PRUEBA}/25",
    },
    "Agua": {
        "Plantas de tratamiento de residuales (INAPA)": f"{_CAPAS_SIRED}/3",
        "Plantas de tratamiento (INAPA)": f"{_CAPAS_SIRED}/1",
        "Drenaje (buffer 20 m)": f"{_NUEVAS_CAPAS}/13",
        "Drenaje (red)": f"{_NUEVAS_CAPAS}/8",
        "Canales de riego": f"{_NUEVAS_CAPAS}/9",
        "Ríos y arroyos": f"{_NUEVAS_CAPAS}/6",
    },
    "Infraestructuras y edificaciones": {
        "Líneas de transmisión eléctrica": f"{_CAPAS_SIRED}/4",
        "Obras de toma (canales INDRHI)": f"{_NUEVAS_CAPAS}/1",
        "Infraestructura de salud": f"{_NUEVAS_CAPAS}/5",
        "Subestaciones eléctricas": f"{_CAPAS_SIRED}/0",
        "Albergues": f"{_NUEVAS_CAPAS}/4",
        "Centros educativos": f"{_NUEVAS_CAPAS}/0",
        "Área construida": f"{_NUEVAS_CAPAS}/20",
    },
    "Vías": {
        "Calles": f"{_SIARDCC_PRUEBA}/5",
        "Pistas": f"{_SIARDCC_PRUEBA}/7",
        "Carreteras terciarias": f"{_SIARDCC_PRUEBA}/0",
        "Carreteras secundarias": f"{_SIARDCC_PRUEBA}/1",
        "Carreteras primarias": f"{_SIARDCC_PRUEBA}/2",
        "Autovías": f"{_SIARDCC_PRUEBA}/3",
        "Puentes": f"{_CAPAS_SIRED}/2",
    },
    "Áreas protegidas (MEPyD)": {
        "Área de amortiguamiento": f"{_NUEVAS_CAPAS}/16",
        "Área protegida": f"{_NUEVAS_CAPAS}/15",
    },
}


def is_in_rd(aoi: AOI) -> bool:
    minx, miny, maxx, maxy = aoi.bbox
    bx0, by0, bx1, by1 = RD_BBOX
    return not (maxx < bx0 or minx > bx1 or maxy < by0 or miny > by1)


_MAX_PAGES = 10  # tope de seguridad (capas densas tipo "Calles" a lo sumo pagan ~10x maxRecordCount)


def _query_layer(url: str, aoi: AOI, buffer_m: float) -> gpd.GeoDataFrame:
    search_area = aoi.buffer_wgs84(buffer_m) if buffer_m else aoi.geometry_wgs84
    rings = [list(search_area.exterior.coords)]
    base_params = {
        "geometry": json.dumps({"rings": rings, "spatialReference": {"wkid": 4326}}),
        "geometryType": "esriGeometryPolygon",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "true",
        "outSR": "4326",
        "f": "geojson",
    }

    all_features: list[dict] = []
    offset = 0
    for _ in range(_MAX_PAGES):
        resp = requests.post(f"{url}/query", data={**base_params, "resultOffset": offset}, timeout=30)
        resp.raise_for_status()
        fc = resp.json()
        if "error" in fc:
            break
        features = fc.get("features", [])
        all_features.extend(features)
        if not fc.get("properties", {}).get("exceededTransferLimit") or not features:
            break
        offset += len(features)

    if not all_features:
        return gpd.GeoDataFrame(geometry=[], crs="EPSG:4326")
    return gpd.GeoDataFrame.from_features({"type": "FeatureCollection", "features": all_features}, crs="EPSG:4326")


def fetch_all(aoi: AOI, buffer_m: float = 500) -> dict[str, dict[str, gpd.GeoDataFrame]]:
    """Consulta, en paralelo, todas las capas del catálogo MEPyD que intersectan
    el AOI (+ buffer), agrupadas igual que en su Explorador de Riesgo.

    Son ~35 servicios de terceros con confiabilidad variable (mantenimiento,
    límites de la cuenta de ArcGIS Online del MEPyD) — una capa que falla se
    omite en silencio en vez de tumbar todo el análisis; una capa sin
    resultados dentro del buffer tampoco aparece.
    """
    if not is_in_rd(aoi):
        return {}

    flat_jobs = [
        (group, label, url) for group, layers in LAYERS.items() for label, url in layers.items()
    ]

    results: dict[str, dict[str, gpd.GeoDataFrame]] = {}
    with ThreadPoolExecutor(max_workers=10) as pool:
        futures = {
            pool.submit(_query_layer, url, aoi, buffer_m): (group, label)
            for group, label, url in flat_jobs
        }
        for future in as_completed(futures):
            group, label = futures[future]
            try:
                gdf = future.result()
            except Exception:
                continue
            if gdf.empty:
                continue
            results.setdefault(group, {})[label] = gdf

    # Reordenar según el orden declarado en LAYERS (as_completed desordena).
    return {group: results[group] for group in LAYERS if group in results}


def summarize(results: dict[str, dict[str, gpd.GeoDataFrame]]) -> dict[str, dict[str, dict]]:
    """Por capa: cantidad de features que intersectan + sus atributos (sin geometría)."""
    summary: dict[str, dict[str, dict]] = {}
    for group, layers in results.items():
        summary[group] = {
            label: {
                "count": len(gdf),
                "features": gdf.drop(columns="geometry").to_dict("records"),
            }
            for label, gdf in layers.items()
        }
    return summary
