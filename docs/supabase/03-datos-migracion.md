# Datos y migración: SQLite/Drizzle → Supabase Postgres

Ángulo de investigación de la migración a "full native Supabase and TanStack". Cubre
solo la base de datos: la decisión Drizzle-vs-`supabase-js`, migraciones, traducción de
esquema, desarrollo local, pooling y los números reales del free tier. La decisión de
auth (Better Auth → Supabase Auth) la resuelve el documento hermano de auth; acá se
asume que ocurre, porque cambia qué tablas de este esquema sobreviven.

Contexto leído: `packages/db/src/schema.ts`, `analyses.ts`, `client.ts`, `env.ts`,
`rate-limit.ts`, `web-boundary.ts`, `auth.ts`, `drizzle.config.ts`, `drizzle/*.sql`,
`apps/web/src/lib/analysis-runtime.ts` (el tope de 6 MB).

## Resumen ejecutivo

**Recomendación: Drizzle + `postgres-js` apuntando a Supabase Postgres, no
`supabase-js`.** Fundamento en una línea: toda la app habla con la base desde un único
proceso Node de confianza (server functions de TanStack Start) que ya hace el chequeo
de ownership en cada query — no hay ningún cliente en el browser que hable con
Postgres directamente — así que RLS no protege nada que el código no proteja ya, y
`supabase-js` (un cliente PostgREST) sería un downgrade de tipado y de las escrituras
atómicas (`ON CONFLICT ... CASE WHEN`, UPDATE condicional) que `rate-limit.ts` e
`invites.ts` ya tienen resueltas correctamente. Lo "nativo de Supabase" se adopta donde
sí importa: Postgres real, el CLI `supabase` como dueño de las migraciones y del stack
local, y Supabase Auth para autenticación (fuera de este documento). RLS se deja
**encendido en modo default-deny** (sin políticas) como red de seguridad barata contra
el hecho de que Supabase expone `public` por PostgREST por defecto — no como el
mecanismo de autorización real, que sigue siendo el filtro `userId` en cada función de
`packages/db`.

Plan de migración de esquema, en pasos, al final del documento.

---

## 1. La decisión de fondo: ¿Drizzle o `supabase-js`?

### Los tres caminos, evaluados contra este código concreto (no en abstracto)

**A. Drizzle + `postgres-js` contra Supabase, sin RLS.**
Se conserva `packages/db` casi intacto: `analyses.ts`, `invites.ts`, `rate-limit.ts`
siguen siendo funciones tipadas, ownership-scoped, con el mismo `TerritorioDb`. Cambia
el dialecto (`drizzle-orm/better-sqlite3` → `drizzle-orm/postgres-js`) y el tipo de
columnas. El riesgo real: la conexión usa credenciales de servicio (o la connection
string directa/Supavisor), así que si algún día algo *distinto* de este servidor habla
con la base — un cliente en el browser, un Edge Function, Realtime — no hay ninguna
capa de RLS deteniéndolo. Hoy nada de eso existe en el repo.

**B. `supabase-js` con RLS, reescribiendo el acceso a datos.**
Idiomático en el sentido de "así se enseña Supabase en sus docs", pero acá cuesta caro
por razones concretas del código, no por principio:
- `rate-limit.ts` hace un upsert atómico con SQL crudo
  (`INSERT ... ON CONFLICT(key) DO UPDATE SET count = CASE WHEN ... END`) para que dos
  intentos de login concurrentes no pisen el contador. `supabase-js` es un cliente
  PostgREST — no expone `ON CONFLICT` con expresiones condicionales en el `SET`; para
  igualar esa semántica hay que mover la lógica a una función de Postgres (`rpc()`),
  lo cual es exactamente "escribir SQL a mano en la base", solo que ahora vive en una
  migración en vez de en TypeScript tipado.
- `invites.ts` (`claimInvite`) depende de un UPDATE condicional de una sola sentencia
  (`WHERE code = ? AND used_at IS NULL`) para que el canje sea single-use bajo
  concurrencia. Mismo problema: PostgREST no da UPDATE-con-WHERE-y-retorno-de-si-afectó
  como primitiva de alto nivel sin envolver en una función.
