/**
 * Invite codes — the only door into the app.
 *
 * Sign-up is closed. `POST /api/auth/sign-up/email` succeeds only when the body
 * carries an `inviteCode` that is unknown to nobody, unused, unexpired, and (if
 * the invite was pinned to an address) redeemed by that address.
 *
 * The single-use guarantee is a **one-statement conditional UPDATE**, not a
 * read-then-write:
 *
 *     UPDATE invite SET used_at = ? WHERE code = ? AND used_at IS NULL ...
 *
 * SQLite serializes writers, so exactly one of two concurrent sign-ups gets a
 * row back and the other gets zero. A `SELECT … then UPDATE` would let both
 * through. This matters more than it looks: the Drizzle adapter's `transaction`
 * option is deliberately off (see `auth.ts`), so there is no surrounding
 * transaction to save us.
 */
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm';
import { randomBytes, randomUUID } from 'node:crypto';

import { type Invite, type TerritorioDb, invite } from './schema.ts';

/**
 * Crockford base32: no I, L, O or U, so a code read over the phone survives.
 * 32 symbols is a power of two, so `byte & 31` maps bytes to symbols without
 * modulo bias.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LENGTH = 12;
const GROUP_SIZE = 4;

/** Confusable characters a human might type, mapped the Crockford way. */
const CONFUSABLES: Record<string, string> = { I: '1', L: '1', O: '0', U: 'V' };

/** Uppercase, de-confuse, drop separators. Storage and lookup both use this. */
export function normalizeInviteCode(raw: string): string {
  let out = '';
  for (const char of raw.toUpperCase()) {
    const mapped = CONFUSABLES[char] ?? char;
    if (ALPHABET.includes(mapped)) out += mapped;
  }
  return out;
}

/** `ABCD-EFGH-JKMN` — for printing and for emailing. Storage stays normalized. */
export function formatInviteCode(code: string): string {
  const normalized = normalizeInviteCode(code);
  const groups: string[] = [];
  for (let i = 0; i < normalized.length; i += GROUP_SIZE) {
    groups.push(normalized.slice(i, i + GROUP_SIZE));
  }
  return groups.join('-');
}

/** 12 symbols ≈ 60 bits of entropy, from `node:crypto`. */
export function generateInviteCode(): string {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (const byte of bytes) code += ALPHABET[byte & 31] ?? '0';
  return code;
}

export const INVITE_REJECTIONS = [
  'missing',
  'unknown',
  'used',
  'expired',
  'email-mismatch',
] as const;
export type InviteRejection = (typeof INVITE_REJECTIONS)[number];

/**
 * User-facing Spanish copy. Deliberately vague about *why* a code is bad in the
 * `unknown` case — an invite code is a bearer credential and "ese código no
 * existe" vs "ese código ya se usó" is a probe an attacker can run.
 */
const REJECTION_MESSAGES: Record<InviteRejection, string> = {
  missing: 'Se requiere un código de invitación para crear una cuenta.',
  unknown: 'El código de invitación no es válido.',
  used: 'Ese código de invitación ya fue utilizado.',
  expired: 'Ese código de invitación venció.',
  'email-mismatch': 'Ese código de invitación fue emitido para otro correo.',
};

export function inviteRejectionMessage(reason: InviteRejection): string {
  return REJECTION_MESSAGES[reason];
}

/**
 * Machine-readable code per rejection, carried on the thrown `APIError`.
 *
 * The UI needs to tell "already used" apart from every other failure (different
 * copy, different next step), and matching on a translated `message` string is
 * how that silently breaks the first time someone rewords the Spanish.
 */
export const INVITE_ERROR_CODES: Record<InviteRejection, string> = {
  missing: 'INVITE_REQUIRED',
  unknown: 'INVITE_INVALID',
  used: 'INVITE_ALREADY_USED',
  expired: 'INVITE_EXPIRED',
  'email-mismatch': 'INVITE_EMAIL_MISMATCH',
};

export type InviteCheck =
  { ok: true; invite: Invite } | { ok: false; reason: InviteRejection; message: string };

function reject(reason: InviteRejection): InviteCheck {
  return { ok: false, reason, message: REJECTION_MESSAGES[reason] };
}

function normalizeEmail(email: string | null | undefined): string | null {
  return email === null || email === undefined ? null : email.trim().toLowerCase();
}

/**
 * Read-only validation. Cheap, precise error messages, no side effects.
 *
 * Use it to reject a sign-up *before* Better Auth hashes a password. It is not
 * the enforcement point — `claimInvite` is.
 */
