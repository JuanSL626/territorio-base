import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useServerFn } from '@tanstack/react-start';
import { useState } from 'react';
import { z } from 'zod';

import { Button } from '~/components/ui/button';
import { EyeIcon, EyeOffIcon, LockIcon, MailIcon } from '~/components/ui/icons';
import { Field, Input } from '~/components/ui/input';
import { AUTH_ERROR_MESSAGES, signIn, type AuthErrorCode } from '~/lib/auth-client';
import { clearSessionCache, redirectIfSignedIn, safeRedirectPath } from '~/lib/auth-server';

export const Route = createFileRoute('/login')({
  validateSearch: z.object({
    redirect: z.string().max(2000).optional(),
    // Sólo llega de `routes/auth/confirm.ts` cuando `verifyOtp` rechaza un
    // link de invitación vencido o ya usado.
    error: z.literal('invitacion-invalida').optional(),
  }),
  // Un usuario ya logueado no tiene nada que hacer en /login.
  beforeLoad: async ({ search }) => {
    await redirectIfSignedIn(search.redirect);
  },
  component: LoginPage,
});

function LoginPage() {
  const router = useRouter();
  const search = Route.useSearch();
  const { queryClient } = Route.useRouteContext();
  const submit = useServerFn(signIn);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(search.error ?? null);
  const [retryAfterSeconds, setRetryAfterSeconds] = useState<number | null>(null);

  const clearError = () => {
    if (error !== null) setError(null);
    if (retryAfterSeconds !== null) setRetryAfterSeconds(null);
  };

  const onSubmit = () => {
    setPending(true);
    setError(null);
    setRetryAfterSeconds(null);

    void (async () => {
      try {
        const result = await submit({ data: { email, password } });
        if (result.ok) {
          // El `null` cacheado al salir tiene que morir ANTES de que
          // `invalidate()` recorra los guards, o `requireUser` rebota a
          // /login para siempre.
          clearSessionCache(queryClient);
          await router.invalidate();
          await router.navigate({ href: safeRedirectPath(search.redirect) });
          return;
        }
        setError(result.code ?? 'servicio');
        setRetryAfterSeconds(result.retryAfterSeconds ?? null);
      } catch {
        setError('servicio');
      } finally {
        setPending(false);
      }
    })();
  };

  const credentialError = error === 'credenciales';
  const errorMessage =
    error === 'demasiados-intentos' && retryAfterSeconds !== null
      ? `Demasiados intentos. Probá de nuevo en ${retryAfterSeconds} segundos.`
      : error !== null
        ? AUTH_ERROR_MESSAGES[error]
        : null;

  const isInviteError = error === 'invitacion-invalida';

  return (
    <main className="bg-surface-2 flex min-h-dvh">
      <section className="bg-surface-inverse text-fg-inverse relative hidden min-h-dvh flex-1 flex-col justify-between overflow-hidden p-10 lg:flex xl:p-14">
        <svg
          aria-hidden="true"
          className="text-accent absolute inset-0 h-full w-full opacity-25"
          viewBox="0 0 720 900"
          preserveAspectRatio="xMidYMid slice"
        >
          <defs>
            <pattern id="login-grid" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="currentColor" strokeWidth="0.7" />
            </pattern>
          </defs>
          <rect width="720" height="900" fill="url(#login-grid)" opacity="0.45" />
          <g fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M-80 620C70 530 120 710 260 610S490 430 820 570" />
            <path d="M-100 670C70 570 130 760 280 650S510 470 840 620" />
            <path d="M-100 720C60 620 160 800 300 700S520 520 840 670" />
            <path d="M-100 770C40 680 180 850 320 755S560 580 840 720" />
          </g>
          <circle cx="522" cy="234" r="92" fill="currentColor" opacity="0.08" />
          <circle cx="522" cy="234" r="6" fill="currentColor" opacity="0.7" />
        </svg>

        <div className="relative z-10 flex items-center gap-3">
          <BrandMark />
          <span className="text-15 font-semibold tracking-tight">Territorio Base</span>
        </div>

        <div className="relative z-10 max-w-lg">
          <span className="rounded-chip bg-accent/15 text-accent text-11 inline-flex items-center px-2.5 py-1 font-semibold tracking-[0.12em] uppercase">
            Análisis territorial
          </span>
          <h2 className="mt-5 max-w-md text-3xl leading-tight font-semibold tracking-tight xl:text-4xl">
            Entendé tu territorio antes de tomar decisiones.
          </h2>
          <p className="text-13 text-fg-inverse/70 mt-4 max-w-md leading-6">
            Explorá topografía, vegetación, hidrología y riesgos de cada área desde un solo lugar.
          </p>

          <div className="mt-8 grid max-w-md grid-cols-3 gap-2">
            {['Topografía', 'Vegetación', 'Riesgo RD'].map((item) => (
              <div key={item} className="rounded-panel border border-white/10 bg-white/5 px-3 py-3">
                <span className="bg-accent mb-3 block h-1.5 w-8 rounded-full" />
                <span className="text-11 text-fg-inverse/75 font-medium">{item}</span>
              </div>
            ))}
          </div>
        </div>

        <p className="text-11 text-fg-inverse/45 relative z-10">
          Datos para entender mejor República Dominicana.
        </p>
      </section>

      <section className="flex w-full items-center justify-center p-5 sm:p-8 lg:w-[min(52%,600px)] lg:shrink-0 lg:p-12 xl:p-16">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <BrandMark size={28} />
            <span className="text-15 text-fg font-semibold tracking-tight">Territorio Base</span>
          </div>

          <div className="mb-8">
            <span className="text-11 text-accent font-semibold tracking-[0.12em] uppercase">
              Acceso privado
            </span>
            <h1 className="text-fg mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              Iniciá sesión
            </h1>
            <p className="text-13 text-fg-muted mt-2">
              Entrá con la cuenta que recibiste por invitación.
            </p>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              onSubmit();
            }}
            className="flex flex-col gap-5"
            noValidate
          >
            <Field
              label="Email"
              hint="Usá el email asociado a tu invitación."
              error={credentialError ? ' ' : undefined}
            >
              {({ id, describedBy, invalid }) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  type="email"
                  name="email"
                  autoComplete="email"
                  autoFocus
                  required
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    clearError();
                  }}
                  leadingIcon={<MailIcon size={16} />}
                />
              )}
            </Field>

            <Field label="Contraseña" error={credentialError ? ' ' : undefined}>
              {({ id, describedBy, invalid }) => (
                <div className="relative">
                  <Input
                    id={id}
                    aria-describedby={describedBy}
                    invalid={invalid}
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(event) => {
                      setPassword(event.target.value);
                      clearError();
                    }}
                    className="pr-11"
                    leadingIcon={<LockIcon size={16} />}
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    title={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                    onClick={() => {
                      setShowPassword((visible) => !visible);
                    }}
                    className="text-fg-muted hover:text-fg absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 transition-colors"
                  >
                    {showPassword ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                  </button>
                </div>
              )}
            </Field>

            {errorMessage !== null ? (
              <div
                role="alert"
                className={
                  isInviteError
                    ? 'rounded-panel border-info/30 bg-info-soft/60 text-info flex gap-2 border p-3'
                    : 'rounded-panel border-danger/30 bg-danger-soft/60 text-danger flex gap-2 border p-3'
                }
              >
                <span className="mt-0.5 shrink-0 text-sm" aria-hidden="true">
                  {isInviteError ? 'i' : '!'}
                </span>
                <p className="text-12 font-medium">{errorMessage}</p>
              </div>
            ) : null}

            <Button type="submit" variant="primary" size="lg" fullWidth loading={pending}>
              {pending ? 'Ingresando…' : 'Entrar al mapa'}
            </Button>
          </form>

          <div className="border-border-base mt-8 border-t pt-5">
            <p className="text-12 text-fg-muted leading-5">
              ¿Todavía no tenés acceso? Pedile una invitación a la persona que te compartió
              Territorio Base.
            </p>
            <p className="text-11 text-fg-subtle mt-4">
              Tu sesión está protegida y solo vos podés acceder a tus análisis.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      className="text-accent shrink-0"
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M8 20.5 13.3 11l5.2 6.6L22 12l2 8.5H8Z"
        fill="var(--surface-inverse)"
        opacity="0.9"
      />
      <path
        d="M8 23h16"
        stroke="var(--surface-inverse)"
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity="0.9"
      />
    </svg>
  );
}