- `getAnalysisByRasterJobIdForUser` usa `sql\`json_extract(...)\`` — en Postgres esto se
  vuelve un operador `->>` de jsonb, que `supabase-js` sí puede expresar via
  `.contains()` o filtros, pero se pierde el tipado de extremo a extremo que hoy da
  Drizzle sobre `AnalysisResult`.
- El precio de hacerlo bien (RPCs de Postgres para cada escritura no trivial) diluye la
  ventaja de "no escribir SQL": se termina escribiendo SQL igual, pero en `supabase/migrations/*.sql` en vez de en TypeScript con autocompletado.

**C. Híbrido: `supabase-js` para auth y datos del usuario, Drizzle solo para
esquema.**
Tal como está planteado en la consigna (supabase-js para todo lo de datos, Drizzle solo
generando migraciones) hereda el problema de B para el acceso a datos, así que no
resuelve nada — solo lo pospone hasta el primer INSERT.

**Un híbrido distinto, que sí es el que se recomienda:** Drizzle + `postgres-js` para
**todo** el acceso a datos desde el servidor (ownership checks, atomicidad, tipado), y
el **CLI `supabase`** como dueño de la aplicación de migraciones, del stack local y de
Auth. La línea divisoria no es "auth vs. datos" sino "quién le habla a Postgres"
(un único proceso Node, siempre) vs. "quién es la autoridad del historial de esquema"
(Supabase, no drizzle-kit). Sección 2 explica cómo conviven sin pisarse.

### Sobre RLS específicamente

Server-only significa que la conexión de Postgres siempre corre con credenciales que
verían todas las filas — RLS con políticas normales no cambiaría el comportamiento del
código actual, porque nunca hay un JWT de usuario final en esa conexión (el patrón
`createDrizzle` de Supabase para propagar `request.jwt.claims` a una transacción
existe, pero es trabajo extra para replicar un control que `analyses.ts` ya hace con un
`WHERE userId = ?` explícito y probado).

Pero: Supabase expone **todo el esquema `public`** vía PostgREST por defecto, con
`anon`/`authenticated` como roles — eso es independiente de si la app usa
`supabase-js` o no. Si `analysis`, `invite`, `rate_limit` viven en `public` sin RLS,
cualquiera con la `anon key` del proyecto puede leerlas por la API REST autogenerada
aunque el código de la app jamás la use. Drizzle soporta esto de forma nativa desde
`drizzle-orm@0.32`+ (`pgTable.withRLS()` — antes `.enableRLS()`, deprecado — y
`pgPolicy`, con helpers `authenticatedRole`/`authUsers` en `drizzle-orm/supabase`):
sin políticas declaradas, `withRLS()` es *default-deny total*. Ese es exactamente el
comportamiento deseado acá: **RLS encendido, cero políticas**, como cinturón de
seguridad contra la superficie PostgREST que Supabase prende sola — no como sustituto
del chequeo de `userId` en `packages/db`, que sigue siendo la autorización real.

```ts
// packages/db/src/schema.ts, bajo el nuevo dialecto Postgres
import { pgTable, uuid, text, jsonb, timestamptz /* … */ } from 'drizzle-orm/pg-core';

export const analysis = pgTable.withRLS('analysis', { /* columnas */ });
// Sin pgPolicy() → ninguna fila visible vía PostgREST/anon/authenticated.
// El servidor sigue leyendo/escribiendo normal: la conexión de postgres-js
// usa el rol de servicio (o postgres directo), que RLS no restringe.
```

---

## 2. Migraciones: cómo son de verdad en Supabase, y cómo conviven con drizzle-kit

El CLI `supabase` (paquete `/supabase/cli`) tiene su propio pipeline, independiente de
drizzle-kit:

- **Carpeta**: `supabase/migrations/`, archivos `<timestamp>_nombre.sql` en orden
  cronológico — el timestamp es literal el orden de aplicación, no un contador.
- **`supabase migration new <nombre>`**: crea el archivo vacío con el timestamp
  correcto.
- **`supabase db diff`**: compara el estado local (o el Studio-editado) contra las
  migraciones ya escritas y genera el SQL que falta. Pensado para quien edita el
  esquema visualmente en el Dashboard y quiere capturarlo como migración — no es el
  flujo que le sirve a este repo, donde el esquema nace en `schema.ts`.
