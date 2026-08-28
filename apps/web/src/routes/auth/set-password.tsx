import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';

import { Button } from '~/components/ui/button';
import { Field, Input } from '~/components/ui/input';
import { AUTH_ERROR_MESSAGES, setPassword, type AuthErrorCode } from '~/lib/auth-client';
import { clearSessionCache, requireUser } from '~/lib/auth-server';

/**
 * Where an accepted invitation lands, right after `routes/auth/confirm.ts`
 * establishes the session. Not under `/_app`: this is the one thing a
 * brand-new, password-less account is allowed to see before the map shell.
 *
 * Guard is `requireUser`, the SAME one `/_app` uses — `verifyOtp` already
 * signed this visitor in, so this only rejects someone hitting the URL
 * without ever going through `/auth/confirm`.
 */
export const Route = createFileRoute('/auth/set-password')({
  beforeLoad: async ({ context, location }) => {
    await requireUser(context.queryClient, location);
  },
  component: SetPasswordPage,
});

function SetPasswordPage() {
  const router = useRouter();
  const { queryClient } = Route.useRouteContext();
  const submit = useServerFn(setPassword);

  const [password, setPasswordValue] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthErrorCode | 'no-coincide' | null>(null);

  const onSubmit = () => {
    if (password !== confirm) {
      setError('no-coincide');
      return;
    }

    setPending(true);
    setError(null);

    void (async () => {
      try {
        const result = await submit({ data: { password } });
        if (result.ok) {
          // La sesión de esta pestaña ya está cacheada por `requireUser` más
          // arriba en este `beforeLoad`; sin tirar el cache, `invalidate()`
          // reusaría ese valor en vez de reflejar que ya se completó el alta.
          clearSessionCache(queryClient);
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

  const errorMessage =
    error === 'no-coincide'
      ? 'Las contraseñas no coinciden.'
      : error !== null
        ? AUTH_ERROR_MESSAGES[error]
        : null;

  return (
    <main className="bg-surface-2 flex min-h-dvh items-center justify-center p-6">
      <div className="rounded-panel border-border-base bg-surface w-full max-w-sm border p-6">
        <h1 className="text-18 text-fg font-semibold">Elegí tu contraseña</h1>
        <p className="text-12 text-fg-muted mt-1">
          Último paso para activar tu cuenta de Territorio Base.
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
          className="mt-6 flex flex-col gap-4"
          noValidate
        >
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
                  setPasswordValue(event.target.value);
                }}
              />
            )}
          </Field>

          <Field label="Repetí la contraseña" error={error === 'no-coincide' ? ' ' : undefined}>
            {({ id, describedBy, invalid }) => (
              <Input
                id={id}
                aria-describedby={describedBy}
                invalid={invalid}
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                minLength={8}
                required
                value={confirm}
                onChange={(event) => {
                  setConfirm(event.target.value);
                }}
              />
            )}
          </Field>

          {errorMessage !== null ? (
            <p role="alert" className="text-12 text-danger font-medium">
              {errorMessage}
            </p>
          ) : null}

          <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
            Activar cuenta
          </Button>
        </form>
      </div>
    </main>
  );
}
