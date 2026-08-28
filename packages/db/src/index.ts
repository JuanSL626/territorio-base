// @territorio/db — Drizzle + SQLite + Better Auth (invite-only, email+password,
// httpOnly session cookie). Schema, client and auth wiring live here.
//
// SERVER ONLY. Every export in this barrel reaches `node:fs`, `node:crypto` or
// better-sqlite3. Import it from server functions, `beforeLoad` guards and
// scripts — never from a component.
export { closeDb, getDb, getSqlite } from './client.ts';

export { getDatabaseFile, getEnv, resetEnvCache, resolveDatabaseFile, type Env } from './env.ts';

export {
  buildAuthOptions,
  createAuth,
  getAuth,
  INVITE_CODE_FIELD,
  signUpWithInvite,
  type Auth,
  type BuildAuthOptionsInput,
  type SignUpWithInviteParams,
} from './auth.ts';

export {
  attachInviteUserByCode,
  checkInvite,
  claimInvite,
  createInvite,
  formatInviteCode,
  generateInviteCode,
  INVITE_REJECTIONS,
  inviteRejectionMessage,
  listInvites,
  normalizeInviteCode,
  revokeInvite,
  type InviteCheck,
  type InviteRejection,
} from './invites.ts';

export {
  createAnalysis,
  deleteAnalysisForUser,
  getAnalysisByCoastalCacheKeyForUser,
  getAnalysisByRasterJobIdForUser,
  getAnalysisForUser,
  listAnalysesForUser,
  updateAnalysisForUser,
} from './analyses.ts';

export {
  account,
  analysis,
  ANALYSIS_STATUSES,
  invite,
  rateLimit,
  schema,
  session,
  user,
  verification,
  type Account,
  type Analysis,
  type AnalysisStatus,
  type AoiGeometry,
  type Invite,
  type NewAnalysis,
  type NewInvite,
  type NewUser,
  type Session,
  type TerritorioDb,
  type User,
  type Verification,
} from './schema.ts';

export {
  webAuthBoundary,
  type WebAuthBoundary,
  type WebAuthErrorCode,
  type WebAuthOutcome,
  type WebSessionUser,
  type WebSignInInput,
  type WebSignUpInput,
} from './web-boundary.ts';
