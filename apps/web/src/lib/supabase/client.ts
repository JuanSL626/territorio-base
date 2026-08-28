/**
 * Supabase browser client. One instance per tab — memoized module-level,
 * unlike `~/lib/supabase/server`, because in the browser there is only ever
 * one visitor's cookies to worry about.
 *
 * Nothing in this auth core needs this today: `signIn`/`signOut`/`fetchSession`
 * all run server-side (see `~/lib/session`), which is what lets an httpOnly
 * cookie carry the session without ever handing the access token to
 * JavaScript. This export exists for the day something genuinely needs a
 * client-side Supabase call (e.g. Realtime) — reach for the server functions
 * first.
 */
import { createBrowserClient } from '@supabase/ssr';

/**
 * Not inlined into `getSupabaseBrowserClient`: `createBrowserClient` is
 * overloaded (a current `getAll`/`setAll` signature and a `@deprecated`
 * `get`/`set`/`remove` one), and TypeScript's `ReturnType<typeof fn>` on an
 * overloaded function always resolves to the LAST overload — the deprecated
 * one here. Wrapping the actual (unambiguous, 2-argument) call in this
 * ordinary function gives `ReturnType<typeof createClient>` below a single,
 * correct signature to read instead.
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
