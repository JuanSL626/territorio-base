"""Orquesta la obtención de datos + análisis, y arma el reporte final para un AOI."""

from __future__ import annotations

from typing import Callable

from territorio_base.aoi import AOI
from territorio_base.analysis.topography import compute_slope_aspect, summarize_topography
from territorio_base.analysis.vegetation import summarize_vegetation
from territorio_base.sources import mepyd_rd, osm, protected_areas, stac

Progress = Callable[[str], None]


def _noop(_msg: str) -> None:
    return None


def run_analysis(aoi: AOI, progress: Progress = _noop) -> dict:
    progress("Descargando DEM (Copernicus GLO-30)…")
    dem = stac.fetch_dem(aoi)
    slope, aspect = compute_slope_aspect(dem)
    topo_summary = summarize_topography(dem, slope)

    progress("Descargando Sentinel-2 y calculando NDVI…")
    ndvi = stac.fetch_sentinel2_ndvi(aoi)

    progress("Descargando ESA WorldCover…")
    worldcover = stac.fetch_worldcover(aoi)
    veg_summary = summarize_vegetation(ndvi, worldcover)

    progress("Consultando hidrología en OpenStreetMap…")
    hydro_features = osm.fetch_hydrology(aoi)
    hydro_summary = osm.summarize_hydrology(aoi, hydro_features)

    progress("Consultando áreas protegidas (WDPA)…")
    pa_gdf = protected_areas.fetch_protected_areas(aoi)
    pa_summary = protected_areas.summarize_protected_areas(aoi, pa_gdf)

    mepyd_results: dict = {}
    mepyd_summary: dict = {}
    if mepyd_rd.is_in_rd(aoi):
        progress("Consultando catálogo MEPyD (Rep. Dominicana)…")
        mepyd_results = mepyd_rd.fetch_all(aoi)
        mepyd_summary = mepyd_rd.summarize(mepyd_results)

    return {
        "aoi": {
            "area_ha": aoi.area_ha,
            "bbox": aoi.bbox,
            "utm_epsg": aoi.utm_epsg,
        },
        "topography": {
            "summary": topo_summary,
            "dem": dem,
            "slope": slope,
            "aspect": aspect,
        },
        "vegetation": {
            "summary": veg_summary,
            "ndvi": ndvi,
            "worldcover": worldcover,
        },
        "hydrology": {
            "summary": hydro_summary,
            "features": hydro_features,
        },
        "protected_areas": {
            "summary": pa_summary,
            "gdf": pa_gdf,
        },
        "mepyd_rd": {
            "in_rd": mepyd_rd.is_in_rd(aoi),
            "summary": mepyd_summary,
            "layers": mepyd_results,
        },
    }


def to_markdown(results: dict) -> str:
    aoi = results["aoi"]
    topo = results["topography"]["summary"]
    veg = results["vegetation"]["summary"]
    hydro = results["hydrology"]["summary"]
    pa = results["protected_areas"]["summary"]

    lines = [
        "# Reporte base de análisis territorial",
        "",
        f"- Área del polígono: **{aoi['area_ha']:.1f} ha**",
        f"- BBox (WGS84): {aoi['bbox']}",
        "",
        "## Topografía",
        f"- Elevación: {topo['elevation_min_m']:.0f} – {topo['elevation_max_m']:.0f} m "
        f"(rango {topo['elevation_range_m']:.0f} m, media {topo['elevation_mean_m']:.0f} m)",
        f"- Pendiente media: {topo['slope_mean_pct']:.1f}% (máxima {topo['slope_max_pct']:.1f}%)",
        "- Distribución de pendientes:",
    ]
    for label, pct in topo["slope_class_pct"].items():
        lines.append(f"  - {label}: {pct:.1f}%")

    lines += [
        "",
        "## Cobertura y densidad arbórea",
        f"- NDVI medio: {veg['ndvi_mean']:.2f} (mediana {veg['ndvi_median']:.2f}, percentil 90: {veg['ndvi_p90']:.2f})",
        f"- Cobertura arbórea (ESA WorldCover): {veg['worldcover_tree_cover_pct']:.1f}% del área",
        "- Densidad de vegetación por NDVI:",
    ]
    for label, pct in veg["ndvi_density_class_pct"].items():
        lines.append(f"  - {label}: {pct:.1f}%")
    lines.append("- Cobertura de suelo (ESA WorldCover):")
    for label, pct in veg["worldcover_landcover_pct"].items():
        lines.append(f"  - {label}: {pct:.1f}%")

    lines += [
        "",
        "## Hidrología (OpenStreetMap, buffer 500 m)",
    ]
    if hydro["features_found"] == 0:
        lines.append("- No se encontraron cursos/cuerpos de agua mapeados en OSM cerca del AOI.")
    else:
        lines.append(f"- {hydro['features_found']} elemento(s) encontrados dentro del buffer.")
        lines.append(f"- ¿Intersecta el polígono?: {'SÍ' if hydro['intersects_aoi'] else 'No'}")
        lines.append(f"- Distancia al más cercano: {hydro['nearest_distance_m']:.0f} m")
        for f in hydro["features"][:10]:
            nombre = f["name"] or "(sin nombre)"
            lines.append(f"  - {f['kind']} — {nombre} — {f['distance_m']:.0f} m")

    lines += [
        "",
        "## Áreas protegidas (WDPA, buffer 1 km)",
    ]
    if pa["areas_found"] == 0:
        lines.append("- No se encontraron áreas WDPA cerca del AOI.")
    else:
        lines.append(f"- {pa['areas_found']} área(s) encontradas dentro del buffer.")
        lines.append(f"- ¿Intersecta el polígono?: {'SÍ' if pa['intersects_aoi'] else 'No'}")
        if pa["intersects_aoi"]:
            lines.append(
                f"- Solapamiento: {pa['overlap_ha']:.1f} ha ({pa['overlap_pct_of_aoi']:.1f}% del AOI)"
            )
        for a in pa["areas"][:10]:
            lines.append(
                f"  - {a['name']} ({a['desig']}, IUCN {a['iucn_cat']}, {a['status']}) — {a['distance_m']:.0f} m"
            )

    mepyd = results["mepyd_rd"]
    if mepyd["in_rd"]:
        lines += [
            "",
            "## Contexto República Dominicana (MEPyD — Sistema de Información para la GRD y la AC, buffer 500 m)",
        ]
        if not mepyd["summary"]:
            lines.append("- Sin resultados (servicios sin respuesta o sin elementos cerca del AOI).")
        for group, layers in mepyd["summary"].items():
            lines.append(f"### {group}")
            for label, data in layers.items():
                lines.append(f"- **{label}**: {data['count']} elemento(s)")

    return "\n".join(lines)
