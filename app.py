"""App Streamlit: definí una zona en un mapa (o subí un polígono) y obtené
información base de fuentes abiertas — topografía, cobertura/densidad
arbórea, hidrología y áreas protegidas — sin tocar ningún GIS a mano.
"""

from __future__ import annotations

import io

import folium
import folium.plugins
import numpy as np
import pandas as pd
import streamlit as st
from streamlit_folium import st_folium

from territorio_base import mapview
from territorio_base.aoi import AOI, load_aoi_from_bytes, load_aoi_from_geojson_dict
from territorio_base.analysis.report import run_analysis, to_markdown
from territorio_base.analysis.vegetation import classify_ndvi_density

st.set_page_config(page_title="Territorio Base", layout="wide")
st.title("Territorio Base")
st.caption(
    "Definí una zona de estudio y obtené un diagnóstico base — topografía, "
    "cobertura y densidad arbórea, hidrología y áreas protegidas — a partir "
    "de fuentes abiertas (Copernicus DEM, Sentinel-2, ESA WorldCover, "
    "OpenStreetMap y WDPA). Sin registros ni descargas manuales."
)

if "results" not in st.session_state:
    st.session_state["results"] = None
if "aoi" not in st.session_state:
    st.session_state["aoi"] = None

# --- 1. Definir la zona -------------------------------------------------

st.header("1. Definí la zona de estudio")
modo = st.radio("¿Cómo querés definirla?", ["Dibujar en el mapa", "Subir archivo (KML/KMZ/GeoJSON)"], horizontal=True)

aoi: AOI | None = None

if modo == "Dibujar en el mapa":
    m = folium.Map(location=[18.453, -69.571], zoom_start=13, tiles="OpenStreetMap")
    folium.plugins.Draw(
        export=False,
        draw_options={"polyline": False, "circle": False, "circlemarker": False, "marker": False},
    ).add_to(m)
    map_state = st_folium(m, height=500, width=None, key="draw_map")

    drawing = map_state.get("last_active_drawing") if map_state else None
    if drawing:
        aoi = load_aoi_from_geojson_dict(drawing)
        st.success(f"Polígono dibujado: {aoi.area_ha:.1f} ha")
else:
    uploaded = st.file_uploader("Subí el polígono", type=["kml", "kmz", "geojson", "json"])
    if uploaded is not None:
        aoi = load_aoi_from_bytes(uploaded.getvalue(), uploaded.name)
        st.success(f"Polígono cargado: {aoi.area_ha:.1f} ha")

if aoi is not None:
    st.session_state["aoi"] = aoi

# --- 2. Ejecutar el análisis ---------------------------------------------

st.header("2. Analizá la zona")

col_a, _ = st.columns([1, 3])
with col_a:
    run_clicked = st.button("Analizar zona", type="primary", disabled=st.session_state["aoi"] is None)

if run_clicked and st.session_state["aoi"] is not None:
    status_box = st.status("Corriendo el análisis…", expanded=True)

    def progress(msg: str) -> None:
        status_box.write(msg)

    try:
        results = run_analysis(st.session_state["aoi"], progress=progress)
        st.session_state["results"] = results
        status_box.update(label="Análisis completo", state="complete")
    except Exception as exc:  # noqa: BLE001 — se muestra el error tal cual al usuario
        status_box.update(label="Falló el análisis", state="error")
        st.error(f"Error corriendo el análisis: {exc}")

# --- 3. Resultados ---------------------------------------------------------