export async function checkInvite(
  db: TerritorioDb,
  params: { code: string | null | undefined; email?: string | null },
): Promise<InviteCheck> {
  const code =
    params.code === null || params.code === undefined ? '' : normalizeInviteCode(params.code);
  if (code === '') return reject('missing');

  const rows = await db.select().from(invite).where(eq(invite.code, code)).limit(1);
  const row = rows[0];
  if (row === undefined) return reject('unknown');
  if (row.usedAt !== null) return reject('used');
  if (row.expiresAt !== null && row.expiresAt.getTime() <= Date.now()) return reject('expired');

  const pinned = normalizeEmail(row.email);
  if (pinned !== null && pinned !== normalizeEmail(params.email)) return reject('email-mismatch');

  return { ok: true, invite: row };
}

/**
 * Consume an invite, atomically. This is the enforcement point.
 *
 * Returns `ok: false` when the conditional UPDATE matched nothing; the precise
 * reason is then re-derived with a follow-up read, which is safe because at that
 * point we have already lost the race and are only choosing an error message.
 */
export async function claimInvite(
  db: TerritorioDb,
  params: { code: string | null | undefined; email?: string | null; userId?: string | null },
): Promise<InviteCheck> {
  const code =
    params.code === null || params.code === undefined ? '' : normalizeInviteCode(params.code);
  if (code === '') return reject('missing');

  const now = new Date();
  const email = normalizeEmail(params.email);

  const claimed = await db
    .update(invite)
    .set({ usedAt: now, usedByUserId: params.userId ?? null })
    .where(
      and(
        eq(invite.code, code),
        isNull(invite.usedAt),
        or(isNull(invite.expiresAt), gt(invite.expiresAt, now)),
        email === null ? isNull(invite.email) : or(isNull(invite.email), eq(invite.email, email)),
      ),
    )
    .returning();

  const row = claimed[0];
  if (row !== undefined) return { ok: true, invite: row };

  return await checkInvite(db, params);
}

/**
 * Attach the created user to an invite this request already claimed.
 *
 * Scoped to `used_by_user_id IS NULL` so a replayed or racing call can never
 * re-point a historical invite at a different account.
 */
export async function attachInviteUserByCode(
  db: TerritorioDb,
  code: string,
  userId: string,
): Promise<void> {
  await db
    .update(invite)
    .set({ usedByUserId: userId })
    .where(and(eq(invite.code, normalizeInviteCode(code)), isNull(invite.usedByUserId)));
}

/**
 * Mint an invite.
 *
 * `email` pins the code to one address; leave it out for a code that anyone who
 * receives it can redeem.
 *
 * `expiresInDays` is deliberately three-valued, because "no expiry" must be
 * something you *ask for*, never something you fall into:
 *
 *   omitted → 14 days. An invite with no expiry is a permanent open
 *             registration you forgot about.
 *   `null`  → never expires. Explicit.
 *   number  → that many days from now. Negative values produce an
 *             already-expired invite, which is what the tests want.
 */
export async function createInvite(
  db: TerritorioDb,
  params: {
    email?: string | null;
    createdBy?: string | null;
    note?: string | null;
    expiresInDays?: number | null;
  } = {},
): Promise<{ invite: Invite; code: string; formattedCode: string }> {
  const code = generateInviteCode();
  const days = params.expiresInDays === undefined ? 14 : params.expiresInDays;
  const expiresAt = days === null ? null : new Date(Date.now() + days * 24 * 60 * 60 * 1000);

  const rows = await db
    .insert(invite)
    .values({
      id: randomUUID(),
      code,
      email: normalizeEmail(params.email),
      createdBy: params.createdBy ?? null,
      note: params.note ?? null,
      createdAt: new Date(),
      expiresAt,
    })
    .returning();

  const row = rows[0];
  if (row === undefined) throw new Error('No se pudo crear la invitación.');
  return { invite: row, code, formattedCode: formatInviteCode(code) };
}

/** Newest first. `includeUsed` defaults to false — the useful view is "pending". */
export async function listInvites(
  db: TerritorioDb,
  options: { includeUsed?: boolean } = {},
): Promise<Invite[]> {
  const all = options.includeUsed === true;
  return await db
    .select()
    .from(invite)
    .where(all ? undefined : isNull(invite.usedAt))
    .orderBy(desc(invite.createdAt));
}

/** Burn an unused invite without handing it to anybody. */
export async function revokeInvite(db: TerritorioDb, code: string): Promise<boolean> {
  const revoked = await db
    .update(invite)
    .set({ usedAt: new Date(), note: 'revocada' })
    .where(and(eq(invite.code, normalizeInviteCode(code)), isNull(invite.usedAt)))
    .returning();
  return revoked.length > 0;
}
