/**
 * Supabase server client — one instance PER REQUEST, never a module singleton.
 * `createServerClient` binds to the cookies of the request it was created
 * for; a singleton would leak one visitor's session into another's SSR render.
 *
 * Cookies go through TanStack Start's own `getCookies`/`setCookie`/
 * `setResponseHeader`, fulfilling the `getAll`/`setAll` contract
 * `@supabase/ssr` documents (see `docs/supabase/01-tanstack-ssr.md` §1–2).
 * `get`/`set`/`remove` is deprecated since `@supabase/ssr` 0.4.0 — only
 * `getAll`/`setAll` reliably clean up every chunk of a long JWT split across
 * `sb-<ref>-auth-token.0`, `.1`, etc.
 *
 * `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` are safe to read here
 * despite the `VITE_` prefix — Vite loads them into `process.env` via dotenv,
 * and neither is a secret (the publishable key's only real protection is
 * RLS). Never read `SUPABASE_SERVICE_ROLE_KEY` here — that's `~/lib/supabase/admin`.
 */
import { createServerClient } from '@supabase/ssr';
import { getCookies, setCookie, setResponseHeader } from '@tanstack/react-start/server';

function readEnv(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY'): string {
  const value = process.env[name];
  if (value === undefined || value === '') {
    throw new Error(`${name} falta. Copiá .env.example a .env y completá la sección Supabase.`);
  }
  return value;
}

/**
 * A fresh Supabase client bound to the current request's cookies.
 *
 * No explicit return type: `createServerClient`'s own generic defaults
 * resolve to a `SupabaseClient<...>` shape a bare `SupabaseClient` annotation
 * doesn't structurally match, which `@typescript-eslint/no-unsafe-return`
 * flags. Letting TypeScript infer it keeps the real, precise type.
 */
export function getSupabaseServerClient() {
  const url = readEnv('VITE_SUPABASE_URL');
  const key = readEnv('VITE_SUPABASE_PUBLISHABLE_KEY');

  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return Object.entries(getCookies()).map(([name, value]) => ({ name, value }));
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value, options }) => {
          setCookie(name, value, options);
        });
        Object.entries(headers).forEach(([name, value]) => {
          setResponseHeader(name, value);
        });
      },
    },
  });
}