results = st.session_state["results"]
if results:
    st.header("3. Resultados")

    aoi_info = results["aoi"]
    aoi_obj: AOI = st.session_state["aoi"]
    topo = results["topography"]["summary"]
    veg = results["vegetation"]["summary"]
    hydro = results["hydrology"]["summary"]
    pa = results["protected_areas"]["summary"]

    m1, m2, m3, m4 = st.columns(4)
    m1.metric("Área", f"{aoi_info['area_ha']:.1f} ha")
    m2.metric("Elevación", f"{topo['elevation_min_m']:.0f}–{topo['elevation_max_m']:.0f} m")
    m3.metric("Pendiente media", f"{topo['slope_mean_pct']:.1f}%")
    m4.metric("Cobertura arbórea", f"{veg['worldcover_tree_cover_pct']:.1f}%")

    if pa["intersects_aoi"]:
        st.warning(
            f"⚠️ El polígono SÍ intersecta un área de la WDPA: "
            f"{pa['areas'][0]['name']} ({pa['areas'][0]['desig']}) — "
            f"solapamiento de {pa['overlap_ha']:.1f} ha ({pa['overlap_pct_of_aoi']:.1f}% del área)."
        )
    elif pa["areas_found"] > 0:
        st.info(
            f"No hay intersección, pero hay {pa['areas_found']} área(s) WDPA a "
            f"{pa['nearest_distance_m']:.0f} m del polígono."
        )
    else:
        st.success("No se encontraron áreas protegidas (WDPA) cerca del polígono.")

    if hydro["intersects_aoi"]:
        st.warning("⚠️ Hay un curso/cuerpo de agua de OSM que intersecta el polígono.")
    elif hydro["features_found"] > 0:
        st.info(
            f"No hay intersección, pero hay {hydro['features_found']} elemento(s) de hidrología "
            f"a {hydro['nearest_distance_m']:.0f} m."
        )
    else:
        st.success("No se encontró hidrología mapeada en OSM cerca del polígono.")

    tab_mapa, tab_topo, tab_veg, tab_hidro_pa, tab_reporte = st.tabs(
        ["Mapa interactivo", "Topografía", "Vegetación", "Hidrología / Áreas protegidas", "Reporte"]
    )

    with tab_mapa:
        col_controls, col_map = st.columns([1, 3])

        with col_controls:
            st.caption("Capas — prendé/apagá y ajustá opacidad")

            show_dem = st.checkbox("Elevación (DEM)", value=False)
            op_dem = st.slider("Opacidad DEM", 0.0, 1.0, 0.7, key="op_dem", disabled=not show_dem)

            show_slope = st.checkbox("Pendiente (%)", value=False)
            op_slope = st.slider("Opacidad pendiente", 0.0, 1.0, 0.7, key="op_slope", disabled=not show_slope)

            show_ndvi = st.checkbox("NDVI (continuo)", value=False)
            op_ndvi = st.slider("Opacidad NDVI", 0.0, 1.0, 0.7, key="op_ndvi", disabled=not show_ndvi)

            show_ndvi_density = st.checkbox("Densidad de vegetación (clasificada)", value=True)
            op_ndvi_density = st.slider(
                "Opacidad densidad vegetación", 0.0, 1.0, 0.75, key="op_ndvi_density", disabled=not show_ndvi_density
            )

            show_worldcover = st.checkbox("Cobertura de suelo (WorldCover)", value=False)
            op_worldcover = st.slider(
                "Opacidad WorldCover", 0.0, 1.0, 0.7, key="op_worldcover", disabled=not show_worldcover
            )

            show_hydro = st.checkbox("Hidrología (OSM)", value=True)
            show_pa = st.checkbox("Áreas protegidas (WDPA)", value=True)

        with col_map:
            fmap = mapview.build_base_map(aoi_obj)

            if show_dem:
                dem = results["topography"]["dem"]
                uri, bounds = mapview.continuous_overlay(
                    dem, "terrain", float(np.nanmin(dem.values)), float(np.nanmax(dem.values))
                )
                mapview.add_image_layer(fmap, uri, bounds, "Elevación", op_dem)

            if show_slope:
                slope = results["topography"]["slope"]
                uri, bounds = mapview.continuous_overlay(
                    slope, "YlOrRd", 0.0, float(np.nanpercentile(slope.values, 98))
                )
                mapview.add_image_layer(fmap, uri, bounds, "Pendiente", op_slope)

            if show_ndvi:
                ndvi = results["vegetation"]["ndvi"]
                uri, bounds = mapview.continuous_overlay(ndvi, "RdYlGn", -1.0, 1.0)
                mapview.add_image_layer(fmap, uri, bounds, "NDVI", op_ndvi)

            if show_ndvi_density:
                ndvi_class = classify_ndvi_density(results["vegetation"]["ndvi"])
                colors_by_idx = {i: c for i, c in enumerate(mapview.NDVI_DENSITY_COLORS)}
                uri, bounds = mapview.categorical_overlay(ndvi_class, colors_by_idx)
                mapview.add_image_layer(fmap, uri, bounds, "Densidad de vegetación", op_ndvi_density)
                mapview.add_legend(fmap, "Densidad de vegetación (NDVI)", mapview.ndvi_density_legend_items())

            if show_worldcover:
                wc = results["vegetation"]["worldcover"]
                present = set(np.unique(wc.values[wc.values > 0]).tolist())
                uri, bounds = mapview.categorical_overlay(wc, mapview.WORLDCOVER_COLORS)
                mapview.add_image_layer(fmap, uri, bounds, "Cobertura de suelo", op_worldcover)
                mapview.add_legend(
                    fmap,
                    "Cobertura de suelo (WorldCover)",
                    mapview.worldcover_legend_items(present),
                    position_offset_px=160 if show_ndvi_density else 0,
                )

            if show_hydro:
                mapview.add_hydrology_layer(fmap, results["hydrology"]["features"], 0.9)

            if show_pa:
                mapview.add_protected_areas_layer(fmap, results["protected_areas"]["gdf"], 0.8)

            st_folium(fmap, height=600, width=None, key="results_map", returned_objects=[])

    with tab_topo:
        st.write("Distribución de pendientes:")
        st.bar_chart(pd.Series(topo["slope_class_pct"]))

    with tab_veg:
        st.write("Densidad de vegetación (por NDVI):")
        st.bar_chart(pd.Series(veg["ndvi_density_class_pct"]))
        st.write("Cobertura de suelo (ESA WorldCover):")
        st.bar_chart(pd.Series(veg["worldcover_landcover_pct"]))

    with tab_hidro_pa:
        st.subheader("Hidrología (OSM, buffer 500 m)")
        if hydro["features"]:
            st.table(hydro["features"])
        else:
            st.write("Sin elementos.")
        st.subheader("Áreas protegidas (WDPA, buffer 1 km)")
        if pa["areas"]:
            st.table(pa["areas"])
        else:
            st.write("Sin áreas encontradas.")

    with tab_reporte:
        md = to_markdown(results)
        st.markdown(md)
        st.download_button("Descargar reporte (Markdown)", md, file_name="reporte_territorial.md")

        raster_exports = {
            "elevacion.tif": results["topography"]["dem"],
            "pendiente.tif": results["topography"]["slope"],
            "ndvi.tif": results["vegetation"]["ndvi"],
            "worldcover.tif": results["vegetation"]["worldcover"],
        }
        for filename, raster in raster_exports.items():
            buf = io.BytesIO()
            raster.rio.to_raster(buf, driver="GTiff")
            st.download_button(f"Descargar {filename}", buf.getvalue(), file_name=filename)
else:
    st.caption("Definí una zona y hacé click en \"Analizar zona\" para ver resultados acá.")
