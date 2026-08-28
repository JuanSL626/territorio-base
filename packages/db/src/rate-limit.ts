/**
 * Login/sign-up rate limiting — the real enforcement.
 *
 * `auth.ts` used to configure Better Auth's own `rateLimit` option
 * (`customRules` for `/sign-in/email`, `/sign-up/email`, `/forget-password`).
 * That option only ever takes effect through `auth.handler()`'s router
 * `onRequest` hook (better-call) — the individual endpoint definitions attach
 * no rate-limit middleware of their own. This app never dispatches a Request
 * through that handler: `web-boundary.ts` calls `.api.signInEmail()` /
 * `.signUpEmail()` directly with `asResponse: true` (see its header for why).
 * The config was therefore dead code — confirmed live, 8 straight
 * wrong-password attempts all returned 200 with no delay. This module is
 * what `web-boundary.ts` calls instead, *before* delegating to Better Auth.
 *
 * Keyed by the identifier under attack (normalized email), not by IP. No
 * reverse proxy is required in front of this app, so `X-Forwarded-For` would
 * be attacker-controlled here — trusting it would let an attacker rotate the
 * header per request and never hit the same counter twice. The email being
 * guessed can't be rotated away; it's the entire point of the attack.
 *
 * No `NODE_ENV` gate. A brute-force control that only runs in production
 * cannot be verified outside it, and this app's Docker Compose stack already
 * runs with `NODE_ENV=production` (see `auth.ts`) — that gate is exactly why
 * the dead config's absence went unnoticed live. This one is always active.
 *
 * Fixed window, one atomic upsert per attempt: `rate_limit.key` is unique
 * (see `schema.ts`), so `INSERT ... ON CONFLICT DO UPDATE` either creates the
 * counter or advances it in a single statement — no read-then-write gap for
 * two concurrent attempts to both slip through under the limit. The window
 * starts at the first attempt in it and does not slide on later attempts, so
 * continued hammering cannot itself keep postponing the reset.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { type TerritorioDb, rateLimit } from './schema.ts';

export type RateLimitRule = { windowSeconds: number; max: number };

export type RateLimitOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Consume one attempt against `bucket:identifier`. Every call — successful or
 * not — counts, matching the endpoint-level semantics the dead config used to
 * declare (a rule per path, not per failure).
 */
export async function consumeRateLimit(
  db: TerritorioDb,
  params: { bucket: string; identifier: string; rule: RateLimitRule; now?: Date },
): Promise<RateLimitOutcome> {
  const key = `${params.bucket}:${params.identifier}`;
  const now = (params.now ?? new Date()).getTime();
  const windowMs = params.rule.windowSeconds * 1000;

  const rows = await db
    .insert(rateLimit)
    .values({ id: randomUUID(), key, count: 1, lastRequest: now })
    .onConflictDoUpdate({
      target: rateLimit.key,
      set: {
        // Unqualified columns on the right-hand side read the row's value
        // *before* this update — that's what makes the reset-vs-increment
        // decision atomic instead of a separate read.
        count: sql`case when (${now} - ${rateLimit.lastRequest}) > ${windowMs} then 1 else ${rateLimit.count} + 1 end`,
        lastRequest: sql`case when (${now} - ${rateLimit.lastRequest}) > ${windowMs} then ${now} else ${rateLimit.lastRequest} end`,
      },
    })
    .returning();

  const row = rows[0];
  if (row?.count === null || row?.count === undefined || row.lastRequest === null) return { ok: true };
  if (row.count <= params.rule.max) return { ok: true };

  const elapsedMs = now - row.lastRequest;
  const retryAfterSeconds = Math.max(1, Math.ceil((windowMs - elapsedMs) / 1000));
  return { ok: false, retryAfterSeconds };
}
