# Referencia legacy — capas vectoriales (NO se importa desde el servicio)

Estos módulos **ya no forman parte del pipeline de Python**. El servicio
`territorio_base_api` es *solo raster* (STAC/Planetary Computer, Aqueduct).

Se conservan aquí, fuera del paquete instalable (`src/`), como **implementación
de referencia** para el port a TypeScript en `packages/geo`:

| Archivo | Destino en TS |
|---|---|
| `osm.py` | Overpass / hidrología (5 mirrors, buffer 500 m, `distance_m`, `intersects_aoi`) |
| `protected_areas.py` | WDPA / UNEP-WCMC (buffer 1 km, solapamiento ha/%) |
| `mepyd_rd.py` | ~35 FeatureServers MEPyD (grupos, paginación `resultOffset`, `is_in_rd`) |

Al portar, respetar los hazards H6–H10 de `docs/migration/03-critique-2.md`
(nombres DBF truncados, `.prj` hardcodeado, distancia geometría-a-geometría,
`intersects` por `booleanIntersects` y nunca por `distance === 0`).

**Cuando `packages/geo` termine el port, esta carpeta se borra.**
`mapview.py` (folium) ya fue borrado: el render pasa a MapLibre + el endpoint
`GET /analysis/{id}/overlay/{layer}.png` de este servicio.
