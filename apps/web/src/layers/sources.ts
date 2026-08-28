/*
  Fuentes y citación — 00-legacy-inventory.md §5.

  Una fila por dataset. Es el insumo directo de la tabla fija "Fuentes y
  metodología" (§6.5) y del popover ⓘ de cada capa (§4.3).
*/

import type { SourceRef } from './types';

export const SRC_COPERNICUS_DEM: SourceRef = {
  name: 'Copernicus DEM GLO-30',
  provider: 'ESA, vía Microsoft Planetary Computer',
  url: 'https://planetarycomputer.microsoft.com/dataset/cop-dem-glo-30',
  vintage: '2021 (GLO-30, release 2021_1)',
  resolution: '30 m',
  coverage: 'Global',
  license:
    'Copernicus DEM — uso libre con atribución (© DLR e.V. 2010-2014, © Airbus DS 2014-2018)',
  citation:
    'ESA / Airbus Defence and Space. Copernicus DEM GLO-30. Vía Microsoft Planetary Computer, colección `cop-dem-glo-30`.',
  method:
    'Modelo digital de elevación remuestreado al AOI y recortado a su geometría, reproyectado a la zona UTM local.',
};

export const SRC_SLOPE: SourceRef = {
  ...SRC_COPERNICUS_DEM,
  name: 'Pendiente derivada del Copernicus DEM GLO-30',
  method:
    'Pendiente %: gradiente de elevación sobre Copernicus DEM GLO-30 (30 m) reproyectado a UTM, sqrt(dz/dx² + dz/dy²)·100, clasificado en 4 clases. Es PORCENTAJE de pendiente, no grados.',
};

export const SRC_SENTINEL2: SourceRef = {
  name: 'Sentinel-2 L2A',
  provider: 'ESA Copernicus, vía Microsoft Planetary Computer',
  url: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a',
  vintage: 'Ventana móvil de 180 días',
  resolution: '10 m',
  coverage: 'Global',
  license: 'Copernicus Sentinel data — libre, con atribución',
  citation:
    'Copernicus Sentinel-2 L2A. Vía Microsoft Planetary Computer, colección `sentinel-2-l2a`.',
  method:
    'Mediana temporal de las 6 escenas menos nubladas de los últimos 180 días (filtro eo:cloud_cover < 30, máscara SCL {4,5,6,7,11}); NDVI = (NIR - Rojo) / (NIR + Rojo).',
  caveat:
    'Puede no haber escenas utilizables en zonas persistentemente nubladas. Que no haya dato no significa que no haya vegetación.',
};

export const SRC_WORLDCOVER: SourceRef = {
  name: 'ESA WorldCover 2021',
  provider: 'ESA, vía Microsoft Planetary Computer',
  url: 'https://planetarycomputer.microsoft.com/dataset/esa-worldcover',
  vintage: '2021 (v200)',
  resolution: '10 m',
  coverage: 'Global',
  license: 'CC BY 4.0',
  citation:
    'Zanaga, D. et al. (2022). ESA WorldCover 10 m 2021 v200. Vía Microsoft Planetary Computer.',
  method:
    'Clasificación de cobertura de suelo en 11 clases; el porcentaje se calcula sobre los píxeles dentro del AOI. La cobertura arbórea usa sólo el código 10.',
};

export const SRC_OSM_HYDRO: SourceRef = {
  name: 'OpenStreetMap — hidrología (waterway, natural=water, natural=wetland)',
  provider: 'Comunidad OSM, vía Overpass API',
  url: 'https://www.openstreetmap.org/copyright',
  vintage: 'Datos vivos (consulta en el momento del análisis)',
  resolution: 'Vectorial (colaborativo, variable)',
  coverage: 'Global',
  license: 'ODbL 1.0 — © colaboradores de OpenStreetMap',
  citation: '© Colaboradores de OpenStreetMap, consultado vía Overpass API.',
  method:
    'Consulta Overpass dentro de un buffer de 500 m alrededor del AOI, con 5 mirrors independientes en cascada.',
  caveat:
    'Que no aparezca un curso de agua no prueba que no exista: cruzar con INDRHI / Medio Ambiente si el proyecto lo amerita.',
};

