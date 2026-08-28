import { createFileRoute } from '@tanstack/react-router';

import { safeRedirectPath } from '~/lib/auth-server';
import { getSupabaseServerClient } from '~/lib/supabase/server';

/**
 * `Response.redirect(...)` builds a `Response` whose `headers` are
 * spec-guarded `"immutable"` — fatal here: the ambient cookie merge below
 * (`mergeEventResponseHeaders`) calls `headers.delete('set-cookie')` before
 * re-appending, which throws `TypeError: immutable` on it. A `new Response()`
 * with a `Location` header has ordinary, mutable headers and the exact same
 * redirect semantics.
 */
function redirectTo(path: string, origin: string): Response {
  return new Response(null, { status: 302, headers: { Location: new URL(path, origin).toString() } });
}

/**
 * `GET /auth/confirm?token_hash=...&type=invite` — where the link in the
 * invite email lands (see `supabase/templates/invite.html`, and
 * `session.ts#adminInviteUser` which sends it).
 *
 * Can't be a `createServerFn`: those are an RPC protocol for client JS, not a
 * plain `href` an email client can follow. Has to be a real HTTP `GET`, same
 * pattern as the raster proxies (`routes/api/raster.*.ts`) — a file route
 * with `server.handlers`.
 *
 * `verifyOtp` confirms the token AND establishes a session, writing the
 * cookie via `getSupabaseServerClient`'s `setAll`. That write goes through
 * TanStack Start's ambient `setCookie`/`setResponseHeader`, which only lands
 * on the returned `Response` for a NON-2xx response — confirmed by reading
 * `@tanstack/start-server-core`'s `mergeEventResponseHeaders`
 * (`if (response.ok) return;`). This handler always returns `redirectTo(...)`
 * (a 302, below), never a 200, so the cookie always survives the trip.
 * `Response.redirect()` itself can't be used for this — see its own comment.
 *
 * Only `type=invite` is handled today — no self-serve sign-up to confirm and
 * no "forgot password" yet (`recovery`/`signup`/`magiclink` would reuse this
 * shape if one of those ships later).
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