- **`supabase db push`**: aplica las migraciones *locales* pendientes contra el
  proyecto remoto vinculado (`supabase link`). Al primer uso crea una tabla de
  historial propia en el proyecto remoto y solo aplica lo que no está ahí — server-side
  tracking, no un archivo en el repo.
- **`supabase db reset`** (local): recrea la base local desde cero corriendo todas las
  migraciones + `supabase/seed.sql`. Es el equivalente Postgres de borrar el `.db` y
  correr `scripts/seed.ts` hoy.
- **Advertencia real de la propia doc de Supabase**: editar el esquema a mano en el SQL
  Editor o el Table Editor del Dashboard salta el historial de migraciones y hace que
  `db push` falle por desincronización — nadie debería tocar el esquema fuera del flujo
  de migraciones una vez que este pipeline está en marcha.

**El punto de fricción real con Drizzle**, confirmado por reportes de producción de
gente que ya hizo este cruce: `drizzle-kit`'s propio migrator lleva su historial en una
tabla `drizzle.__drizzle_migrations`; el de Supabase lleva el suyo en un esquema propio
(`supabase_migrations`). Si se usan **los dos aplicadores** (el migrator programático
de `drizzle-orm/postgres-js/migrator`, como hoy hace `scripts/migrate.ts`, *y* `supabase
db push`), cada uno cree que manda y no se enteran el uno del otro — restaurar una base
desde backup o crear un branch de Supabase dispara que Drizzle no vea su tabla de
historial y quiera reaplicar todo desde cero.

**La solución que ya usa la comunidad y que es la que corresponde acá**: drizzle-kit
como **generador de SQL únicamente** (`drizzle-kit generate`, nunca `drizzle-kit
migrate` ni `drizzle-kit push` contra el proyecto real), con el output apuntando
directo a `supabase/migrations/` en vez de a `packages/db/drizzle/`. Desde
`drizzle-kit` v0.32 existe justo la opción para esto:

```ts
// drizzle.config.ts
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema.ts',
  out: '../../supabase/migrations',   // no packages/db/drizzle
  migrations: { prefix: 'supabase' },  // nombres <timestamp>_slug.sql, formato Supabase
  dbCredentials: { url: process.env.DATABASE_URL! },
});
```

Flujo resultante, reemplazando `pnpm db:generate` / `pnpm db:migrate` de hoy:

1. Se edita `schema.ts`.
2. `drizzle-kit generate` produce el `.sql` en `supabase/migrations/`, con el nombre
   que Supabase espera.
3. `supabase db reset` lo aplica local (Docker) y valida.
4. Se commitea el `.sql` generado — igual que hoy se commitean los de
   `packages/db/drizzle/`.
5. `supabase db push` (o el paso equivalente en CI/CD) lo aplica al proyecto remoto.

`scripts/migrate.ts` (el migrator programático de drizzle-orm) deja de correr en
producción — su trabajo pasa a `supabase db push`. Se puede conservar como fallback de
emergencia si algún día hace falta migrar sin el CLI, pero no debe correr en el mismo
pipeline que `db push`, por el problema de las dos tablas de historial de arriba.

---

## 3. Traducción de esquema SQLite → Postgres

Con Supabase Auth reemplazando a Better Auth (la premisa del proyecto): `user`,
`session`, `account`, `verification` **no se migran** — desaparecen de este paquete.
Supabase provisiona `auth.users` (y `auth.sessions`, `auth.identities`, etc.) por
proyecto, gestionadas por GoTrue; no son tablas que este repo cree ni versione. Lo que
sí sobrevive de `user` es cualquier dato de perfil propio de la app (hoy solo
`name`/`image`, que Better Auth guardaba) — si se necesita, va a una tabla
`public.profiles` 1:1 con `auth.users.id`, poblada por un trigger
`on auth.users insert`, patrón estándar de Supabase. Eso es decisión del documento de
auth, no de este.

Lo que queda bajo este ángulo son las tres tablas propias de la app:

