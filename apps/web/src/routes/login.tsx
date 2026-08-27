import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import { Field, Input } from '~/components/ui/input';
import { AUTH_ERROR_MESSAGES, signIn, type AuthErrorCode } from '~/lib/auth-client';
import { redirectIfSignedIn, safeRedirectPath } from '~/lib/auth-server';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({ redirect: z.string().max(2000).optional() }),
  // Un usuario ya logueado no tiene nada que hacer en /login. La política de
  // redirección (incluida la defensa de open redirect) es del workstream de
  // auth: acá se importa.
  beforeLoad: async ({ search }) => {
    await redirectIfSignedIn(search.redirect);
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const submit = useServerFn(signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);

  const onSubmit = () => {
    setPending(true);
    setError(null);

    void (async () => {
      try {
        const result = await submit({ data: { email, password } });
        if (result.ok) {
          await router.invalidate();
          await router.navigate({ href: safeRedirectPath(search.redirect) });
          return;
        }
        setError(result.code ?? 'servicio');
      } catch {
        setError('servicio');
      } finally {
        setPending(false);
      }
    })();
  };

  const credentialError = error === 'credenciales';

  return (
    <main className="bg-surface-2 flex min-h-dvh items-center justify-center p-6">
      <div className="rounded-panel border-border-base bg-surface w-full max-w-sm border p-6">
        <h1 className="text-18 text-fg font-semibold">Territorio Base</h1>
        <p className="text-12 text-fg-muted mt-1">Entrá con tu cuenta para abrir el mapa.</p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
          <Field label="Email" error={credentialError ? ' ' : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Contraseña" error={credentialError ? ' ' : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </Field>

          {error !== null ? (
            <p role="alert" className="text-12 text-danger font-medium">
              {AUTH_ERROR_MESSAGES[error]}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
            Entrar
          </Button>
        </form>

        <p className="text-12 text-fg-muted mt-4">
          ¿Tenés un código de invitación?{' '}
          <Link to="/register" className="text-accent font-medium underline underline-offset-2">
            Creá tu cuenta
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
