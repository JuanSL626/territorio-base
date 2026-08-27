/**
 * Regenera el contrato con el servicio raster.
 *
 *     pnpm --filter @territorio/api-client generate
 *     pnpm --filter @territorio/api-client generate -- --url http://localhost:8787
 *
 * Dos artefactos, los dos versionados:
 *
 *   openapi/openapi.json    snapshot del esquema tal como lo emite FastAPI
 *   src/generated/schema.ts tipos TypeScript derivados de ese snapshot
 *
 * Ninguno se escribe a mano. El snapshot se versiona además del `.ts` porque es
 * lo que hace revisable un cambio de contrato: el diff del JSON dice qué cambió
 * en el servicio, el diff del `.ts` dice qué se rompe en el cliente.
 *
 * Orden de resolución del esquema:
 *
 *   1. `--url <base>` o `API_URL` → `GET {base}/openapi.json` (el servicio
 *      corriendo es la fuente autoritativa).
 *   2. Si no responde, `uv run` dentro de `services/api` construye la app y
 *      serializa `app.openapi()` sin levantar un servidor. Esto es lo que
 *      permite regenerar en CI sin orquestar un puerto.
 *
 * Si las dos fallan, el script sale con código 1 y NO toca los archivos: un
 * snapshot a medias es peor que uno viejo.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const apiServiceDir = resolve(packageDir, '../../services/api');
const snapshotPath = resolve(packageDir, 'openapi/openapi.json');
const typesPath = resolve(packageDir, 'src/generated/schema.ts');

const DEFAULT_BASE_URL = 'http://localhost:8787';

function readBaseUrl(argv: readonly string[]): string {
  const flag = argv.indexOf('--url');
  const fromFlag = flag === -1 ? undefined : argv[flag + 1];
  return (fromFlag ?? process.env.API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
}

async function fromRunningService(baseUrl: string): Promise<unknown> {
  const url = `${baseUrl}/openapi.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} en ${url}`);
  return await response.json();
}

function fromUvSubprocess(): unknown {
  const stdout = execFileSync(
    'uv',
    [
      'run',
      'python',
      '-c',
      'import json,sys;from territorio_base_api.main import app;json.dump(app.openapi(), sys.stdout, ensure_ascii=False)',
    ],
    { cwd: apiServiceDir, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(stdout) as unknown;
}

async function loadSchema(baseUrl: string): Promise<unknown> {
  try {
    const document = await fromRunningService(baseUrl);
    console.log(`Esquema tomado del servicio en ${baseUrl}.`);
    return document;
  } catch (error) {
    console.log(`El servicio en ${baseUrl} no respondió (${String(error)}).`);
    console.log(`Reintentando con \`uv run\` en ${apiServiceDir}…`);
    return fromUvSubprocess();
  }
}

function assertLooksLikeOpenApi(document: unknown): asserts document is Record<string, unknown> {
  if (typeof document !== 'object' || document === null) {
    throw new Error('El esquema no es un objeto JSON.');
  }
  const record = document as Record<string, unknown>;
  if (typeof record.openapi !== 'string') {
    throw new Error('El esquema no declara la versión de `openapi`.');
  }
  if (typeof record.paths !== 'object' || record.paths === null) {
    throw new Error('El esquema no tiene `paths`: no es un documento OpenAPI.');
  }
}

async function main(): Promise<void> {
  const baseUrl = readBaseUrl(process.argv.slice(2));
  const document = await loadSchema(baseUrl);
  assertLooksLikeOpenApi(document);

  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(snapshotPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  console.log(`Snapshot escrito: ${snapshotPath}`);

  // openapi-typescript se resuelve desde node_modules/.bin del propio paquete.
  mkdirSync(dirname(typesPath), { recursive: true });
  execFileSync(
    resolve(packageDir, 'node_modules/.bin/openapi-typescript'),
    [snapshotPath, '--output', typesPath, '--root-types', '--alphabetize'],
    { cwd: packageDir, stdio: 'inherit' },
  );
  console.log(`Tipos escritos: ${typesPath}`);
}

await main();
