/*
  Formato numérico español rioplatense/dominicano (02-design-brief.md §10):
  coma decimal y espacio fino como separador de miles — `1 240,5 ha`.

  Implementado a mano en vez de con `Intl`: el mismo string debe salir del
  render del servidor y del cliente, y los datos de locale de Node y del
  navegador no son idénticos. Un separador distinto entre SSR e hidratación es
  un mismatch de React silencioso.
*/

const THIN_SPACE = ' ';

export function formatNumber(value: number, decimals = 1): string {
  if (!Number.isFinite(value)) return '—';

  const negative = value < 0;
  const fixed = Math.abs(value).toFixed(decimals);
  const parts = fixed.split('.');
  const whole = parts[0] ?? '0';
  const fraction = parts[1];

  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, THIN_SPACE);
  const body = fraction === undefined ? grouped : `${grouped},${fraction}`;

  return negative ? `-${body}` : body;
}

/** `128,4 ha` — el chip de AOI del topbar y las tarjetas del reporte. */
export function formatHectares(ha: number, decimals = 1): string {
  return `${formatNumber(ha, decimals)} ha`;
}

/** `42,1 %` — con espacio fino antes del signo, como manda la ortografía. */
export function formatPercent(pct: number, decimals = 1): string {
  return `${formatNumber(pct, decimals)}${THIN_SPACE}%`;
}

/** Metros por debajo de 1 km, kilómetros por encima. */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters)) return '—';
  if (Math.abs(meters) < 1000) return `${formatNumber(meters, 0)} m`;
  return `${formatNumber(meters / 1000, 1)} km`;
}

export function formatElevation(meters: number): string {
  return `${formatNumber(meters, 0)} m`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'kB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${formatNumber(value, unitIndex === 0 ? 0 : 1)} ${units[unitIndex] ?? 'B'}`;
}

/** Coordenadas del centroide en la portada del reporte. */
export function formatLonLat(lon: number, lat: number): string {
  return `${formatNumber(lat, 5)}, ${formatNumber(lon, 5)}`;
}

/** Opacidad 0..1 → `70 %` para el readout del slider. */
export function formatOpacity(opacity: number): string {
  return `${formatNumber(Math.round(opacity * 100), 0)}${THIN_SPACE}%`;
}

export function formatElapsed(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`;
}
