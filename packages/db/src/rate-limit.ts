/**
 * Login/sign-up rate limiting — the real enforcement.
 *
 * Supabase Auth (GoTrue) has no hook for per-identifier throttling of
 * sign-in/sign-up attempts, so this module does that job: whatever calls
 * into Supabase Auth for `/sign-in`/`/sign-up` calls `consumeRateLimit`
 * first — that wiring is the auth agent's, this table and this function are
 * the mechanism.
 *
 * Keyed by the identifier under attack (normalized email), not by IP. No
 * reverse proxy is required in front of this app, so `X-Forwarded-For` would
 * be attacker-controlled here — trusting it would let an attacker rotate the
 * header per request and never hit the same counter twice. The email being
 * guessed can't be rotated away; it's the entire point of the attack.
 *
 * No `NODE_ENV` gate: a brute-force control that only runs in production
 * cannot be verified outside it. This one is always active.
 *
 * Fixed window, one atomic upsert per attempt: `rate_limit.key` is unique
 * (see `schema.ts`), so `INSERT ... ON CONFLICT DO UPDATE` either creates the
 * counter or advances it in a single statement — no read-then-write gap for
 * two concurrent attempts to both slip through under the limit. The window
 * starts at the first attempt in it and does not slide on later attempts, so
 * continued hammering cannot itself keep postponing the reset. `count` and
 * `last_request` stay `bigint` (epoch ms) precisely so this CAS expression's
 * integer arithmetic needs no rewriting — see `schema.ts`.
 */
import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import { type TerritorioDb, rateLimit } from './schema.ts';

export type RateLimitRule = { windowSeconds: number; max: number };

export type RateLimitOutcome = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * Consume one attempt against `bucket:identifier`. Every call — successful
 * or not — counts (a rule per path, not per failure).
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
