# @territorio/api-client

El contrato tipado con `services/api` (FastAPI + odc-stac), el servicio raster.

Tres capas, y el orden importa:

| capa | archivo | qué garantiza |
| --- | --- | --- |
| tipos generados | `src/generated/schema.ts` | que los tipos digan lo que el servicio **realmente** expone |
| validación | `src/schemas.ts` | que lo que llega en runtime coincida con esos tipos |
| cliente | `src/client.ts`, `src/sse.ts` | que los fallos esperados sean datos, no excepciones |

---

## Regenerar el contrato

```bash
# con el servicio corriendo (fuente autoritativa)
cd services/api && uv run uvicorn territorio_base_api.main:app --port 8787
pnpm --filter @territorio/api-client generate

# o sin levantar nada: el script cae a `uv run` dentro de services/api
pnpm --filter @territorio/api-client generate

# contra otra base
pnpm --filter @territorio/api-client generate -- --url https://api.ejemplo.do
```

Escribe **dos** artefactos, los dos versionados:

- `openapi/openapi.json` — snapshot del esquema tal cual lo emite FastAPI. Se
  versiona además del `.ts` porque es lo que hace revisable un cambio de
  contrato: el diff del JSON dice qué cambió en el servicio, el del `.ts` dice
  qué se rompe acá.
- `src/generated/schema.ts` — salida de `openapi-typescript`. **No se edita a
  mano** y está fuera de ESLint y de Prettier a propósito: cualquier retoque lo
  revertiría la próxima regeneración.

Si el esquema cambia y el zod de `schemas.ts` no, **`pnpm typecheck` falla**.
Esa es la red: `CONTRACT_PARITY` es una tabla de igualdades de tipo exactas
(`Exact<z.infer<typeof X>, SchemaX>`) entre cada esquema zod y su tipo generado.
No es asignabilidad mutua — `string` vs `string | undefined` también rompe.

---

## Usarlo

```ts
import { createRasterApiClient, isOk } from '@territorio/api-client';

const api = createRasterApiClient({ baseUrl: 'http://localhost:8787', token });

const job = await api.createAnalysis({ aoi, ndvi_resolution_m: 10 });
if (!job.ok) {
  // job.kind: 'red' | 'timeout' | 'cancelado' | 'no-autorizado' | 'no-encontrado'
  //         | 'no-listo' | 'aoi-invalido' | 'servicio' | 'contrato'
  // job.message ya viene en español y es mostrable.
  return job;
}

for await (const event of api.streamAnalysisEvents(job.data.id, { signal })) {
  if (event.type === 'progress') console.log(event.message); // «Descargando DEM…»
  if (event.type === 'done') break;
}
```

### Resultados, no excepciones

Un servicio caído es un **caso esperado**, no un bug: la regresión #3 del
inventario existe porque un tercero caído tumbaba el análisis entero. Por eso
todo método devuelve `ApiResult<T>` (`{ ok: true, data } | { ok: false, kind,
message, … }`). Lo único que lanza son los errores de programación, como
construir el cliente con un `baseUrl` vacío.

### El stream de progreso

`streamAnalysisEvents` usa `fetch` y no `EventSource` por tres razones: hace
falta poner `Authorization`, `EventSource` no existe en Node (y el consumidor
principal es el SSR), y su reconexión automática es opaca.

El servicio **reenvía todo el progreso previo** cuando un cliente se conecta.
Eso es bueno para quien llega tarde y una fuente de duplicados en cada
reconexión, así que el helper deduplica por `step` monótono. Termina siempre con
exactamente un evento terminal:

- `done` / `failed` — el **job** terminó.
- `stream-error` — se perdió el **stream**, no el job. El análisis puede seguir
  corriendo perfectamente; hay que caer a `getAnalysis(id)`.

Cortar el `for await` cancela el body y suelta el socket.

---

## Lo que este paquete no hace

Nada vectorial (`@territorio/geo`), nada de persistencia (`@territorio/db`) y
nada de fusionar raster con vector — eso es `apps/web/src/lib/analysis-*`.
