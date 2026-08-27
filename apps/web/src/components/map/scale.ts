/*
  Barra de escala y lectura de coordenadas — módulo PURO.

  No se usa `maplibregl.ScaleControl` porque el §2 pone la escala en el cúmulo
  inferior izquierdo, junto con la atribución y la leyenda compacta, y ese
  cúmulo es un componente React nuestro. Reimplementar la cuenta es una
  fórmula; embutir un control DOM ajeno adentro de un panel React es un
  problema de layout permanente.
*/

/** Metros por píxel en la proyección Web Mercator, a una latitud y un zoom. */
export function metersPerPixel(latitude: number, zoom: number): number {
  const EQUATOR_METERS_PER_PIXEL_AT_Z0 = 156_543.033_928;
  return (EQUATOR_METERS_PER_PIXEL_AT_Z0 * Math.cos((latitude * Math.PI) / 180)) / 2 ** zoom;
}

/** Pasos "redondos" de escala. Los mismos que usa MapLibre, en 1-2-5. */
const NICE_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000,
  500_000, 1_000_000,
];

export type ScaleBar = {
  /** Ancho en píxeles que hay que dibujar. */
  widthPx: number;
  /** `500 m` / `2 km`, con el formato español del §10. */
  label: string;
};

/**
 * Barra de escala de a lo sumo `maxWidthPx`, redondeada al paso 1-2-5 más
 * grande que entre.
 */
export function scaleBar(latitude: number, zoom: number, maxWidthPx = 90): ScaleBar {
  const perPixel = metersPerPixel(latitude, zoom);
  if (!Number.isFinite(perPixel) || perPixel <= 0) return { widthPx: 0, label: '—' };

  const maxMeters = perPixel * maxWidthPx;
  let chosen = NICE_STEPS[0] ?? 1;
  for (const step of NICE_STEPS) {
    if (step <= maxMeters) chosen = step;
  }

  return {
    widthPx: Math.round(chosen / perPixel),
    label: chosen >= 1000 ? `${String(chosen / 1000)} km` : `${String(chosen)} m`,
  };
}

/** `18,45312 N · 69,57104 O` — grados decimales, coma decimal española. */
export function formatCoordinates(lon: number, lat: number): string {
  const lonText = `${Math.abs(lon).toFixed(5).replace('.', ',')} ${lon >= 0 ? 'E' : 'O'}`;
  const latText = `${Math.abs(lat).toFixed(5).replace('.', ',')} ${lat >= 0 ? 'N' : 'S'}`;
  return `${latText} · ${lonText}`;
}
