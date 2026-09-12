import { createFileRoute, Link } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState, type SyntheticEvent } from 'react';

import { Button } from '~/components/ui/button';
import { Field, Input } from '~/components/ui/input';
import { AUTH_ERROR_MESSAGES, requestPasswordReset, type AuthErrorCode } from '~/lib/auth-client';

export const Route = createFileRoute('/auth/forgot-password')({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const sendResetEmail = useServerFn(requestPasswordReset);
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);

  const onSubmit = (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPending(true);
    setError(null);

    void (async () => {
      try {
        const result = await sendResetEmail({ data: { email } });
        if (result.ok) {
          setSent(true);
        } else {
          setError(result.code ?? 'servicio');
        }
      } catch {
        setError('servicio');
      } finally {
        setPending(false);
      }
    })();
  };

  return (
    <main className="bg-surface-2 flex min-h-dvh items-center justify-center p-5 sm:p-8">
      <section className="rounded-panel border-border-base bg-surface w-full max-w-md border p-6 sm:p-8">
        <Link
          to="/login"
          className="text-12 text-fg-muted hover:text-fg inline-flex items-center gap-1 font-medium"
        >
          <span aria-hidden="true">←</span> Volver al inicio de sesión
        </Link>

        <h1 className="text-18 text-fg mt-7 font-semibold">Recuperá tu contraseña</h1>
        <p className="text-13 text-fg-muted mt-2">
          Te enviaremos un enlace para elegir una contraseña nueva.
        </p>

        {sent ? (
          <p
            role="status"
            className="rounded-panel border-info/30 bg-info-soft/60 text-info mt-6 border p-3"
          >
            Si existe una cuenta con ese email, recibirás un enlace para cambiar la contraseña.
            Revisá también la carpeta de spam.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
            <Field label="Email">
              {({ id }) => (
                <Input
                  id={id}
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoFocus
                  required
                  maxLength={320}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
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
              {pending ? 'Enviando…' : 'Enviar enlace'}
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