export const SRC_WDPA: SourceRef = {
  name: 'WDPA — World Database on Protected Areas',
  provider: 'UNEP-WCMC (misma base que Protected Planet)',
  url: 'https://www.protectedplanet.net/',
  vintage: 'Servicio en vivo (UNEP-WCMC FeatureServer)',
  resolution: 'Vectorial',
  coverage: 'Global',
  license: 'UNEP-WCMC — uso no comercial con atribución; ver términos de Protected Planet',
  citation:
    'UNEP-WCMC and IUCN (año en curso), Protected Planet: The World Database on Protected Areas (WDPA).',
  method:
    'Áreas protegidas que intersectan un buffer de 1 km alrededor del AOI; solape calculado en UTM local.',
};

export const SRC_AQUEDUCT: SourceRef = {
  name: 'WRI Aqueduct Floods v2',
  provider: 'World Resources Institute',
  url: 'https://www.wri.org/data/aqueduct-floods-hazard-maps',
  vintage: 'v2 (Ward et al., 2020); proyecciones hasta 2080',
  resolution: '~927 m (30 arcsec)',
  coverage: 'Global costero',
  license: 'CC BY 4.0',
  citation:
    'Ward, P.J. et al. (2020). Aqueduct Floods Methodology. World Resources Institute. Technical Note.',
  method:
    'Profundidad de inundación costera proyectada para el escenario y período de retorno elegidos (subsidencia wtsub, percentil 95), leída por ventana sobre el GeoTIFF remoto.',
  caveat:
    'Herramienta de screening, no estudio de detalle. Metodología 2020 basada en RCPs; sin escenarios posteriores a 2080.',
};

export const SRC_MEPYD: SourceRef = {
  name: 'Sistema de Información para la GRD y la AC (Explorador de Riesgo 2.1)',
  provider: 'MEPyD — Ministerio de Economía, Planificación y Desarrollo, República Dominicana',
  url: 'https://mepyd.gob.do/',
  vintage: 'Servicios en vivo (ArcGIS FeatureServer)',
  resolution: 'Vectorial',
  coverage: 'República Dominicana',
  license: 'Datos públicos del MEPyD, sin registro',
  citation:
    'MEPyD (República Dominicana), Sistema de Información para la Gestión del Riesgo de Desastres y la Adaptación al Cambio Climático.',
  method:
    'Consulta espacial (esriSpatialRelIntersects) sobre el FeatureServer de la capa, con buffer de 500 m alrededor del AOI y paginación por resultOffset.',
  caveat:
    'Sólo se consulta si el AOI intersecta el bbox de República Dominicana. Una capa que falla se omite; una capa sin resultados no aparece.',
};

export const SRC_AOI: SourceRef = {
  name: 'AOI del usuario',
  provider: 'Territorio Base',
  url: '',
  vintage: 'Sesión actual',
  resolution: 'Vectorial',
  coverage: 'El polígono dibujado o subido',
  license: 'Propiedad del usuario',
  citation: 'Polígono definido por el usuario (dibujo en mapa o archivo KML/KMZ/GeoJSON).',
  method: 'Área calculada reproyectando el polígono a la zona UTM derivada de su centroide.',
};

/** Bbox de RD con margen, igual al del motor (`mepyd_rd.RD_BBOX`). */
export const RD_BBOX = { lonMin: -72.05, latMin: 17.45, lonMax: -68.3, latMax: 19.95 };

export function isInRd(bbox: [number, number, number, number]): boolean {
  const [minX, minY, maxX, maxY] = bbox;
  return !(
    maxX < RD_BBOX.lonMin ||
    minX > RD_BBOX.lonMax ||
    maxY < RD_BBOX.latMin ||
    minY > RD_BBOX.latMax
  );
}

export const ATTRIBUTION_LINE = '© OpenStreetMap · Copernicus · ESA · UNEP-WCMC · MEPyD';