| Tabla | Columna | SQLite hoy | Postgres | Nota |
|---|---|---|---|---|
| `invite` | `id` | `text` (uuid app-side) | `uuid` | Mismo `randomUUID()` en `createInvite`; solo cambia el tipo de columna, no quién genera el valor. |
| | `created_by`, `used_by_user_id` | FK a `user.id` (`text`) | FK a `auth.users(id)` (`uuid`) | Apuntan a la tabla gestionada por Supabase Auth, no a una tabla propia. |
| | `created_at`, `expires_at`, `used_at` | `integer` (`timestamp_ms`) | `timestamptz` | Ver nota general de timestamps abajo. |
| `analysis` | `id` | `text` | `uuid` | Igual que `invite.id`. |
| | `user_id` | FK a `user.id` | FK a `auth.users(id)` | — |
| | `status` | `text` con `enum` a nivel Drizzle | `pgEnum('analysis_status', ANALYSIS_STATUSES)` | `ANALYSIS_STATUSES` ya es el array fuente; se reusa 1:1 como `pgEnum`, gana validación a nivel de Postgres que hoy no existe (SQLite no aplica el `enum` de Drizzle, solo TypeScript lo hace). |
| | `aoi_geojson` | `text` (`mode: 'json'`) | `jsonb` | — |
| | `result_json` | `text` (`mode: 'json'`), tope de 6 MB aplicado en `apps/web/src/lib/analysis-runtime.ts` (`MAX_RESULT_BYTES`) | `jsonb` | Ver detalle abajo — es el punto que más importa. |
| | `area_ha` | `real` | `real` / `double precision` | Sin cambio funcional. |
| | `created_at`, `updated_at` | `integer` | `timestamptz` | — |
| `rate_limit` | `id` | `text` | `uuid` | — |
| | `key` | `text` **unique** | `text` **unique** | Mismo `uniqueIndex`, mismo target de `onConflictDoUpdate`. Sin cambio de comportamiento. |
| | `count`, `last_request` | `integer` (epoch ms) | **se mantienen como `bigint`, no `timestamptz`** | Ver nota. |

