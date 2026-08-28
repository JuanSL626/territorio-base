/**
 * The invite gate is the whole access-control story, so its edges are tested
 * rather than assumed. Runs against a real in-memory SQLite with the checked-in
 * migrations applied — not a mock — because the properties under test
 * (single-use claiming, the unique index, `IS NULL` matching) are properties of
 * the database, not of the TypeScript.
 */
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, getDb } from './client.ts';
import {
  checkInvite,
  claimInvite,
  createInvite,
  formatInviteCode,
  generateInviteCode,
  listInvites,
  normalizeInviteCode,
  revokeInvite,
} from './invites.ts';
import { type TerritorioDb, invite } from './schema.ts';

const migrationsFolder = resolve(dirname(fileURLToPath(import.meta.url)), '../drizzle');

let db: TerritorioDb;

beforeEach(() => {
  db = getDb(':memory:');
  migrate(db, { migrationsFolder });
});

afterEach(() => {
  closeDb();
});

describe('normalizeInviteCode', () => {
  it('strips separators, uppercases, and folds Crockford confusables', () => {
    expect(normalizeInviteCode('abcd-efgh jkmn')).toBe('ABCDEFGHJKMN');
    expect(normalizeInviteCode('io lu')).toBe('101V');
  });

  it('round-trips through the display format', () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(formatInviteCode(code))).toBe(code);
  });
});

describe('generateInviteCode', () => {
  it('only emits alphabet symbols, at the expected length', () => {
    for (let i = 0; i < 200; i += 1) {
      expect(generateInviteCode()).toMatch(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{12}$/);
    }
  });
});

describe('claimInvite', () => {
  it('accepts a code typed with dashes and in lowercase', async () => {
    const { code } = await createInvite(db);
    const result = await claimInvite(db, { code: formatInviteCode(code).toLowerCase() });
    expect(result.ok).toBe(true);
  });

  it('is single-use: the second claim of the same code fails', async () => {
    const { code } = await createInvite(db);

    const first = await claimInvite(db, { code });
    const second = await claimInvite(db, { code });

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe('used');
  });

  it('refuses an expired code', async () => {
    const { code } = await createInvite(db, { expiresInDays: -1 });
    const result = await claimInvite(db, { code });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('expired');
  });

  it('refuses a pinned code redeemed by another address', async () => {
    const { code } = await createInvite(db, { email: 'Ana@Ejemplo.DO' });

    const wrong = await claimInvite(db, { code, email: 'otro@ejemplo.do' });
    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.reason).toBe('email-mismatch');

    const right = await claimInvite(db, { code, email: '  ana@ejemplo.do ' });
    expect(right.ok).toBe(true);
  });

  it('refuses an unknown or empty code', async () => {
    expect((await claimInvite(db, { code: 'ZZZZZZZZZZZZ' })).ok).toBe(false);
    const empty = await claimInvite(db, { code: '' });
    expect(empty.ok).toBe(false);
    if (!empty.ok) expect(empty.reason).toBe('missing');
  });

  it('leaves the invite untouched when it refuses', async () => {
    const { code } = await createInvite(db, { email: 'ana@ejemplo.do' });
    await claimInvite(db, { code, email: 'otro@ejemplo.do' });

    const still = await checkInvite(db, { code, email: 'ana@ejemplo.do' });
    expect(still.ok).toBe(true);
  });
});

describe('listInvites / revokeInvite', () => {
  it('lists pending invites by default and everything with includeUsed', async () => {
    const pending = await createInvite(db);
    const spent = await createInvite(db);
    await claimInvite(db, { code: spent.code });

    // The unique index is part of the contract, not an implementation detail.
    expect(await db.select().from(invite)).toHaveLength(2);

    const openOnly = await listInvites(db);
    expect(openOnly.map((row) => row.code)).toEqual([pending.code]);

    const all = await listInvites(db, { includeUsed: true });
    expect(all).toHaveLength(2);
  });

  it('revokes an unused invite once, and reports the second attempt', async () => {
    const { code } = await createInvite(db);
    expect(await revokeInvite(db, code)).toBe(true);
    expect(await revokeInvite(db, code)).toBe(false);

    const result = await claimInvite(db, { code });
    expect(result.ok).toBe(false);
  });
});
