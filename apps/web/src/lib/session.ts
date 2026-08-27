import { createServerFn } from '@tanstack/react-start';
import { getRequestHeaders, setResponseHeader } from '@tanstack/react-start/server';
import { z } from 'zod';

/*
  ─────────────────────────────────────────────────────────────────────────────
  COSTURA DE AUTENTICACIÓN (la implementación NO vive acá)
  ─────────────────────────────────────────────────────────────────────────────
  El workstream de auth es dueño de `packages/db` (Drizzle + SQLite + Better
  Auth, invitación obligatoria) y de `apps/web/src/lib/auth*.ts`. Este módulo
  sólo declara el CONTRATO que el shell consume y lo resuelve en runtime.

  Para conectarlo, `@territorio/db` tiene que exportar `webAuthBoundary`
  cumpliendo `AuthBoundary`. Mientras no exista, `resolveAuthBoundary()`
  devuelve `null` y todo falla CERRADO: sin sesión, redirección a /login, y el
  formulario muestra "servicio". Nunca al revés.

  Se resuelve con `import()` dinámico y type guards en vez de un import
  estático para que este paquete typechequee y buildee hoy, y para que el día
  que el módulo aparezca no haya que tocar ninguna ruta.
*/

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
};

export type AuthErrorCode =
  | 'credenciales'
  | 'invitacion-invalida'
  | 'invitacion-usada'
  | 'email-en-uso'
  | 'password-debil'
  | 'servicio';

export type AuthOutcome = { ok: true; setCookie: string[] } | { ok: false; code: AuthErrorCode };

export type SignInInput = { email: string; password: string };
export type SignUpInput = { name: string; email: string; password: string; inviteCode: string };

export type AuthBoundary = {
  getSession: (headers: Headers) => Promise<SessionUser | null>;
  signIn: (input: SignInInput, headers: Headers) => Promise<AuthOutcome>;
  signUp: (input: SignUpInput, headers: Headers) => Promise<AuthOutcome>;
  signOut: (headers: Headers) => Promise<AuthOutcome>;
};

function hasFunction(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'function';
}

function asAuthBoundary(candidate: unknown): AuthBoundary | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const record = candidate as Record<string, unknown>;
  const required = ['getSession', 'signIn', 'signUp', 'signOut'];
  if (!required.every((key) => hasFunction(record, key))) return null;
  return candidate as AuthBoundary;
}

let boundaryPromise: Promise<AuthBoundary | null> | undefined;

async function resolveAuthBoundary(): Promise<AuthBoundary | null> {
  boundaryPromise ??= (async () => {
    try {
      const mod: unknown = await import('@territorio/db');
      if (typeof mod !== 'object' || mod === null) return null;
      return asAuthBoundary((mod as Record<string, unknown>).webAuthBoundary);
    } catch {
      // El paquete todavía no exporta la costura: fallar cerrado, no romper el
      // render del shell.
      return null;
    }
  })();

  return await boundaryPromise;
}

function currentHeaders(): Headers {
  const headers = new Headers();
  for (const [key, value] of getRequestHeaders().entries()) {
    headers.set(key, value);
  }
  return headers;
}

function applySetCookie(values: string[]): void {
  for (const value of values) {
    setResponseHeader('set-cookie', value);
  }
}

/** Lee la sesión del cookie httpOnly. Nunca lanza: sin auth configurada → null. */
export const fetchSession = createServerFn({ method: 'GET' }).handler(
  async (): Promise<SessionUser | null> => {
    const boundary = await resolveAuthBoundary();
    if (!boundary) return null;
    try {
      return await boundary.getSession(currentHeaders());
    } catch {
      return null;
    }
  },
);

const signInSchema = z.object({
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
});

const signUpSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().min(1).max(320),
  password: z.string().min(1).max(256),
  inviteCode: z.string().trim().min(1).max(64),
});

export const signIn = createServerFn({ method: 'POST' })
  .validator(signInSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: AuthErrorCode }> => {
    const boundary = await resolveAuthBoundary();
    if (!boundary) return { ok: false, code: 'servicio' };

    try {
      const outcome = await boundary.signIn(data, currentHeaders());
      if (!outcome.ok) return { ok: false, code: outcome.code };
      applySetCookie(outcome.setCookie);
      return { ok: true };
    } catch {
      return { ok: false, code: 'servicio' };
    }
  });

export const signUp = createServerFn({ method: 'POST' })
  .validator(signUpSchema)
  .handler(async ({ data }): Promise<{ ok: boolean; code?: AuthErrorCode }> => {
    const boundary = await resolveAuthBoundary();
    if (!boundary) return { ok: false, code: 'servicio' };

    try {
      const outcome = await boundary.signUp(data, currentHeaders());
      if (!outcome.ok) return { ok: false, code: outcome.code };
      applySetCookie(outcome.setCookie);
      return { ok: true };
    } catch {
      return { ok: false, code: 'servicio' };
    }
  });

export const signOut = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ ok: boolean }> => {
    const boundary = await resolveAuthBoundary();
    if (!boundary) return { ok: true };

    try {
      const outcome = await boundary.signOut(currentHeaders());
      if (outcome.ok) applySetCookie(outcome.setCookie);
      return { ok: true };
    } catch {
      return { ok: true };
    }
  },
);

/** Copy en español de cada código de error, en un solo lugar. */
export const AUTH_ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  credenciales: 'Email o contraseña incorrectos.',
  'invitacion-invalida': 'El código de invitación no existe.',
  'invitacion-usada': 'Ese código de invitación ya fue usado.',
  'email-en-uso': 'Ya hay una cuenta con ese email.',
  'password-debil': 'La contraseña tiene que tener al menos 8 caracteres.',
  servicio: 'No se pudo contactar el servicio de cuentas. Probá de nuevo en un momento.',
};