**`result_json` → `jsonb`, en detalle.** El tope de 6 MB de hoy (`MAX_RESULT_BYTES`) es
una decisión de la app, no un límite de SQLite — y sigue siendo una buena idea en
Postgres, por una razón distinta a "no entra". `jsonb` en Postgres no tiene un techo de
6 MB: el límite real es ~1 GB por valor (254 MB usable en la práctica, documentado
como 1/4 GB − 1 byte), muy por encima de cualquier payload de este dominio. Lo que sí
sigue costando caro, igual que hoy, es TOAST: cualquier valor por encima de ~2 KB
Postgres lo comprime y lo saca a una tabla TOAST aparte con un puntero en la fila
principal, así que una fila de `analysis` con `result_json` grande paga
descompresión + deserialización completa en cada lectura — exactamente el motivo que ya
está documentado en el comentario de `analysis-runtime.ts` ("una fila de decenas de MB
convierte cada lectura del reporte en una deserialización cara"), solo que en Postgres
el mecanismo que lo causa tiene nombre (TOAST) en vez de ser "SQLite guarda todo
inline". **Conclusión: el tope de 6 MB se mantiene tal cual en `apps/web`**; no es algo
que Postgres resuelva ni que haga falta subir. Lo que sí gana con `jsonb` es indexación
por expresión: hoy `getAnalysisByRasterJobIdForUser` hace un
`sql\`json_extract(${resultJson}, '$.raster_job_id')\`` con full-table-scan, con un
comentario propio diciendo "worth an index if that changes" — en Postgres eso se
resuelve con un índice de expresión directo:

```sql
create index analysis_raster_job_id_idx
  on analysis ((result_json ->> 'raster_job_id'));
create index analysis_coastal_cache_key_idx
  on analysis ((result_json -> 'coastal' ->> 'cache_key'));
```

y las dos funciones de `analyses.ts` pasan de `json_extract(...)` a `${analysis.resultJson}->>'raster_job_id'`, sin cambiar su forma ni su contrato — el `sql\`...\`` crudo que ya usan sigue siendo el vehículo correcto, solo cambia el operador.

**`rate_limit.last_request` — por qué se queda en `bigint`, no pasa a `timestamptz`.**
El CAS de `consumeRateLimit` hace aritmética entera directa:
`(${now} - ${rateLimit.lastRequest}) > ${windowMs}`, con `now`/`windowMs` en
milisegundos. Esa expresión traduce carácter por carácter a Postgres si la columna
sigue siendo un entero de 64 bits (`bigint`) guardando epoch-ms — cambiarla a
`timestamptz` obligaría a reescribir la comparación como aritmética de intervalos
(`now() - last_request > interval '60 seconds'`) sin ganar nada, porque esta tabla no
se lee nunca por rango de fecha ni se le hace `ORDER BY`. Es el único lugar del esquema
donde **no** conviene el `timestamptz` idiomático — justo por ser el único timestamp
que participa en aritmética entera en vez de en comparación de fechas.

**Timestamps, regla general para el resto.** `integer` en modo `timestamp_ms` pasa a
`timestamp(3) with time zone` (`timestamptz`), con `.defaultNow()` reemplazando al
`.$defaultFn(() => new Date())` de hoy — Postgres computa el default server-side en vez
de que lo calcule Node, lo cual además cierra una ventana minúscula de reloj
desincronizado entre app server y base que hoy existe.

**IDs: `uuid` nativo, generación sin cambios.** Cambiar `text` → `uuid` da comparaciones
e índices más baratos (16 bytes fijos vs. ~36 de texto) sin tocar una línea de
`createAnalysis`/`createInvite`: siguen llamando `randomUUID()` de `node:crypto` y
pasando el valor explícito, exactamente igual que hoy — no hace falta `defaultRandom()`
en el schema. Postgres/Supabase traen `pgcrypto` habilitado por defecto, así que
`gen_random_uuid()` está disponible nativamente si en algún momento se prefiere que sea
la base la que genere el id en vez de la app; no es necesario para esta migración.

**El índice compuesto con `DESC`** (`analysis_user_id_created_at_idx`, hoy
`sql\`${table.createdAt} DESC\`` sobre SQLite) es sintaxis Postgres válida sin cambios —
`create index ... on analysis (user_id, created_at desc)` es soportado nativamente.

---

## 4. Desarrollo local: ¿se puede seguir corriendo tests sin red?

`supabase start` levanta el stack completo local en contenedores Docker: Postgres real
(mismo motor y misma versión mayor que producción — hoy Postgres 17), GoTrue (Auth),
PostgREST, Storage, Studio, todo en `localhost`. Una vez que las imágenes están
descargadas, el uso día a día **no requiere red** — es exactamente el mismo modelo que
Docker Compose ya usa en este repo hoy para `services/api`.

Lo que cambia respecto a hoy es el costo de arranque, no la posibilidad de trabajar
offline:

- **Hoy**: los tests unitarios corren contra SQLite `:memory:` — cero proceso externo,
  arranca en milisegundos, es lo que permite que el CI sin red corra la suite offline
  (mencionado explícitamente como restricción actual).
- **Con Supabase**: no existe un modo "Postgres en memoria" equivalente. La opción real
  es apuntar los tests a una instancia de Postgres real — sea el stack de
  `supabase start` en Docker, sea un `postgres:17` suelto en Docker Compose sin el
  resto de servicios de Supabase (Auth/Storage/Studio no hacen falta para testear
  `packages/db`). Ambos caminos requieren Docker corriendo en la máquina/runner, pero
  **ninguno requiere red una vez que la imagen está cacheada localmente** — Docker
  sirve la imagen desde el cache local sin salir a internet.
- **Consecuencia concreta para CI**: si el runner de CI no tiene red *y tampoco tiene la
  imagen de Postgres pre-cacheada*, la suite deja de poder correr — hoy corre igual sin
  red porque SQLite no depende de una imagen externa. Esto es un cambio real de
  requisito de infraestructura, no cosmético: el pipeline de CI necesita, o bien red
  para el primer `docker pull`, o bien la imagen de Postgres pre-horneada en el runner
  (matriz de CI con la imagen cacheada, o un runner self-hosted con la imagen ya
  presente). No hay forma de mantener "cero dependencias externas" para los tests con
  Postgres real — es el trade-off explícito de dejar SQLite.
- Tiempo de arranque: un Postgres en Docker tarda segundos en estar listo (no
  milisegundos como `:memory:`), lo cual generalmente se resuelve con un contenedor que
  vive durante toda la corrida de CI (`services:` en GitHub Actions, o
  `docker compose up -d` antes de `vitest run`) en vez de levantarlo por test.

---

## 5. Pooling desde el servidor SSR de Node

Tres formas de conectar, todas documentadas por Supabase:

| Modo | Puerto | Qué es | Cuándo usarlo acá |
|---|---|---|---|
| Conexión directa | 5432 | Postgres sin pooler, IPv6 por defecto (IPv4 requiere el add-on pago) | Válido para el servidor SSR si la red del hosting tiene salida IPv6; es lo que da menor latencia por no pasar por el pooler. |
| Supavisor, **session mode** | 5432 (vía `*.pooler.supabase.com`) | Un cliente = una conexión de backend dedicada durante toda la sesión | La opción recomendada para este caso: proceso Node persistente y de larga vida (igual que hoy con la conexión `better-sqlite3` memoizada en `client.ts`), en red IPv4-only (típico de un host Docker Compose autoalojado sin salida IPv6 configurada). Soporta *prepared statements*. |
| Supavisor, **transaction mode** | 6543 | Conexiones prestadas por transacción, se sueltan al terminar cada una | Pensado para serverless/edge (muchas conexiones cortas y efímeras) — no es el patrón de este repo, que mantiene un pool de conexión único y de larga vida. **No soporta prepared statements**; si se usa, hay que abrir `postgres(url, { prepare: false })`. |

Recomendación concreta para `packages/db/src/client.ts`: **Supavisor en modo
session (puerto 5432, host `*.pooler.supabase.com`)**, no la conexión directa ni el
modo transacción. Motivo: el deploy es Docker Compose autoalojado con salida de red
estándar (probablemente IPv4), y el servidor Node ya mantiene una sola conexión
memoizada de por vida del proceso — exactamente el patrón para el que existe el modo
session. La migración de `client.ts` es acotada:

```ts
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const client = postgres(process.env.DATABASE_URL!); // session mode, prepare:true (default) está OK acá
export const db = drizzle({ client, schema });
```

(el `prepare: false` documentado por Drizzle solo hace falta en modo transacción — con
session mode, que es lo recomendado, los prepared statements funcionan normal).

**Límites del free tier para el pool**: el free tier corre en un compute compartido
(Shared CPU, 500 MB RAM) — Supabase no publica un número fijo de "conexiones Supavisor
máximas" independiente del tier de cómputo; el límite práctico lo pone la RAM del
compute asignado, no una cuota contractual aparte. Con un único servidor Node
manteniendo una conexión (o un pool chico, 5-10) esto no es un problema al tamaño de
uso actual del repo.

---

## 6. Free tier: números reales (verificados hoy contra la doc y el pricing de Supabase)

- **Tamaño de base**: 500 MB de almacenamiento, en un compute compartido (500 MB RAM).
- **Proyectos activos**: límite de 2 proyectos activos por organización en el free tier.
- **Egress**: 5 GB de egress + 5 GB de egress cacheado por mes.
- **Auto-pause**: confirmado — un proyecto free se pausa **tras 7 días sin actividad de
  base de datos suficiente** ("insufficient user database activity"; unas pocas queries
  reales por día alcanzan para resetear el contador). Los proyectos pagos (Pro en
  adelante) **nunca se pausan** por inactividad.
- **Reactivar un proyecto pausado**: dentro de los primeros 90 días, un click en
  "Resume project" desde el Dashboard alcanza — los datos y la configuración vuelven
  intactos, típicamente en un par de minutos. **Pasados los 90 días, el restore de un
  click se desactiva**: hay que descargar el backup y restaurarlo a mano en un proyecto
  nuevo. La ventana total para poder recuperar algo es de **1 año** desde la pausa —
  después de eso, no hay camino de recuperación documentado.
- **Costo de "despertar"**: no hay costo monetario documentado por reactivar — el costo
  real es el downtime mientras el proyecto está pausado (no acepta conexiones) y la
  fricción operativa de que alguien tiene que notar la pausa y click "Resume" a mano
  (no hay reactivación automática por request entrante, a diferencia de un cold start
  de función serverless).

Esto confirma el riesgo ya identificado en la consigna: para un uso self-hosted con
tráfico irregular (que es el perfil de este repo, sin usuarios 24/7), el free tier de
Supabase puede pausarse solo, y a los 90 días la recuperación deja de ser trivial. La
mitigación estándar de la comunidad es un ping periódico (cron/GitHub Action) que
mantenga actividad real de base cada semana — pero eso es un parche sobre un free tier
que no está pensado para producción continua; la alternativa honesta si el uso real
importa es Pro ($25/mes), que elimina el auto-pause por completo.

---

## Plan de migración de esquema, en pasos

1. **Provisionar el proyecto Supabase** (o el stack local vía `supabase init` +
   `supabase start`) y confirmar la versión de Postgres asignada (17 salvo cambio).
2. **Cambiar el dialecto de Drizzle**: `drizzle-orm/better-sqlite3` →
   `drizzle-orm/postgres-js`; `drizzle.config.ts` de `dialect: 'sqlite'` a
   `'postgresql'`, con `out` apuntando a `supabase/migrations` y
   `migrations: { prefix: 'supabase' }`.
3. **Reescribir `schema.ts`** con los tipos de la tabla de la sección 3: `uuid`,
   `timestamptz` (menos `rate_limit.last_request`, que se queda `bigint`), `jsonb`,
   `pgEnum('analysis_status', ANALYSIS_STATUSES)`. Quitar `user`/`session`/`account`/
   `verification` del `schema` object (los resuelve Supabase Auth); agregar la
   referencia a `authUsers` de `drizzle-orm/supabase` para las FKs de `invite` y
   `analysis`. Aplicar `pgTable.withRLS()` sin políticas a las tres tablas propias.
4. **Generar la migración inicial**: `drizzle-kit generate` produce el `.sql` en
   `supabase/migrations/`; revisar a mano (especialmente los `create index` con
   expresión para `raster_job_id`/`coastal.cache_key`, que no salen automáticos de
   Drizzle — se agregan como statement manual en la misma migración o en una siguiente).
5. **Aplicar local**: `supabase db reset` contra el stack de `supabase start`; correr la
   suite de `packages/db` contra esa instancia (ver sección 4 sobre el cambio de
   requisito de CI).
6. **Reescribir `client.ts`**: conexión `postgres-js` en modo Supavisor session
   (puerto 5432, host pooler), memoizada igual que hoy.
7. **Auditar `analyses.ts`**: cambiar los dos `json_extract(...)` por `->>'...'` de
   jsonb; nada más cambia de forma (siguen siendo funciones ownership-scoped con
   `and(eq(...), eq(...))`).
8. **Retirar `scripts/migrate.ts`** del pipeline de producción (o dejarlo solo como
   fallback manual, nunca en el mismo pipeline que `supabase db push`); el paso de
   deploy pasa a incluir `supabase db push` contra el proyecto vinculado.
9. **`supabase db push`** al proyecto remoto, validar contra un ambiente de
   staging/dev antes de producción — el patrón de dos proyectos Supabase (dev/prod) es
   gratis en el free tier y evita que la primera vez que una migración corre sea ya en
   producción.
10. **Decidir el auto-pause** antes de ir a producción real: o se acepta el riesgo con
    un ping semanal automatizado, o se sube a Pro ($25/mes) antes del primer 7 días sin
    tráfico — no es algo para resolver después del go-live.

---

### Fuentes consultadas

- Docs de Drizzle ORM (Context7 `/drizzle-team/drizzle-orm-docs`): conexión a Supabase
  con `postgres-js`, RLS (`pgPolicy`, `withRLS`, `drizzle-orm/supabase`), config de
  `migrations.prefix`.
- Docs y CLI de Supabase (Context7 `/supabase/cli`; `supabase.com/docs/guides/deployment/database-migrations`,
  `.../guides/local-development`, `.../guides/database/connecting-to-postgres`,
  `.../guides/platform/free-project-pausing`, `.../pricing`): comandos de migración,
  `supabase start`, connection strings/Supavisor, auto-pause y límites del free tier.
- Búsqueda web: reportes de producción sobre el choque de historiales
  `drizzle.__drizzle_migrations` vs. el tracking propio de `supabase db push`;
  comportamiento de TOAST y límite práctico de `jsonb` en Postgres; ventana de 90
  días/1 año para restaurar un proyecto pausado.
