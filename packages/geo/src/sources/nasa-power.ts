/**
 * Recurso solar climatológico vía NASA POWER — API pública, sin credenciales.
 *
 * POWER combina radiación derivada de observaciones satelitales CERES/SRB con
 * meteorología MERRA-2. La resolución nativa solar es 1° × 1°: sirve para
 * tamizaje regional y dimensionamiento preliminar, no para comparar dos techos
 * vecinos ni para modelar sombras locales.
 */

import { z } from 'zod';

import {
  DEFAULT_TIMEOUTS,
  HttpError,
  TimeoutError,
  USER_AGENT,
  type FetchLike,
  type RequestOptions,
} from '../http';

import type { Aoi } from '../aoi';

export const NASA_POWER_URL = 'https://power.larc.nasa.gov/api/temporal/climatology/point';

export const NASA_POWER_PARAMETERS = [
  'ALLSKY_SFC_SW_DWN',
  'CLRSKY_SFC_SW_DWN',
  'ALLSKY_SFC_SW_DNI',
  'ALLSKY_SFC_SW_DIFF',
  'CLRSKY_DAYS',
  'CLOUD_AMT',
  'T2M',
  'WS10M',
] as const;

export const NASA_POWER_SOLAR_RESOLUTION = '1° × 1°';
export const NASA_POWER_LICENSE = 'NASA Earth Science Data and Information Policy';
export const NASA_POWER_ATTRIBUTION = 'NASA POWER — CERES/SRB, MERRA-2 y POWER';

const MONTHS = [
  'JAN',
  'FEB',
  'MAR',
  'APR',
  'MAY',
  'JUN',
  'JUL',
  'AUG',
  'SEP',
  'OCT',
  'NOV',
  'DEC',
] as const;

export type SolarMonth = (typeof MONTHS)[number];

const parameterValuesSchema = z.object({
  JAN: z.number(),
  FEB: z.number(),
  MAR: z.number(),
  APR: z.number(),
  MAY: z.number(),
  JUN: z.number(),
  JUL: z.number(),
  AUG: z.number(),
  SEP: z.number(),
  OCT: z.number(),
  NOV: z.number(),
  DEC: z.number(),
  ANN: z.number(),
});

const responseSchema = z.object({
  geometry: z.object({
    type: z.literal('Point'),
    coordinates: z.array(z.number()).min(2),
  }),
  properties: z.object({
    parameter: z.object({
      ALLSKY_SFC_SW_DWN: parameterValuesSchema,
      CLRSKY_SFC_SW_DWN: parameterValuesSchema,
      ALLSKY_SFC_SW_DNI: parameterValuesSchema,
      ALLSKY_SFC_SW_DIFF: parameterValuesSchema,
      CLRSKY_DAYS: parameterValuesSchema,
      CLOUD_AMT: parameterValuesSchema,
      T2M: parameterValuesSchema,
      WS10M: parameterValuesSchema,
    }),
  }),
  header: z.object({
    range: z.string(),
    time_standard: z.string(),
    sources: z.array(z.string()),
    fill_value: z.number(),
    api: z.object({ version: z.string(), name: z.string() }),
  }),
  parameters: z.record(z.string(), z.object({ units: z.string(), longname: z.string() })),
});

export type NasaPowerMonthlyValue = {
  month: SolarMonth;
  ghiKwhM2Day: number;
  dniKwhM2Day: number;
  dhiKwhM2Day: number;
  clearSkyGhiKwhM2Day: number;
  clearSkyDays: number;
  cloudAmountPct: number;
  temperatureC: number;
  windSpeed10mMs: number;
};

export type NasaPowerSolarResource = {
  checkedAt: string;
  latitude: number;
  longitude: number;
  elevationM: number | null;
  temporalRange: string;
  timeStandard: string;
  apiVersion: string;
  sourceDatasets: string[];
  spatialResolution: string;
  license: string;
  attribution: string;
  annual: Omit<NasaPowerMonthlyValue, 'month'> & {
    annualGhiKwhM2: number;
    peakSunHoursDay: number;
  };
  monthly: NasaPowerMonthlyValue[];
  formulas: {
    annualGhiKwhM2: string;
    peakSunHoursDay: string;
  };
  parameterUnits: Record<string, string>;
};

export class NasaPowerUnavailableError extends Error {
  override readonly name = 'NasaPowerUnavailableError';

  constructor(cause: unknown) {
    super(`No se pudo consultar NASA POWER: ${String(cause)}`, { cause });
  }
}

