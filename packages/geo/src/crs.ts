/**
 * Helpers de CRS sobre proj4js.
 *
 * Alcance: WGS84 geográfico (EPSG:4326) ↔ UTM/WGS84 (EPSG:326xx / 327xx).
 * Es exactamente el par que usa el pipeline y, según `03-critique-2.md` H15,
 * es exacto contra pyproj a escala sub-nanométrica (no hay cambio de datum,
 * es una proyección pura).
 *
 * **Caveat que sí importa (H15):** proj4js no soporta grillas de corrimiento
 * (NTv2/NADCON). Si alguna vez entra un archivo en un datum local (NAD27
 * dominicano, por ejemplo), proj4 cae en silencio a una transformación de 3
 * parámetros o nula y se va metros, sin error. Por eso `assertSupportedEpsg`
 * rechaza cualquier EPSG fuera del set soportado en vez de intentarlo igual.
 */

import proj4 from 'proj4';

import { mapGeometryPositions, type Geometry, type Position } from './geojson';

export const WGS84_EPSG = 4326;

/** EPSG de UTM norte 1..60 = 32601..32660; sur = 32701..32760. */
export type UtmEpsg = number;

/**
 * Fórmula idéntica a `aoi.py::_utm_epsg_for`.
 *
 * `int((lon + 180) / 6) + 1` en Python trunca hacia cero y `lon` siempre cae
 * en `[-180, 180]`, así que `Math.floor` reproduce el resultado. La longitud
 * se normaliza primero para que 180 y -180 no produzcan la zona 61.
 */
export function utmEpsgForLonLat(lon: number, lat: number): UtmEpsg {
  const normalizedLon = ((((lon + 180) % 360) + 360) % 360) - 180;
  const zone = Math.min(60, Math.floor((normalizedLon + 180) / 6) + 1);
  return (lat >= 0 ? 32600 : 32700) + zone;
}

export function isUtmEpsg(epsg: number): boolean {
  const zone = epsg % 100;
  const base = epsg - zone;
  return (base === 32600 || base === 32700) && zone >= 1 && zone <= 60;
}

export function utmZoneOf(epsg: UtmEpsg): { zone: number; north: boolean } {
  if (!isUtmEpsg(epsg)) throw new Error(`EPSG:${epsg} no es una zona UTM/WGS84.`);
  return { zone: epsg % 100, north: epsg - (epsg % 100) === 32600 };
}

export function assertSupportedEpsg(epsg: number): void {
  if (epsg !== WGS84_EPSG && !isUtmEpsg(epsg)) {
    throw new Error(
      `EPSG:${epsg} no está soportado. proj4js solo se usa acá para EPSG:4326 y UTM/WGS84 ` +
        `(32601-32660, 32701-32760); cualquier otro datum necesitaría grillas de corrimiento ` +
        `que proj4js no tiene y aplicaría en silencio una transformación aproximada (H15).`,
    );
  }
}

/**
 * proj4js trae las 60 zonas UTM de ambos hemisferios precargadas
 * (`proj4.defs('EPSG:32619')` resuelve sin registrar nada). Verificado con
 * `verifyUtmDefinitions()` y en el test de `crs.ts`.
 */
export function projName(epsg: number): string {
  assertSupportedEpsg(epsg);
  return `EPSG:${epsg}`;
}

/** Devuelve las zonas cuya definición proj4 falta. Debería ser siempre `[]`. */
export function verifyUtmDefinitions(): number[] {
  const missing: number[] = [];
  for (let zone = 1; zone <= 60; zone += 1) {
    for (const base of [32600, 32700]) {
      const epsg = base + zone;
      // proj4.defs devuelve undefined si la definición no existe.
      const def: unknown = proj4.defs(`EPSG:${epsg}`);
      if (def === undefined || def === null) missing.push(epsg);
    }
  }
  return missing;
}

function converter(fromEpsg: number, toEpsg: number): (position: Position) => Position {
  assertSupportedEpsg(fromEpsg);
  assertSupportedEpsg(toEpsg);
  const transform = proj4(projName(fromEpsg), projName(toEpsg));
  return (position: Position): Position => {
    const x = position[0];
    const y = position[1];
    if (x === undefined || y === undefined) {
      throw new Error('Posición GeoJSON con menos de 2 coordenadas.');
    }
    const [nx, ny] = transform.forward([x, y]);
    if (!Number.isFinite(nx) || !Number.isFinite(ny)) {
      throw new Error(
        `Reproyección EPSG:${fromEpsg}→EPSG:${toEpsg} produjo un valor no finito para [${x}, ${y}].`,
      );
    }
    // La Z (si existe) se conserva sin transformar: no hay modelo geoidal acá.
    const z = position[2];
    return z === undefined ? [nx, ny] : [nx, ny, z];
  };
}

export function projectPosition(position: Position, fromEpsg: number, toEpsg: number): Position {
  return converter(fromEpsg, toEpsg)(position);
}

/** Reproyecta una geometría completa entre dos EPSG soportados. */
export function projectGeometry(geometry: Geometry, fromEpsg: number, toEpsg: number): Geometry {
  if (fromEpsg === toEpsg) return geometry;
  return mapGeometryPositions(geometry, converter(fromEpsg, toEpsg));
}

export function toUtm(geometry: Geometry, utmEpsg: UtmEpsg): Geometry {
  return projectGeometry(geometry, WGS84_EPSG, utmEpsg);
}

export function fromUtm(geometry: Geometry, utmEpsg: UtmEpsg): Geometry {
  return projectGeometry(geometry, utmEpsg, WGS84_EPSG);
}

const WGS84_GEOGCS =
  'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563,' +
  'AUTHORITY["EPSG","7030"]],AUTHORITY["EPSG","6326"]],' +
  'PRIMEM["Greenwich",0,AUTHORITY["EPSG","8901"]],' +
  'UNIT["degree",0.0174532925199433,AUTHORITY["EPSG","9122"]],AUTHORITY["EPSG","4326"]]';

/**
 * WKT (ESRI/OGC, compatible con GDAL) del CRS, para escribir el `.prj` real.
 *
 * H7: `@mapbox/shp-write` emite SIEMPRE la constante WGS84 sin mirar el CRS de
 * los datos, así que exportar geometrías en UTM produce un shapefile que abre
 * en QGIS a latitud 2.043.328°. Acá el `.prj` sale del EPSG efectivo, y lleva
 * el nodo `AUTHORITY` que a shp-write le falta (visores web que no infieren
 * el CRS desde los parámetros lo necesitan).
 */
export function wktForEpsg(epsg: number): string {
  assertSupportedEpsg(epsg);
  if (epsg === WGS84_EPSG) return WGS84_GEOGCS;

  const { zone, north } = utmZoneOf(epsg);
  const centralMeridian = zone * 6 - 183;
  const falseNorthing = north ? 0 : 10000000;
  const name = `WGS 84 / UTM zone ${zone}${north ? 'N' : 'S'}`;
  return (
    `PROJCS["${name}",${WGS84_GEOGCS},` +
    'PROJECTION["Transverse_Mercator"],' +
    'PARAMETER["latitude_of_origin",0],' +
    `PARAMETER["central_meridian",${centralMeridian}],` +
    'PARAMETER["scale_factor",0.9996],' +
    'PARAMETER["false_easting",500000],' +
    `PARAMETER["false_northing",${falseNorthing}],` +
    'UNIT["metre",1,AUTHORITY["EPSG","9001"]],' +
    'AXIS["Easting",EAST],AXIS["Northing",NORTH],' +
    `AUTHORITY["EPSG","${epsg}"]]`
  );
}
