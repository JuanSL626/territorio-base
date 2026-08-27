import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import { Field, Input } from '~/components/ui/input';
import { AUTH_ERROR_MESSAGES, signUp, type AuthErrorCode } from '~/lib/auth-client';
import { redirectIfSignedIn } from '~/lib/auth-server';

export const Route = createFileRoute('/register')({
  validateSearch: z.object({ invite: z.string().max(64).optional() }),
  beforeLoad: async () => {
    await redirectIfSignedIn();
  },
  component: RegisterPage,
});

const INVITE_ERRORS = new Set<AuthErrorCode>(['invitacion-invalida', 'invitacion-usada']);

function RegisterPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const submit = useServerFn(signUp);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [inviteCode, setInviteCode] = useState(search.invite ?? '');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);

  const onSubmit = () => {
    setPending(true);
    setError(null);

    void (async () => {
      try {
        const result = await submit({ data: { name, email, password, inviteCode } });
        if (result.ok) {
          await router.invalidate();
          await router.navigate({ to: '/' });
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

  const inviteError = error !== null && INVITE_ERRORS.has(error);

  return (
    <main className="bg-surface-2 flex min-h-dvh items-center justify-center p-6">
      <div className="rounded-panel border-border-base bg-surface w-full max-w-sm border p-6">
        <h1 className="text-18 text-fg font-semibold">Crear cuenta</h1>
        <p className="text-12 text-fg-muted mt-1">
          El acceso es por invitación: necesitás un código para registrarte.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
          <Field label="Nombre">
            {({ id, describedBy }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                name="name"
                autoComplete="name"
                required
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Email" error={error === 'email-en-uso' ? ' ' : undefined}>
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

          <Field
            label="Contraseña"
            hint="Mínimo 8 caracteres."
            error={error === 'password-debil' ? ' ' : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="password"
                name="password"
                autoComplete="new-password"
                minLength={8}
                required
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                }}
              />
            )}
          </Field>

          <Field
            label="Código de invitación"
            hint="Te lo pasa quien te invitó. Cada código sirve una sola vez."
            error={inviteError ? ' ' : undefined}
          >
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                name="inviteCode"
                autoComplete="off"
                spellCheck={false}
                required
                value={inviteCode}
                onChange={(event) => {
                  setInviteCode(event.target.value);
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
            Crear cuenta
          </Button>
        </form>

        <p className="text-12 text-fg-muted mt-4">
          ¿Ya tenés cuenta?{' '}
          <Link to="/login" className="text-accent font-medium underline underline-offset-2">
            Entrá
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