async function getJson(url: string, options: RequestOptions): Promise<unknown> {
  const timeouts = options.timeouts ?? DEFAULT_TIMEOUTS;
  const doFetch: FetchLike = options.fetchImpl ?? (async (input, init) => await fetch(input, init));
  const controller = new AbortController();
  const abortOuter = (): void => {
    controller.abort(new Error('Cancelado por el llamador.'));
  };
  options.signal?.addEventListener('abort', abortOuter, { once: true });

  let phase: 'connect' | 'read' = 'connect';
  let timer: ReturnType<typeof setTimeout> = setTimeout(() => {
    controller.abort(new TimeoutError(url, 'connect', timeouts.connectMs));
  }, timeouts.connectMs);

  try {
    const response = await doFetch(url, {
      method: 'GET',
      headers: { 'user-agent': USER_AGENT, ...options.headers },
      signal: controller.signal,
    });
    clearTimeout(timer);
    phase = 'read';
    timer = setTimeout(() => {
      controller.abort(new TimeoutError(url, 'read', timeouts.readMs));
    }, timeouts.readMs);
    if (!response.ok) throw new HttpError(url, response.status, response.statusText);
    return JSON.parse(await response.text()) as unknown;
  } catch (error) {
    if (error instanceof HttpError || error instanceof TimeoutError) throw error;
    if (controller.signal.aborted) {
      const reason: unknown = controller.signal.reason;
      if (reason instanceof TimeoutError) throw reason;
      throw new TimeoutError(
        url,
        phase,
        phase === 'connect' ? timeouts.connectMs : timeouts.readMs,
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abortOuter);
  }
}

function valuesAt(
  parameters: z.infer<typeof responseSchema>['properties']['parameter'],
  key: SolarMonth | 'ANN',
): Omit<NasaPowerMonthlyValue, 'month'> {
  return {
    ghiKwhM2Day: parameters.ALLSKY_SFC_SW_DWN[key],
    dniKwhM2Day: parameters.ALLSKY_SFC_SW_DNI[key],
    dhiKwhM2Day: parameters.ALLSKY_SFC_SW_DIFF[key],
    clearSkyGhiKwhM2Day: parameters.CLRSKY_SFC_SW_DWN[key],
    clearSkyDays: parameters.CLRSKY_DAYS[key],
    cloudAmountPct: parameters.CLOUD_AMT[key],
    temperatureC: parameters.T2M[key],
    windSpeed10mMs: parameters.WS10M[key],
  };
}

/** Consulta el punto central del bbox del AOI en la malla climática de POWER. */
export async function fetchNasaPowerSolar(
  aoi: Aoi,
  options: RequestOptions & { url?: string; checkedAt?: Date } = {},
): Promise<NasaPowerSolarResource> {
  const [west, south, east, north] = aoi.bbox;
  const requestedLongitude = (west + east) / 2;
  const requestedLatitude = (south + north) / 2;
  const url = new URL(options.url ?? NASA_POWER_URL);
  url.searchParams.set('parameters', NASA_POWER_PARAMETERS.join(','));
  url.searchParams.set('community', 'RE');
  url.searchParams.set('longitude', requestedLongitude.toFixed(6));
  url.searchParams.set('latitude', requestedLatitude.toFixed(6));
  url.searchParams.set('format', 'JSON');

  let parsed: z.infer<typeof responseSchema>;
  try {
    parsed = responseSchema.parse(
      await getJson(url.toString(), {
        ...options,
        timeouts: options.timeouts ?? { connectMs: 5_000, readMs: 30_000 },
      }),
    );
    const fill = parsed.header.fill_value;
    for (const parameter of Object.values(parsed.properties.parameter)) {
      if (Object.values(parameter).some((value) => value === fill)) {
        throw new Error(`NASA POWER devolvió el valor de relleno ${String(fill)}.`);
      }
    }
  } catch (cause) {
    throw new NasaPowerUnavailableError(cause);
  }

  const longitude = parsed.geometry.coordinates[0];
  const latitude = parsed.geometry.coordinates[1];
  if (longitude === undefined || latitude === undefined) {
    throw new NasaPowerUnavailableError('NASA POWER no devolvió coordenadas de referencia.');
  }

  const annualBase = valuesAt(parsed.properties.parameter, 'ANN');
  const checkedAt = (options.checkedAt ?? new Date()).toISOString();
  return {
    checkedAt,
    latitude,
    longitude,
    elevationM: parsed.geometry.coordinates[2] ?? null,
    temporalRange: parsed.header.range,
    timeStandard: parsed.header.time_standard,
    apiVersion: parsed.header.api.version,
    sourceDatasets: parsed.header.sources,
    spatialResolution: NASA_POWER_SOLAR_RESOLUTION,
    license: NASA_POWER_LICENSE,
    attribution: NASA_POWER_ATTRIBUTION,
    annual: {
      ...annualBase,
      annualGhiKwhM2: annualBase.ghiKwhM2Day * 365,
      peakSunHoursDay: annualBase.ghiKwhM2Day,
    },
    monthly: MONTHS.map((month) => ({ month, ...valuesAt(parsed.properties.parameter, month) })),
    formulas: {
      annualGhiKwhM2: 'GHI anual = GHI medio diario × 365 días',
      peakSunHoursDay: 'Horas solares pico/día = GHI diario (kWh/m²/día) ÷ 1 kW/m²',
    },
    parameterUnits: Object.fromEntries(
      NASA_POWER_PARAMETERS.map((parameter) => [
        parameter,
        parsed.parameters[parameter]?.units ?? 'No publicada',
      ]),
    ),
  };
}
