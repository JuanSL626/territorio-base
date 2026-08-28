/**
 * End-to-end coverage against the real `webAuthBoundary` — real Better Auth,
 * real in-memory SQLite with the checked-in migrations, no mocks. These are
 * the two properties an adversarial review found broken:
 *
 *   1. The Nth+1 sign-in attempt for one email is actually refused (not just
 *      that `consumeRateLimit` exists — `rate-limit.test.ts` covers that).
 *   2. Two concurrent sign-ups for the same email with two different invite
 *      codes leave exactly one account and exactly one consumed invite —
 *      never a burned invite with nobody behind it.
 */
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resetAuthInstance } from './auth.ts';
import { closeDb, getDb } from './client.ts';
import { resetEnvCache } from './env.ts';
import { claimInvite, createInvite, listInvites } from './invites.ts';
import { user } from './schema.ts';
import { webAuthBoundary } from './web-boundary.ts';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

function headers(): Headers {
  return new Headers();
}

beforeEach(() => {
  // `getAuth()` builds its instance from `getEnv()` + the default `getDb()`
  // (no explicit file), so both have to agree this process is in-memory.
  process.env.BETTER_AUTH_SECRET = 'a'.repeat(32);
  process.env.BETTER_AUTH_URL = 'http://localhost:3000';
  process.env.DATABASE_URL = ':memory:';
  resetEnvCache();
  resetAuthInstance();

  const db = getDb(':memory:');
  migrate(db, { migrationsFolder });
});

afterEach(() => {
  closeDb();
  resetAuthInstance();
  resetEnvCache();
  delete process.env.BETTER_AUTH_SECRET;
  delete process.env.BETTER_AUTH_URL;
  delete process.env.DATABASE_URL;
});

describe('rate limiting (live, through the boundary)', () => {
  it('refuses the 6th sign-in attempt for the same email within the window', async () => {
    const email = 'ana@ejemplo.do';
    const outcomes: Awaited<ReturnType<typeof webAuthBoundary.signIn>>[] = [];
    for (let i = 0; i < 6; i += 1) {
      outcomes.push(await webAuthBoundary.signIn({ email, password: 'wrong-password' }, headers()));
    }

    // Attempts 1-5: the account doesn't exist, so each is a normal
    // credentials failure — never the rate-limit code yet.
    for (const outcome of outcomes.slice(0, 5)) {
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) expect(outcome.code).not.toBe('demasiados-intentos');
    }

    // Attempt 6: refused before Better Auth is even called.
    const sixth = outcomes[5];
    expect(sixth?.ok).toBe(false);
    if (sixth?.ok === false) {
      expect(sixth.code).toBe('demasiados-intentos');
      expect(sixth.retryAfterSeconds).toBeGreaterThan(0);
    }
  });

  it('keeps sign-in and sign-up counters independent for the same email', async () => {
    const email = 'beto@ejemplo.do';
    for (let i = 0; i < 5; i += 1) {
      await webAuthBoundary.signIn({ email, password: 'wrong-password' }, headers());
    }
    const { code } = await createInvite(getDb());
    const signUpResult = await webAuthBoundary.signUp(
      { name: 'Beto', email, password: 'password123', inviteCode: code },
      headers(),
    );
    expect(signUpResult.ok).toBe(true);
  });
});

describe('sign-up invite race', () => {
  it('leaves exactly one account and exactly one consumed invite for two concurrent sign-ups racing the same email', async () => {
    const db = getDb();
    const email = 'carla@ejemplo.do';
    const inviteA = await createInvite(db);
    const inviteB = await createInvite(db);

    const [r1, r2] = await Promise.all([
      webAuthBoundary.signUp(
        { name: 'Carla', email, password: 'password123', inviteCode: inviteA.code },
        headers(),
      ),
      webAuthBoundary.signUp(
        { name: 'Carla', email, password: 'password123', inviteCode: inviteB.code },
        headers(),
      ),
    ]);

    const outcomes = [r1, r2];
    expect(outcomes.filter((o) => o.ok)).toHaveLength(1);

    const users = await db.select().from(user).where(eq(user.email, email));
    expect(users).toHaveLength(1);

    const invites = await listInvites(db, { includeUsed: true });
    const consumed = invites.filter((invite) => invite.usedAt !== null);
    expect(consumed).toHaveLength(1);
    expect(consumed[0]?.usedByUserId).toBe(users[0]?.id);

    // The loser's invite was released, not burned: a third party can still
    // redeem it.
    const loserCode = consumed[0]?.code === inviteA.code ? inviteB.code : inviteA.code;
    const reclaim = await claimInvite(db, { code: loserCode, email: 'otra@ejemplo.do' });
    expect(reclaim.ok).toBe(true);
  });
});
