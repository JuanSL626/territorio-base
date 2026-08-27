import { useQuery } from '@tanstack/react-query';

import type { TerritorioAnalysis } from '~/lib/analysis-contract';

import { analysisFromResult, analysisQueryOptions } from '~/lib/analysis-queries';

/**
 * El análisis que el mapa tiene que pintar, o `null` mientras no haya AOI.
 *
 * Vive acá y no en la ruta para que el cableado del mapa sea una línea: la
 * ruta pasa `search.aoi` y recibe el objeto listo. La query es la MISMA que
 * usan el panel de análisis y el reporte (`analysisKeys.detail`), así que el
 * resultado se comparte por caché y no se pide dos veces.
 */
export function useMapAnalysis(analysisId: string | undefined): TerritorioAnalysis | null {
  const query = useQuery({
    ...analysisQueryOptions(analysisId ?? ''),
    enabled: analysisId !== undefined,
  });
  return analysisId === undefined ? null : analysisFromResult(query.data);
}
