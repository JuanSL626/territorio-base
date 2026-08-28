/**
 * Ownership-scoped access to the `analysis` table.
 *
 * Every read takes a `userId` and filters on it. There is no `getAnalysis(id)`
 * that skips the owner check, on purpose: an id-only accessor is how a report
 * route ends up serving somebody else's AOI to whoever guesses a uuid.
 *
 * The report route is "shareable" in the design brief only in the sense of
 * sharing a *link* with a colleague who has an account. Public, logged-out
 * sharing would need a `shareToken` column and a token-scoped read — a
 * deliberate product decision, not an oversight, and not built.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import {
  type Analysis,
  type AnalysisStatus,
  type AoiGeometry,
  type TerritorioDb,
  analysis,
} from './schema.ts';

export async function createAnalysis(
  db: TerritorioDb,
  params: {
    userId: string;
    aoiGeojson: AoiGeometry;
    name?: string | null;
    areaHa?: number | null;
    status?: AnalysisStatus;
  },
): Promise<Analysis> {
  const now = new Date();
  const rows = await db
    .insert(analysis)
    .values({
      id: randomUUID(),
      userId: params.userId,
      name: params.name ?? null,
      aoiGeojson: params.aoiGeojson,
      areaHa: params.areaHa ?? null,
      status: params.status ?? 'pending',
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const row = rows[0];
  if (row === undefined) throw new Error('No se pudo crear el análisis.');
  return row;
}

/** `undefined` when the analysis does not exist *or* is not this user's. */
export async function getAnalysisForUser(
  db: TerritorioDb,
  params: { id: string; userId: string },
): Promise<Analysis | undefined> {
  const rows = await db
    .select()
    .from(analysis)
    .where(and(eq(analysis.id, params.id), eq(analysis.userId, params.userId)))
    .limit(1);
  return rows[0];
}

/**
 * Owner-scoped lookup by the id the RASTER SERVICE knows (`raster_job_id`),
 * not by this table's own primary key.
 *
 * The overlay proxy (`apps/web/src/routes/api/**`) needs this because the
 * browser-facing overlay URL that `services/api` hands back is addressed by
 * ITS OWN job id (`/analysis/{raster_job_id}/overlay/dem.png`), not by the
 * app's `analysis.id` — the two are different UUIDs, generated on different
 * sides. `raster_job_id` isn't its own column (it lives inside `resultJson`,
 * set once the raster pipeline starts), resolved here with the jsonb `->>`
 * operator, backed by `analysis_raster_job_id_idx` (`schema.ts`) — replacing
 * what was a `json_extract(...)` full table scan in the SQLite predecessor.
 */
export async function getAnalysisByRasterJobIdForUser(
  db: TerritorioDb,
  params: { rasterJobId: string; userId: string },
): Promise<Analysis | undefined> {
  const rows = await db
    .select()
    .from(analysis)
    .where(
      and(
        eq(analysis.userId, params.userId),
        sql`${analysis.resultJson} ->> 'raster_job_id' = ${params.rasterJobId}`,
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Same idea as `getAnalysisByRasterJobIdForUser`, for the coastal overlay.
 *
 * The coastal cache is content-addressed (`sha256(aoi + preset)`,
 * `services/api`'s `coastal_cache_key`) and shared across whoever's AOI+preset
 * happens to match — it has no owner of its own. What's owned is the
 * ANALYSIS that attached it (`attachCoastal` writes `coastal.cache_key` into
 * `resultJson`), so that's what this checks: not "is this cache key secret"
 * but "did YOUR analysis actually request this scenario".
 *
 * Nested one level deeper than `raster_job_id`, hence `->` then `->>`,
 * matching `analysis_coastal_cache_key_idx` (`schema.ts`) exactly — a jsonb
 * expression index only gets used when the query expression matches it
 * structurally, not just semantically.
 */
export async function getAnalysisByCoastalCacheKeyForUser(
  db: TerritorioDb,
  params: { cacheKey: string; userId: string },
): Promise<Analysis | undefined> {
  const rows = await db
    .select()
    .from(analysis)
    .where(
      and(
        eq(analysis.userId, params.userId),
        sql`${analysis.resultJson} -> 'coastal' ->> 'cache_key' = ${params.cacheKey}`,
      ),
    )
    .limit(1);
  return rows[0];
}

/** Newest first, for the "mis análisis" list. */
export async function listAnalysesForUser(
  db: TerritorioDb,
  params: { userId: string; limit?: number },
): Promise<Analysis[]> {
  return await db
    .select()
    .from(analysis)
    .where(eq(analysis.userId, params.userId))
    .orderBy(desc(analysis.createdAt))
    .limit(params.limit ?? 50);
}

/**
 * Patch an analysis in place, owner-scoped.
 *
 * Returns `undefined` if nothing matched, so a caller cannot mistake "not yours"
 * for "saved".
 */
export async function updateAnalysisForUser(
  db: TerritorioDb,
  params: {
    id: string;
    userId: string;
    status?: AnalysisStatus;
    resultJson?: Record<string, unknown> | null;
    errorMessage?: string | null;
    name?: string | null;
    areaHa?: number | null;
  },
): Promise<Analysis | undefined> {
  const { id, userId, ...patch } = params;
  const rows = await db
    .update(analysis)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(analysis.id, id), eq(analysis.userId, userId)))
    .returning();
  return rows[0];
}

export async function deleteAnalysisForUser(
  db: TerritorioDb,
  params: { id: string; userId: string },
): Promise<boolean> {
  const rows = await db
    .delete(analysis)
    .where(and(eq(analysis.id, params.id), eq(analysis.userId, params.userId)))
    .returning({ id: analysis.id });
  return rows.length > 0;
}
