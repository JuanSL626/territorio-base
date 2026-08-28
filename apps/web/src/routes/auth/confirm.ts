import { createFileRoute } from '@tanstack/react-router';

import { safeRedirectPath } from '~/lib/auth-server';
import { getSupabaseServerClient } from '~/lib/supabase/server';

/**
 * `Response.redirect(...)` builds a `Response` whose `headers` are
 * spec-guarded `"immutable"` — great for a plain redirect, fatal here: the
 * ambient cookie merge this file's own header comment describes
 * (`mergeEventResponseHeaders`) calls `headers.delete('set-cookie')` before
 * re-appending, which throws `TypeError: immutable` on an immutable-guarded
 * `Headers`. A `new Response()` with a `Location` header has ordinary,
 * mutable headers and gets the exact same redirect semantics.
 */
function redirectTo(path: string, origin: string): Response {
  return new Response(null, { status: 302, headers: { Location: new URL(path, origin).toString() } });
}

/**
 * `GET /auth/confirm?token_hash=...&type=invite` — where the link in the
 * invite email lands (see `supabase/templates/invite.html`, and
 * `session.ts#adminInviteUser` which sends it).
 *
 * This CANNOT be a `createServerFn`: server functions are an RPC protocol
 * meant to be called from client JS, not a plain `href` an email client can
 * follow. It has to be a real HTTP `GET`, same pattern as the raster proxies
 * (`routes/api/raster.*.ts`) — a file route with `server.handlers`.
 *
 * `verifyOtp` both confirms the token AND establishes a session, writing the
 * new session cookie via `getSupabaseServerClient`'s `setAll` (see that
 * file). That write goes through TanStack Start's ambient
 * `setCookie`/`setResponseHeader`, which only makes it onto a handler's
 * returned `Response` for a NON-2xx response — confirmed by reading
 * `@tanstack/start-server-core`'s `mergeEventResponseHeaders`
 * (`if (response.ok) return;`). A redirect is exactly that: this handler
 * returns `redirectTo(...)` (a 302, defined below) on every path, never a
 * 200, so the cookie always survives the trip. `Response.redirect()` itself
 * cannot be used for this — see that function's own comment.
 *
 * Only `type=invite` is handled today — this app has no self-serve sign-up
 * to confirm and no "forgot password" yet (`recovery`/`signup`/`magiclink`
 * would reuse this same shape if one of those ships later).
 */
export const Route = createFileRoute('/auth/confirm')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const tokenHash = url.searchParams.get('token_hash');
        const type = url.searchParams.get('type');
        const next = safeRedirectPath(url.searchParams.get('redirect_to'));

        if (tokenHash !== null && type === 'invite') {
          const supabase = getSupabaseServerClient();
          const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
          if (error === null) {
            return redirectTo(next, url.origin);
          }
        }

        return redirectTo('/login?error=invitacion-invalida', url.origin);
      },
    },
  },
});
