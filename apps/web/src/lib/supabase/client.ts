/**
 * Supabase browser client. One instance per tab — memoized module-level,
 * unlike `~/lib/supabase/server`, because in the browser there is only ever
 * one visitor's cookies to worry about.
 *
 * Unused today: `signIn`/`signOut`/`fetchSession` all run server-side (see
 * `~/lib/session`), which is what lets an httpOnly cookie carry the session
 * without ever handing the access token to JavaScript. This export exists
 * for the day something needs a client-side call (e.g. Realtime) — reach for
 * the server functions first.
 */
import { createBrowserClient } from '@supabase/ssr';

/**
 * Not inlined into `getSupabaseBrowserClient`: `createBrowserClient` is
 * overloaded (current `getAll`/`setAll` vs. `@deprecated` `get`/`set`/`remove`),
 * and `ReturnType<typeof fn>` on an overloaded function always resolves to
 * the LAST overload — the deprecated one. Wrapping the unambiguous
 * 2-argument call here gives `ReturnType<typeof createClient>` a single
 * correct signature to read.
 */
function createClient() {
  return createBrowserClient(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
}

let client: ReturnType<typeof createClient> | undefined;

export function getSupabaseBrowserClient() {
  client ??= createClient();
  return client;
}
