/**
 * Unit coverage for the atomic upsert itself — window reset, concurrent
 * increments, per-key isolation. The end-to-end "the login endpoint actually
 * refuses attempt 6" behavior is covered in `web-boundary.test.ts`, against
 * the real `webAuthBoundary.signIn`.
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from './client.ts';
import { consumeRateLimit, type RateLimitRule } from './rate-limit.ts';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

let db: ReturnType<typeof getDb>;

beforeEach(() => {
  db = getDb(':memory:');
  migrate(db, { migrationsFolder });
});

afterEach(() => {
  closeDb();
});

const rule: RateLimitRule = { windowSeconds: 60, max: 5 };

describe('consumeRateLimit', () => {
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
