/**
 * Ownership-scoped access to the `analysis` table.
 *
 * Every read takes a `userId` and filters on it. There is no `getAnalysis(id)`
 * that skips the owner check, on purpose: an id-only accessor is how a report
 * route ends up serving somebody else's AOI to whoever guesses a uuid.
 *
 * The report route is described as "shareable" in the design brief. Sharing a
 * *link* with a colleague who has an account works today. Public, logged-out
 * sharing would need a `shareToken` column and a second, token-scoped read —
 * that is a deliberate product decision, not an oversight, and it is not built.
 */
import { and, desc, eq } from 'drizzle-orm';
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
