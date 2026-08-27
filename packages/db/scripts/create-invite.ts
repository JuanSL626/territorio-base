/**
 * Mint, list and revoke invite codes.
 *
 *   pnpm --filter @territorio/db db:create-invite
 *   pnpm --filter @territorio/db db:create-invite -- --email ana@ejemplo.do --days 7 --note "equipo SIG"
 *   pnpm --filter @territorio/db db:create-invite -- --list
 *   pnpm --filter @territorio/db db:create-invite -- --revoke ABCD-EFGH-JKMN
 *
 * `--email` pins the code to one address: nobody else can redeem it even if the
 * code leaks. Without it, the code works for whoever holds it — which is why
 * `--days` defaults to 14, and why a code that never expires takes an explicit
 * `--sin-vencimiento`.
 *
 * Only `DATABASE_URL` is read; no auth secret needed.
 */
import { parseArgs } from 'node:util';

import { cliArgs } from './argv.ts';
import { closeDb, getDb } from '../src/client.ts';
import { getDatabaseFile } from '../src/env.ts';
import { createInvite, formatInviteCode, listInvites, revokeInvite } from '../src/invites.ts';

const { values } = parseArgs({
  args: cliArgs(),
  options: {
    email: { type: 'string' },
    days: { type: 'string' },
    'sin-vencimiento': { type: 'boolean', default: false },
    note: { type: 'string' },
    list: { type: 'boolean', default: false },
    all: { type: 'boolean', default: false },
    revoke: { type: 'string' },
  },
  allowPositionals: false,
});

const db = getDb(getDatabaseFile());

function formatDate(date: Date | null): string {
  return date === null ? '—' : date.toISOString().slice(0, 16).replace('T', ' ');
}

if (values.revoke !== undefined) {
  const revoked = await revokeInvite(db, values.revoke);
  console.log(
    revoked
      ? `Invitación ${formatInviteCode(values.revoke)} revocada.`
      : `No hay ninguna invitación sin usar con el código ${formatInviteCode(values.revoke)}.`,
  );
} else if (values.list) {
  const invites = await listInvites(db, { includeUsed: values.all });
  if (invites.length === 0) {
    console.log('No hay invitaciones pendientes.');
  } else {
    console.log(['CÓDIGO', 'CORREO', 'VENCE', 'USADA', 'NOTA'].join('\t'));
    for (const row of invites) {
      console.log(
        [
          formatInviteCode(row.code),
          row.email ?? '(cualquiera)',
          formatDate(row.expiresAt),
          formatDate(row.usedAt),
          row.note ?? '',
        ].join('\t'),
      );
    }
  }
} else {
  const days = values.days === undefined ? 14 : Number.parseInt(values.days, 10);
  if (values.days !== undefined && (Number.isNaN(days) || days <= 0)) {
    console.error(
      `--days debe ser un número entero de días mayor que 0; recibí "${values.days}". Para una invitación sin vencimiento usá --sin-vencimiento.`,
    );
    process.exitCode = 1;
  } else if (values['sin-vencimiento'] && values.days !== undefined) {
    console.error('--days y --sin-vencimiento se contradicen. Elegí uno.');
    process.exitCode = 1;
  } else {
    const created = await createInvite(db, {
      email: values.email,
      note: values.note,
      expiresInDays: values['sin-vencimiento'] ? null : days,
    });
    console.log(`Código de invitación: ${created.formattedCode}`);
    console.log(`Para:                 ${created.invite.email ?? '(cualquiera)'}`);
    console.log(`Vence:                ${formatDate(created.invite.expiresAt)}`);
    console.log('');
    console.log('Se canjea en /registro, en el campo "Código de invitación".');
  }
}

closeDb();
