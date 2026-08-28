# Supabase Auth nativo — acceso solo por invitación

> Documento de referencia previo a la implementación. Objetivo del usuario (no
> se re-discute acá): reemplazar `packages/db` (Drizzle + SQLite + Better Auth)
> por **Supabase Postgres + Auth nativo**, camino idiomático de Supabase por
> sobre mantener capas propias, salvo razón técnica concreta.
>
> Ángulo de este documento: cómo se re-deriva el gate de "solo por invitación"
> que hoy vive en `packages/db/src/auth.ts` y `packages/db/src/invites.ts`
> usando lo que Supabase Auth trae de fábrica. Todo lo citado se leyó de la
> doc oficial (vía fetch directo, no memoria), del código fuente real de
> `supabase/auth` (Go, rama `master`) y de los archivos de este repo. Cada
> afirmación no trivial tiene una fuente al lado.

---

## 0. Resumen ejecutivo

**Modelo recomendado: `inviteUserByEmail` (Admin API) como mecanismo
principal**, no el sistema de códigos canjeables actual. Es el camino
"full native": una sola llamada server-side crea al usuario en estado
"invitado" y Supabase manda el email con el magic link — sin tabla de
invites propia, sin endpoint de canje, sin hashear nada a mano.

Lo que se **pierde** al migrar:

- **Distribución fuera de email.** Hoy un código se puede compartir por
  WhatsApp/en persona sin saber de antemano la casilla exacta del invitado
  (`invite.email` es opcional — ver `invites.ts:245`). `inviteUserByEmail`
  exige la casilla en el momento de invitar; no hay "código anónimo".
- **Expiración por invitación.** Hoy es de 3 valores explícitos (14 días por
  default, `null` = nunca, o N días — `invites.ts:227-241`). Supabase ata el
  link de invitación al mismo reloj que OTP/magic link/recovery
  (**Email OTP expiration**, default 3600 s, tope de 86 400 s desde el
  dashboard — más solo vía Management API). No hay "invitación sin
  vencimiento" nativa.
- **Mensajes de error diferenciados por el frontend.** Hoy `INVITE_ALREADY_USED`
  vs `INVITE_EXPIRED` vs `INVITE_INVALID` son códigos propios
  (`invites.ts:97-103`). Con el flujo nativo el "canje" es aceptar un magic
  link — no hay una pantalla de formulario propia que reciba ese código y
  pueda mostrar cada motivo por separado.

Lo que se **gana**:

- Cero tabla `invite`, cero `claimInvite`/`checkInvite`/`attachInviteUserByCode`
  a mantener; Supabase ya sabe distinguir "invitado, no confirmado" de
  "activo" (`auth.users.invited_at` / `confirmed_at`).
- El hook `before-user-created` (gratis, ver §2) sigue siendo el fail-closed
  real — y, a diferencia de hoy, corre también sobre el flujo de invite (ver
  §3), así que "cerrar sign-up público + antes de crear el usuario" se
  mantiene igual de sólido.
- Se puede seguir usando una tabla propia como **bitácora de auditoría** (quién
  invitó a quién, nota, revocación) sin que sea la que hace cumplir nada —
  eso lo hace Supabase. Ver §5 sobre por qué el "código canjeable" no
  desaparece del todo si se quiere seguir permitiendo compartir invitaciones
  fuera de email.

---

## 1. Qué existe hoy (releído para este documento)

- `packages/db/src/auth.ts`: dos capas — `hooks.before` sobre
  `/sign-up/email` (validación, no hace cumplir nada) y
  `databaseHooks.user.create.before` (el gate real: fail-closed vía
  `USER_CREATING_PATHS` allow-list + `claimInvite` atómico).
