/**
 * Create the first administrator.
 *
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... pnpm --filter @territorio/db db:seed
 *   pnpm --filter @territorio/db db:seed -- --name "Juan López"
 *
 * The bootstrap user is created through the **same invite-gated sign-up path as
 * everyone else**: the script mints an invite pinned to `ADMIN_EMAIL` and
 * immediately redeems it. There is deliberately no back door that writes a user
 * row directly — if such a path existed, it would also be the path a future bug
 * takes to create an unauthorized account.
 *
 * Idempotent: running it twice reports the existing user and changes nothing.
 */
import { eq } from 'drizzle-orm';
import { parseArgs } from 'node:util';

import { cliArgs } from './argv.ts';
import { createAuth, signUpWithInvite } from '../src/auth.ts';
import { closeDb, getDb } from '../src/client.ts';
import { getEnv } from '../src/env.ts';
import { createInvite } from '../src/invites.ts';
import { user } from '../src/schema.ts';

const { values } = parseArgs({
  args: cliArgs(),
  options: { name: { type: 'string' } },
  allowPositionals: false,
});

const env = getEnv();
const email = env.ADMIN_EMAIL;
const password = env.ADMIN_PASSWORD;

if (email === undefined || password === undefined) {
  console.error(
    'Faltan ADMIN_EMAIL y/o ADMIN_PASSWORD. Definilas en .env (ver .env.example) antes de correr el seed.',
  );
  process.exitCode = 1;
} else {
  const db = getDb();
  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);

  if (existing[0] !== undefined) {
    console.log(`Ya existe un usuario con ${normalizedEmail}. Nada que hacer.`);
    closeDb();
  } else {
    const localPart = normalizedEmail.split('@')[0] ?? 'admin';
    const name = values.name ?? localPart;

    const { code } = await createInvite(db, {
      email: normalizedEmail,
      note: 'bootstrap (seed)',
      expiresInDays: 1,
    });

    const auth = createAuth({ db });
    await signUpWithInvite(auth, { name, email: normalizedEmail, password, inviteCode: code });

    console.log(`Usuario administrador creado: ${normalizedEmail}`);
    console.log('Iniciá sesión en /login y creá invitaciones con `db:create-invite`.');
    closeDb();
  }
}
