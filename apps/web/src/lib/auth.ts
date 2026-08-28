/**
 * The Better Auth server instance.
 *
 * SERVER ONLY. This module reaches better-sqlite3 and `node:fs`; importing it
 * from a component makes Vite try to bundle a native module for the browser.
 *
 * There is exactly **one** instance per process, owned by `@territorio/db`, so
 * the server-function path (`~/lib/session` → `webAuthBoundary`) and any HTTP
 * handler mounted below share one connection, one secret and one set of
 * rate-limit counters. Do not call `betterAuth()` again anywhere in this app.
 *
 * All policy — invite-gated sign-up, cookie attributes, rate limits, the
 * Drizzle adapter — lives in `@territorio/db`'s `buildAuthOptions`.
 *
 * Day-to-day auth does NOT go through here.
 *
 * Sign-in, sign-up and sign-out are TanStack Start server functions in
 * `~/lib/session`, and session reading for route guards is `~/lib/auth-server`.
 * Use those. This export exists for the cases that need Better Auth's own HTTP
 * surface.
 *
 * Mounting the HTTP surface (optional, not required today):
 *
 * Password-reset callbacks, email verification and the `better-auth/react`
 * client all speak HTTP to `basePath: '/api/auth'`. None are used yet. When one
 * is, add `apps/web/src/routes/api/auth/$.ts` (routes workstream):
 *
 * ```ts
 * import { createFileRoute } from '@tanstack/react-router';
 *
 * import { getAuth } from '~/lib/auth';
 *
 * export const Route = createFileRoute('/api/auth/$')({
 *   server: {
 *     handlers: {
 *       GET: ({ request }) => getAuth().handler(request),
 *       POST: ({ request }) => getAuth().handler(request),
 *     },
 *   },
 * });
 * ```
 *
 * The path must match `basePath` in `buildAuthOptions`. The handler returns a
 * real `Response`, so `Set-Cookie` flows on its own — no cookie plugin needed.
 */
export { getAuth, type Auth } from '@territorio/db';