- `packages/db/src/invites.ts`: códigos Crockford base32 de 12 símbolos
  (~60 bits), UPDATE condicional de una sola sentencia
  (`WHERE code = ? AND used_at IS NULL`) como mecanismo de single-use,
  porque el adaptador Drizzle corre con `transaction: false` (better-sqlite3
  es síncrono; envolverlo en `db.transaction()` async comete una transacción
  vacía — ver el comentario largo en `auth.ts:31-37`).
- `packages/db/src/rate-limit.ts` + `web-boundary.ts:138-139`: 5 intentos /
  60 s, **por email normalizado** (no por IP — deliberado, sin proxy
  reverso delante, el `X-Forwarded-For` sería falsificable), un `INSERT ...
  ON CONFLICT DO UPDATE` atómico contra la tabla `rate_limit`. Corre porque
  la opción `rateLimit` de Better Auth resultó ser código muerto en esta
  arquitectura (nunca se despacha un `Request` por `auth.handler()`).

---

## 2. Cerrar el registro público

**Dashboard:** Authentication → sección "General configuration" →
**Allow new users to sign up**. Doc oficial:

> "Allow new users to sign up: Users will be able to sign up. If this config
> is disabled, only existing users can sign in."
> — [supabase.com/docs/guides/auth/general-configuration](https://supabase.com/docs/guides/auth/general-configuration)

**Self-hosted (Docker Compose, que es el despliegue de este repo):** no hay
dashboard — se setea por variable de entorno en el contenedor `auth`
(imagen `supabase/gotrue` / `supabase/auth`). Confirmado en el código fuente
(`internal/conf/configuration.go`, struct raíz, `envconfig` con
`split_words:"true"`):

```go
DisableSignup   bool  `json:"disable_signup" split_words:"true"`
```

→ variable `GOTRUE_DISABLE_SIGNUP=true`. Si en algún momento se usa el CLI de
Supabase para desarrollo local, el equivalente en `config.toml` es
`[auth] enable_signup = false` (mismo booleano invertido, mapeado por el CLI
al env var de arriba).

**Qué pasa exactamente cuando está desactivado — verificado en el código
fuente, no en un blog:**

`internal/api/signup.go`, dentro del handler público `Signup` (el que
atiende `POST /auth/v1/signup`):

```go
if config.DisableSignup {
    return apierrors.NewUnprocessableEntityError(
        apierrors.ErrorCodeSignupDisabled,
        "Signups not allowed for this instance",
    )
}
```

Es decir: **HTTP 422**, no 400 ni 403. El `code` que viaja en el JSON de
error es `signup_disabled` (confirmado en la tabla oficial de error codes:
[supabase.com/docs/guides/auth/debugging/error-codes](https://supabase.com/docs/guides/auth/debugging/error-codes)).
`supabase-js` lo expone como `AuthApiError` con `.code === 'signup_disabled'`
y `.status === 422` — es el análogo directo del
`INVITE_ERROR_CODES` que este repo ya construye a mano.

**¿Se puede seguir creando usuarios por Admin API? Sí, y es exactamente por
diseño.** El check de `DisableSignup` vive únicamente en el handler
`Signup` (la ruta pública). Se leyó el código de los dos caminos
administrativos y **ninguno de los dos lo consulta**:

- `internal/api/admin.go`, `adminUserCreate` (lo que expone
  `supabase.auth.admin.createUser()`) — no referencia `DisableSignup` en
  ningún punto del handler.
- `internal/api/invite.go`, `Invite` (lo que expone
  `supabase.auth.admin.inviteUserByEmail()`) — tampoco.

Esto es la base entera del modelo "cerrado al público, abierto por
invitación": cerrar `DisableSignup` mata **solo** el formulario de registro
libre; el camino administrativo queda intacto sin ninguna allow-list manual
como la de `USER_CREATING_PATHS` hoy.

---

## 3. El hook `before-user-created` — la pieza clave

**Disponibilidad:** confirmada en el **Free tier**. Tabla oficial de hooks
por plan (`supabase.com/docs/guides/auth/auth-hooks`, fetch directo):

| Hook | Planes |
|---|---|
| Before User Created | **Free, Pro** |
| Custom Access Token | Free, Pro |
| Send SMS / Send Email | Free, Pro |
| MFA Verification Attempt | Teams, Enterprise |
| Password Verification Attempt | Teams, Enterprise |

(Este último dato importa para §6: no hay hook de intentos de contraseña en
Free/Pro, solo en planes de pago — nada que reemplace el rate limiting propio
por ese lado.)

### Implementación: función de Postgres (recomendada) vs webhook HTTP

Ambas formas existen. Para este repo, **función de Postgres** es la elección
obvia: no depende de un Edge Function ni de verificar firma de webhook
(`StandardWebhooks` + secreto), corre en el mismo Postgres al que ya se está
migrando, y es lo más parecido a lo que hoy hace `claimInvite` (una consulta
SQL contra una tabla propia).

Firma exigida:

```sql
create or replace function public.hook_name(event jsonb)
returns jsonb
language plpgsql
as $$ ... $$;

grant execute on function public.hook_name to supabase_auth_admin;
revoke execute on function public.hook_name from authenticated, anon, public;
```

Se registra en el dashboard (Authentication → Hooks) o, self-hosted, por
variable de entorno equivalente al `config.toml`:

```
GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED=true
GOTRUE_HOOK_BEFORE_USER_CREATED_URI=pg-functions://postgres/public/hook_gate_signup
```

(nombres derivados de `HookConfiguration.BeforeUserCreated
ExtensibilityPointConfiguration` en `internal/conf/configuration.go`, mismo
patrón `envconfig` que `GOTRUE_DISABLE_SIGNUP`).

### Payload exacto que recibe (fetch directo de la doc, JSON real, no resumido)

```json
{
  "metadata": {
    "uuid": "8b34dcdd-9df1-4c10-850a-b3277c653040",
    "time": "2025-04-29T13:13:24.755552-07:00",
    "name": "before-user-created",
    "ip_address": "127.0.0.1"
  },
  "user": {
    "id": "ff7fc9ae-3b1b-4642-9241-64adb9848a03",
    "aud": "authenticated",
    "role": "",
    "email": "valid.email@supabase.com",
    "phone": "",
    "app_metadata": { "provider": "email", "providers": ["email"] },
    "user_metadata": {},
    "identities": [],
    "created_at": "0001-01-01T00:00:00Z",
    "updated_at": "0001-01-01T00:00:00Z",
    "is_anonymous": false
  }
}
```

`event->'user'->>'email'` es el equivalente directo del `newUser.email` que
hoy recibe `databaseHooks.user.create.before` en `auth.ts:180`.

### Cómo rechaza — mensaje mostrable en el formulario

```json
{ "error": { "http_code": 400, "message": "Ese código de invitación ya fue utilizado." } }
```

Aceptar es `{}` con 200/204. Esto es literalmente el mismo contrato que
`INVITE_ERROR_CODES` + `REJECTION_MESSAGES` de `invites.ts:78-103` — un
`message` en español, listo para el formulario, sin traducir códigos
genéricos de Postgres.

Fuente completa (payload, ejemplos de dominio/OAuth/CIDR con `grant
execute`):
[supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)

### Qué endpoints disparan este hook — verificado en el código, no asumido

Se leyó `internal/api/signup.go`, `internal/api/invite.go` e
`internal/api/admin.go` (los tres, línea por línea) buscando la llamada a
`triggerBeforeUserCreated`:

| Endpoint | ¿Dispara `before-user-created`? |
|---|---|
| `POST /signup` (`supabase.auth.signUp`) | **Sí** — `signup.go:186` |
| `POST /invite` (`supabase.auth.admin.inviteUserByEmail`) | **Sí** — `invite.go`, dentro de la rama `isCreate` |
| `POST /admin/users` (`supabase.auth.admin.createUser`) | **No** — el handler `adminUserCreate` en `admin.go` nunca llama a `triggerBeforeUserCreated` ni a `triggerAfterUserCreated` |

Esto decide la recomendación del §4: si el gate de invitación vive en este
hook, **hay que invitar con `inviteUserByEmail`, no con `createUser`** — de
lo contrario el hook nunca corre y `createUser` crea cuentas sin pasar por
ninguna validación propia.

---

## 4. `inviteUserByEmail` vs. el modelo de códigos canjeables

### La API real

```ts
const { data, error } = await supabase.auth.admin.inviteUserByEmail(
  'persona@ejemplo.com',
  { data: { name: 'Nombre' }, redirectTo: 'https://app.example.com/aceptar-invitacion' },
)
```

Requiere `service_role` (o `secret key` en el esquema nuevo de API keys),
server-side únicamente. Bajo el capó pega a `POST /invite`
(`internal/api/invite.go`), cuyo `InviteParams` acepta `email`, `password`
(opcional), `data` (metadata) y `redirect_to` — confirmado leyendo tanto el
handler Go como el autodoc de endpoints del repo `supabase/auth`.

Nota de la propia doc: PKCE **no** está soportado en este flujo — el
navegador que invita normalmente no es el que acepta, así que no aplica la
garantía de PKCE. Es información, no una limitación bloqueante para este
caso de uso.

### Comparación honesta

| | Código canjeable (hoy) | `inviteUserByEmail` (nativo) |
|---|---|---|
| Quién sabe el destino | Puede ser nadie — código sin `email` pinneado, se comparte por cualquier canal | Tiene que saberse la casilla exacta al invitar |
| Vencimiento | 14 días default / `null` = nunca / N días a elección (`invites.ts:227-241`) | Comparte el reloj de **Email OTP expiration**: default 3600 s, tope 86 400 s desde el dashboard, más solo vía Management API. No hay "nunca vence" |
| Mensajes de error por motivo | 5 códigos propios (`unknown`/`used`/`expired`/`email-mismatch`/`missing`) que el formulario puede distinguir | El link ya resuelve al aceptarse; no hay una pantalla de "pegá tu código" propia con esos 5 estados — se reduce a "el link funciona" o "no funciona" |
| Reenvío | Se emite un código nuevo | `inviteUserByEmail` se puede volver a llamar sobre el mismo email no confirmado — el handler `Invite` detecta `isCreate=false, isConfirmed=false` y solo actualiza `invited_at` (ver el código fuente citado en la búsqueda de `invite.go` más abajo) |
| Envío del email | Responsabilidad de este repo (ninguno hoy: el código se comunica por otro canal) | Supabase lo manda con su mailer (o SMTP propio si se configura Custom SMTP) |
| Dispara `before-user-created` | Sí, vía `databaseHooks` | Sí — confirmado en §3 |
| Tabla propia necesaria | `invite` (schema + queries) | Ninguna para hacer cumplir; opcional como bitácora |

### Recomendación

Dado el "full native supabase": **usar `inviteUserByEmail` como mecanismo
principal**, no como alternativa. El gate de invitación se re-deriva así:

1. Alguien con permiso de admin llama a `inviteUserByEmail(email, { data })`
   desde una `createServerFn` (server-side, `service_role`).
2. Eso dispara `before-user-created`. La función de Postgres puede, si se
   quiere seguir controlando *quién* puede ser invitado más allá de "un
   admin decidió invitarlo" (p. ej. lista de dominios permitidos, o un tope
   de invitaciones pendientes), aplicar esa regla ahí — el mismo lugar que
   hoy hace `claimInvite`.
3. El usuario llega por email, hace click, `type=invite` en el
   `redirect_to` — la ruta que lo recibe intercambia el token y setea la
   sesión (patrón cubierto en `01-tanstack-ssr.md`, §6, sobre la ruta HTTP
   de archivo que hace falta para esto).

Lo que se pierde, explícito: la capacidad de **imprimir un código y
entregarlo en persona/WhatsApp sin saber aún el email exacto**. Si ese caso
de uso importa de verdad (p. ej. entregar acceso en un evento), la única
forma nativa de conservarlo es seguir manteniendo una tabla de códigos
propios *además* de invitar — momento en el que ya no es "full native" para
esa mitad del flujo. Vale la pena confirmarlo con el usuario antes de tirar
la tabla `invite` entera; si la respuesta es "siempre se sabe el email de
antemano", `inviteUserByEmail` sin tabla propia alcanza y sobra.

---

## 5. Atomicidad en Postgres — el detalle que no es obvio

La intuición fácil es "Postgres tiene transacciones reales, así que el
problema de `transaction: false` desaparece solo". Es cierto a medias, y la
mitad falsa importa.

**Lo que sigue siendo cierto y suficiente por sí solo:** un único `UPDATE …
WHERE … RETURNING` sigue siendo atómico en Postgres exactamente por la misma
razón que en SQLite — MVCC + row-level locking garantizan que, de dos
`UPDATE` concurrentes contra la misma fila con la misma condición, como
mucho uno la modifica. El patrón que ya existe en `claimInvite`
(`invites.ts:151-179`) es portable literalmente tal cual a una función de
Postgres:

```sql
create or replace function public.claim_invite_code(p_code text, p_email text)
returns jsonb
language plpgsql
security definer
as $$
declare
  v_row invites%rowtype;
begin
  update invites
     set used_at = now()
   where code = p_code
     and used_at is null
     and (expires_at is null or expires_at > now())
     and (email is null or email = p_email)
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403, 'message', 'Ese código de invitación no es válido o ya fue usado.'
    ));
  end if;

  return '{}'::jsonb;
end;
$$;
```

**Lo que NO es automático, y se verificó leyendo el código fuente del propio
GoTrue, no asumido:** el hook `before-user-created` se dispara **antes** de
que arranque la transacción que inserta el usuario, y usando la conexión
`db` "de afuera" (no el `tx` de la inserción). Esto se ve literalmente en
`internal/api/signup.go`:

```go
if err := a.triggerBeforeUserCreated(r, db, signupUser); err != nil { // línea 186 — fuera de tx
    return err
}
err = db.Transaction(func(tx *storage.Connection) error { // línea 191 — arranca DESPUÉS
    ...
})
```

y en `internal/api/invite.go` es el mismo orden: `triggerBeforeUserCreated`
corre, y solo *después* arranca el `db.Transaction` que hace el insert real.

**Consecuencia práctica:** si la función de Postgres del hook hace el
`UPDATE ... WHERE used_at IS NULL` (reclama el código) y *después* el
insert del usuario falla por cualquier otro motivo — una carrera de dos
invitaciones concurrentes a la misma casilla con dos códigos distintos, un
error transitorio, lo que sea — el código queda quemado sin cuenta detrás.
**Exactamente el mismo problema que hoy resuelve `releaseOrphanedClaim`
(`invites.ts:197-208`)**, y Postgres no lo hace desaparecer porque el punto
de falla no está dentro de una sola transacción de principio a fin — es una
limitación de *cómo GoTrue orquesta el hook*, no de la base de datos.

**Recomendación:** si se conserva algún concepto de "código reclamable"
(ver §4), portar también el patrón de reconciliación:

- `after-user-created` (que sí corre después de que el insert confirmó,
  `signup.go:341` / mismo en `invite.go`) es el lugar para "adjuntar"
  definitivamente el claim al `user.id`, igual que `attachInviteUserByCode`
  hoy.
- Mantener una limpieza de claims huérfanos (`used_at` seteado, `used_by`
  nulo) — hoy es `releaseOrphanedClaim`, llamado desde el manejo de error de
  `web-boundary.ts`. En Postgres el equivalente es el mismo: detectar el
  fallo de creación del lado de la app y liberar la fila, o un job de
  limpieza por antigüedad.

Si en cambio se adopta `inviteUserByEmail` sin tabla propia (la
recomendación del §4), este problema completo deja de existir: no hay un
"código" que reclamar, solo un `auth.users` en estado invitado — no hay
nada que quede huérfano de esa manera.

---

## 6. Rate limiting — qué trae Supabase, y la brecha real

Tabla oficial completa (`supabase.com/docs/guides/auth/rate-limits`, fetch
directo):

| Operación | Endpoint | Por | Configurable | Límite |
|---|---|---|---|---|
| Envío de email (signup/recovery/user) | `/signup`, `/recover`, `/user` | proyecto entero | Solo con SMTP propio | 2 emails/hora con el mailer built-in |
| Envío de OTP | `/otp` | proyecto entero | Sí | 30/hora default |
| Reenvío de OTP/magic link | `/otp` | por usuario | Sí | ventana de 60 s |
| Confirmación de signup | `/signup` | por usuario | Sí | ventana de 60 s |
| Recuperación de contraseña | `/recover` | por usuario | Sí | ventana de 60 s |
| Verificación | `/verify` | por IP | No | 360/hora (ráfagas de 30) |
| Refresh de token | `/token` | por IP | No | 1800/hora (ráfagas de 30) |
| Challenge/verify de MFA | `/factors/:id/challenge`, `/verify` | por IP | No | 15/hora |
| Sign-in anónimo | `/signup` sin email/phone | por IP | No | 30/hora |

Algoritmo: token bucket, capacidad máxima 30, se excede con **429 Too Many
Requests**. Configurable por dashboard (Authentication → Rate Limits) o
Management API (`PATCH /v1/projects/{ref}/config/auth`, campos
`rate_limit_*`).

### La brecha, dicha sin vueltas

**No hay ningún límite nativo de "N intentos de contraseña fallidos por
cuenta en X segundos".** `/token` (el endpoint de sign-in con
email+password) está limitado a **1800 requests/hora por IP** — un techo
antiabuso genérico, no un lockout de fuerza bruta por cuenta. Es,
además, exactamente el eje que `rate-limit.ts` evita a propósito: el
comentario de ese archivo (`rate-limit.ts:15-18`) explica que la app
limita **por email normalizado, no por IP**, porque no hay proxy reverso
delante y un atacante podría rotar `X-Forwarded-For`. El límite nativo de
Supabase resuelve el problema contrario (ráfagas desde una sola IP), no el
que este repo diseñó para cubrir (credential stuffing distribuido contra
una cuenta puntual).

Existe **Attack Protection** (CAPTCHA — hCaptcha o Cloudflare Turnstile) en
signup/signin/recovery, pero **está desactivado por default** y requiere
integrar un widget en el frontend — no es un reemplazo automático, y sigue
sin ser un contador por cuenta.

El hook `Password Verification Attempt` sí sería el lugar nativo correcto
para reimplementar esto (recibe cada intento de contraseña, se puede
contar y rechazar) — pero, como se documentó en §3, **es Teams/Enterprise,
no Free/Pro**.

**Conclusión honesta:** el rate limiting a mano (`rate-limit.ts`) no tiene
reemplazo nativo equivalente en el tier al que este proyecto puede acceder.
Portarlo tal cual a Postgres es directo — la tabla `rate_limit` y el
`INSERT ... ON CONFLICT DO UPDATE` atómico de `rate-limit.ts:58-70` son SQL
estándar, sin nada específico de SQLite; el `sql\`case when...\`` de Drizzle
compila igual contra `pg` que contra `better-sqlite3`. Se puede invocar
desde el mismo lugar que hoy (antes de delegar a Auth, en la capa de server
functions) — no hace falta el hook `before-user-created` para esto, porque
el ataque a defender es contra el endpoint de **sign-in**, no de creación de
usuario.

---

## 7. RLS — políticas mínimas

Tabla real de este repo (`packages/db/src/schema.ts:201-225`): `analysis`,
con `user_id` como FK. En Postgres/Supabase esa referencia pasa a apuntar a
`auth.users(id)` en vez de a una tabla `user` propia.

```sql
create table public.analysis (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text,
  aoi_geojson jsonb not null,
  area_ha real,
  status text not null default 'pending',
  result_json jsonb,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index analysis_user_id_created_at_idx
  on public.analysis (user_id, created_at desc);

alter table public.analysis enable row level security;

-- SELECT: cada quien ve solo sus propios análisis.
create policy "analysis_select_own"
  on public.analysis for select
  to authenticated
  using ( (select auth.uid()) = user_id );

-- INSERT: solo se puede crear un análisis propio (no en nombre de otro user_id).
create policy "analysis_insert_own"
  on public.analysis for insert
  to authenticated
  with check ( (select auth.uid()) = user_id );

-- UPDATE: el job que llena result_json corre con service_role (bypassa RLS);
-- esta policy cubre ediciones desde el cliente autenticado (p. ej. renombrar).
create policy "analysis_update_own"
  on public.analysis for update
  to authenticated
  using ( (select auth.uid()) = user_id )
  with check ( (select auth.uid()) = user_id );

-- DELETE: idem.
create policy "analysis_delete_own"
  on public.analysis for delete
  to authenticated
  using ( (select auth.uid()) = user_id );
```

Notas de la propia guía de Postgres RLS de Supabase (vía context7,
`/supabase/supabase`):

- Envolver `auth.uid()` en `(select auth.uid())` (no `auth.uid()` pelado) es
  la forma recomendada — Postgres cachea el resultado del subquery una vez
  por statement en vez de evaluarlo por fila, con impacto de performance
  real en tablas grandes.
- `to authenticated` restringe la policy al rol que ya trae la sesión
  válida — evita que la misma policy se evalúe (y potencialmente filtre por
  `null = null`) contra el rol `anon`.

**"Exportaciones":** no existe todavía una tabla propia en el schema leído
(`packages/db/src/schema.ts`) — hoy `analysis.result_json` parece cargar ese
rol. Si se separa en una tabla `exports` a futuro, el patrón es idéntico:
mismo `user_id uuid references auth.users(id)`, mismas cuatro policies. Vale
la pena confirmar con el usuario si "exportaciones" ya está planeada como
tabla separada antes de escribir esa migración.

---

## Fuentes citadas

- [General configuration — Supabase Docs](https://supabase.com/docs/guides/auth/general-configuration)
- [Before User Created Hook — Supabase Docs](https://supabase.com/docs/guides/auth/auth-hooks/before-user-created-hook)
- [Auth Hooks (tabla de planes) — Supabase Docs](https://supabase.com/docs/guides/auth/auth-hooks)
- [Rate limits — Supabase Docs](https://supabase.com/docs/guides/auth/rate-limits)
- [inviteUserByEmail — JS Reference](https://supabase.com/docs/reference/javascript/auth-admin-inviteuserbyemail)
- [Error Codes — Supabase Docs](https://supabase.com/docs/guides/auth/debugging/error-codes)
- [Row Level Security — Supabase Docs](https://supabase.com/docs/guides/database/postgres/row-level-security) (vía context7 `/supabase/supabase`)
- Código fuente `supabase/auth` (rama `master`, leído directo):
  `internal/api/signup.go`, `internal/api/invite.go`, `internal/api/admin.go`,
  `internal/conf/configuration.go`
- Código de este repo: `packages/db/src/auth.ts`, `packages/db/src/invites.ts`,
  `packages/db/src/rate-limit.ts`, `packages/db/src/web-boundary.ts`,
  `packages/db/src/schema.ts`
