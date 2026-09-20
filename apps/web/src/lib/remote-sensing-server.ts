import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  REMOTE_SENSING_SOURCES,
  type LandsatPilotResult,
  type RemoteSensingPilotResult,
} from '@territorio/api-client';

import { getRasterApi } from './api';
import { fetchSession } from './session';

const pilotRequestSchema = z.object({
  source: z.enum(REMOTE_SENSING_SOURCES),
});

export type PilotInspectionResult =
  { ok: true; data: RemoteSensingPilotResult } | { ok: false; message: string };
export type LandsatRunResult =
  { ok: true; data: LandsatPilotResult } | { ok: false; message: string };

/** AOI pequeño y fijo para que el piloto compare todas las fuentes sobre la misma zona. */
const PILOT_AOI = {
  type: 'Polygon' as const,
  coordinates: [
    [
      [-69.95, 18.45],
      [-69.9, 18.45],
      [-69.9, 18.5],
      [-69.95, 18.5],
      [-69.95, 18.45],
    ],
  ],
};

export const inspectPilotSource = createServerFn({ method: 'POST' })
  .validator(pilotRequestSchema)
  .handler(async ({ data }): Promise<PilotInspectionResult> => {
    const user = await fetchSession();
    if (user === null) return { ok: false, message: 'Tenés que iniciar sesión.' };

    const result = await getRasterApi().inspectRemoteSensingPilotSource({
      source: data.source,
      aoi: PILOT_AOI,
      lookback_days: 21,
      max_cloud_cover: 30,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, data: result.data };
  });

export const runLandsatPilot = createServerFn({ method: 'POST' }).handler(
  async (): Promise<LandsatRunResult> => {
    const user = await fetchSession();
    if (user === null) return { ok: false, message: 'Tenés que iniciar sesión.' };

    const result = await getRasterApi().runLandsatPilot({
      aoi: PILOT_AOI,
      lookback_days: 90,
      max_cloud_cover: 30,
    });
    if (!result.ok) return { ok: false, message: result.message };
    return { ok: true, data: result.data };
  },
);
