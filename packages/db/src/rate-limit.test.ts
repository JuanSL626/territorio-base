/**
 * Unit coverage for the atomic upsert itself — window reset, concurrent
 * increments, per-key isolation. The end-to-end "the login endpoint actually
 * refuses attempt 6" behavior belongs to whatever wires Supabase Auth up to
 * `consumeRateLimit` (see `README.md` — that boundary left this package with
 * `web-boundary.ts`).
 *
 * Runs against a REAL Postgres — `rate_limit`'s CAS upsert is a property of
 * the database, not of the TypeScript, so a mock would not catch a regression
 * here. Unlike the old SQLite version, there is no `:memory:` equivalent for
 * Postgres (see `docs/supabase/03-datos-migracion.md` §4): point
 * `TEST_DATABASE_URL` (falling back to `DATABASE_URL`) at a disposable
 * Postgres — `supabase start`'s local stack, or a bare `postgres:17`
 * container — and the suite runs; otherwise it skips instead of failing the
 * whole package on machines/CI without Docker.
 */
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { consumeRateLimit, type RateLimitRule } from './rate-limit.ts';
import { type TerritorioDb, rateLimit, schema } from './schema.ts';

const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;

let client: ReturnType<typeof postgres> | null = null;
let db: TerritorioDb;

async function canConnect(url: string): Promise<boolean> {
  const probe = postgres(url, { max: 1, connect_timeout: 3 });
  try {
    await probe`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await probe.end({ timeout: 1 });
  }
}

const reachable = connectionString !== undefined && (await canConnect(connectionString));

describe.skipIf(!reachable)('consumeRateLimit', () => {
  beforeAll(async () => {
    if (connectionString === undefined) throw new Error('unreachable: guarded by `reachable` above');
    client = postgres(connectionString);
    db = drizzle({ client, schema });
    // No migration runner lives in this package any more (Supabase CLI owns
    // that, see `README.md`); a disposable test database gets just enough
    // schema to exercise the upsert.
    await client`
      create table if not exists rate_limit (
        id uuid primary key,
        key text not null,
        count bigint,
        last_request bigint
      )
    `;
    await client`
      create unique index if not exists rate_limit_key_unique on rate_limit (key)
    `;
  });

  afterAll(async () => {
    await client?.end();
  });

  beforeEach(async () => {
    await db.delete(rateLimit);
  });

  afterEach(async () => {
    await db.delete(rateLimit);
  });

  const rule: RateLimitRule = { windowSeconds: 60, max: 5 };

  it('allows exactly `max` attempts and refuses the next one', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const outcomes = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await consumeRateLimit(db, { bucket: 'sign-in', identifier: 'ana@ejemplo.do', rule, now }));
    }
    expect(outcomes.slice(0, 5).every((o) => o.ok)).toBe(true);
    const sixth = outcomes[5];
    expect(sixth?.ok).toBe(false);
    if (sixth?.ok === false) expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('keeps separate counters per bucket and per identifier', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 5; i += 1) {
      await consumeRateLimit(db, { bucket: 'sign-in', identifier: 'ana@ejemplo.do', rule, now });
    }
    // Same email, different endpoint: untouched.
    const signUp = await consumeRateLimit(db, { bucket: 'sign-up', identifier: 'ana@ejemplo.do', rule, now });
    expect(signUp.ok).toBe(true);
    // Different email, same endpoint: untouched.
    const otherEmail = await consumeRateLimit(db, { bucket: 'sign-in', identifier: 'beto@ejemplo.do', rule, now });
    expect(otherEmail.ok).toBe(true);
    // The original counter is still at its limit.
    const stillBlocked = await consumeRateLimit(db, { bucket: 'sign-in', identifier: 'ana@ejemplo.do', rule, now });
    expect(stillBlocked.ok).toBe(false);
  });

  it('resets the window once it elapses, rather than sliding on every attempt', async () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    for (let i = 0; i < 5; i += 1) {
      await consumeRateLimit(db, { bucket: 'sign-in', identifier: 'ana@ejemplo.do', rule, now: start });
    }
    const stillWithinWindow = await consumeRateLimit(db, {
      bucket: 'sign-in',
      identifier: 'ana@ejemplo.do',
      rule,
      now: new Date(start.getTime() + 59_000),
    });
    expect(stillWithinWindow.ok).toBe(false);

    const afterWindow = await consumeRateLimit(db, {
      bucket: 'sign-in',
      identifier: 'ana@ejemplo.do',
      rule,
      now: new Date(start.getTime() + 61_000),
    });
    expect(afterWindow.ok).toBe(true);
  });

  it('serializes concurrent attempts against the same key: exactly `max` succeed', async () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const attempts = await Promise.all(
      Array.from({ length: 8 }, async () =>
        await consumeRateLimit(db, { bucket: 'sign-in', identifier: 'concurrent@ejemplo.do', rule, now }),
      ),
    );
    expect(attempts.filter((o) => o.ok)).toHaveLength(5);
    expect(attempts.filter((o) => !o.ok)).toHaveLength(3);
  });
});
