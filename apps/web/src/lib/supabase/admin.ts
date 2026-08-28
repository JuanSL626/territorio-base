/**
 * Supabase admin client — `service_role`, SERVER ONLY.
 *
 * This key bypasses RLS entirely and grants the Admin API (`auth.admin.*`,
 * including `inviteUserByEmail`). It must never reach the browser bundle —
 * that's why it has no `VITE_` prefix (see `.env.example`) and why this
 * module is only ever imported from `~/lib/session`'s `createServerFn`
 * handlers, which TanStack Start strips from the client bundle.
 *
 * Deliberately NOT `@supabase/ssr`'s `createServerClient`: the admin API acts
 * as the project itself, not on behalf of a visitor's cookie session, so
 * there's nothing to read/write there. A plain `@supabase/supabase-js` client
 * with `persistSession: false` is memoized (unlike the per-request SSR
 * client) because it carries no per-visitor state.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | undefined;

function readEnv(name: 'VITE_SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} falta. Copiá .env.example a .env y completá la sección Supabase.`);
  }
  return value;
}

export function getSupabaseAdminClient(): SupabaseClient {
  if (client !== undefined) return client;
  client = createClient(readEnv('VITE_SUPABASE_URL'), readEnv('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return client;
}
