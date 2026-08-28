/**
 * Resultados como unión discriminada, no como excepciones.
 *
 * Motivo, y es el mismo de la regresión #3 del inventario: en esta app un
 * servicio caído es un **caso esperado**, no un bug. Que WDPA no responda tiene
 * que poder viajar hasta la UI como un dato (`available: false`, banner rojo,
 * el resto del análisis intacto) en vez de propagarse como excepción y tumbar
 * el request entero. Una excepción se olvida de atrapar; una unión discriminada
 * no compila si no la mirás.
 *
 * La regla es: **fallo esperado → `ApiFailure`; bug del programador → `throw`.**
 * Un 503 de Overpass es lo primero. Llamar al cliente con un `baseUrl` vacío es
 * lo segundo.
 */

/** Taxonomía cerrada de fallos. Cada miembro tiene un tratamiento distinto en la UI. */
export type ApiFailureKind =
  /** No hubo respuesta: DNS, conexión rechazada, TLS, el servicio no está arriba. */
  | 'red'
  /** Hubo conexión pero se agotó el tiempo. Reintentable. */
  | 'timeout'
  /** El llamador abortó (navegación, `AbortController`). NO es un error a mostrar. */
  | 'cancelado'
  /** 401/403 — falta o no sirve `API_TOKEN`. */
  | 'no-autorizado'
  /** 404 — el análisis, la capa o la clave de caché no existen. */
  | 'no-encontrado'
  /** 409 — el recurso existe pero todavía no está listo. */
  | 'no-listo'
  /** 422 — el AOI no pasó la validación del servicio. Mensaje mostrable. */
  | 'aoi-invalido'
  /** 5xx — el servicio respondió con un error propio. */
  | 'servicio'
  /** Respondió 2xx pero el cuerpo no coincide con el contrato. Ver `issues`. */
  | 'contrato';

export type ApiFailure = {
  ok: false;
  kind: ApiFailureKind;
  /** Texto en español, apto para mostrarle a una persona. */
  message: string;
  /** Código HTTP cuando hubo respuesta. */
  status?: number;
  /** URL pedida, para el log. */
  url?: string;
  /** Rutas de los campos que no validaron, sólo en `kind: 'contrato'`. */
  issues?: string[];
  /** El error original, sin normalizar. Nunca se muestra. */
  cause?: unknown;
};

export type ApiSuccess<T> = { ok: true; data: T };

export type ApiResult<T> = ApiSuccess<T> | ApiFailure;

export function ok<T>(data: T): ApiSuccess<T> {
  return { ok: true, data };
}

export function fail(failure: Omit<ApiFailure, 'ok'>): ApiFailure {
  return { ok: false, ...failure };
}

export function isOk<T>(result: ApiResult<T>): result is ApiSuccess<T> {
  return result.ok;
}

export function isFailure<T>(result: ApiResult<T>): result is ApiFailure {
  return !result.ok;
}

/** Aplica `fn` al valor exitoso; propaga el fallo tal cual. */
export function mapResult<T, U>(result: ApiResult<T>, fn: (value: T) => U): ApiResult<U> {
  return result.ok ? ok(fn(result.data)) : result;
}

/** El valor, o `fallback` si falló. Para lecturas opcionales. */
export function unwrapOr<T>(result: ApiResult<T>, fallback: T): T {
  return result.ok ? result.data : fallback;
}

/**
 * Convierte un fallo en excepción. Sólo para los pocos lugares donde no hay
 * nada útil que mostrar y el error es realmente terminal (por ejemplo, un
 * loader de ruta que ya redirige por su cuenta).
 */
export class ApiError extends Error {
  override readonly name = 'ApiError';
  readonly kind: ApiFailureKind;
  readonly status: number | undefined;

  constructor(failure: ApiFailure) {
    super(failure.message, { cause: failure.cause });
    this.kind = failure.kind;
    this.status = failure.status;
  }
}

export function unwrapOrThrow<T>(result: ApiResult<T>): T {
  if (result.ok) return result.data;
  throw new ApiError(result);
}

/** Un fallo por el que vale la pena reintentar solo. Los demás son definitivos. */
export function isRetryable(failure: ApiFailure): boolean {
  return failure.kind === 'red' || failure.kind === 'timeout' || failure.kind === 'servicio';
}
