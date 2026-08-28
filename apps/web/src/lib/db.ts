/**
 * The database handle, for server code in `apps/web`.
 *
 * SERVER ONLY. This module reaches better-sqlite3 and `node:fs`. Import it from
 * `createServerFn` handlers, API route handlers and `beforeLoad` guards — never
 * from a component, or Vite will try to bundle a native module for the browser.
 *
 * All persistence logic lives in `@territorio/db`; this file exists so route
 * code has one short, stable import.
 */
export {
  createAnalysis,
  deleteAnalysisForUser,
  getAnalysisByCoastalCacheKeyForUser,
  getAnalysisByRasterJobIdForUser,
  getAnalysisForUser,
  getDb,
  listAnalysesForUser,
  updateAnalysisForUser,
  type Analysis,
  type AnalysisStatus,
  type AoiGeometry,
  type TerritorioDb,
} from '@territorio/db';
