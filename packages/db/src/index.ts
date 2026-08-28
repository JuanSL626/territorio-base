// @territorio/db — Drizzle + Supabase Postgres. Schema and the database
// client live here; ownership-scoped queries for `analysis` and the
// `rate_limit` upsert are the whole surface.
//
// SERVER ONLY. Every export in this barrel reaches `node:crypto` or the
// Postgres connection. Import it from server functions, `beforeLoad` guards
// and scripts — never from a component.
export { closeDb, getDb, getSql } from './client.ts';

export { getEnv, resetEnvCache, type Env } from './env.ts';

export {
  createAnalysis,
  deleteAnalysisForUser,
  getAnalysisByCoastalCacheKeyForUser,
  getAnalysisByRasterJobIdForUser,
  getAnalysisForUser,
  listAnalysesForUser,
  updateAnalysisForUser,
} from './analyses.ts';

export { consumeRateLimit, type RateLimitOutcome, type RateLimitRule } from './rate-limit.ts';

export {
  analysis,
  ANALYSIS_STATUSES,
  analysisStatus,
  rateLimit,
  schema,
  type Analysis,
  type AnalysisStatus,
  type AoiGeometry,
  type NewAnalysis,
  type TerritorioDb,
} from './schema.ts';
