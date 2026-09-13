import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const overlay = join(root, 'compose.preview.yaml');

// Solo resolución de configuración, sin daemon ni archivos de entorno reales.
// Los valores siguientes son fixtures explícitos, no credenciales de Supabase.
function composeConfig({ preview = true, project } = {}) {
  const args = ['compose', '--env-file', '/dev/null', '-f', join(root, 'compose.yaml')];
  if (preview && existsSync(overlay)) args.push('-f', overlay);
  if (project) args.push('-p', project);
  args.push('config', '--no-env-resolution', '--format', 'json');
  return JSON.parse(
    execFileSync('docker', args, {
      cwd: root,
      encoding: 'utf8',
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        COMPOSE_DISABLE_ENV_FILE: '1',
        VITE_SUPABASE_URL: 'https://supabase.example.invalid',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'test-only-public-key',
        WEB_PUBLIC_URL: 'https://preview.example.invalid',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}

test('la preview usa nombres de proyecto e imágenes distintos de producción', () => {
  const cfg = composeConfig();
  assert.equal(cfg.name, 'territorio-base-preview');
  assert.equal(cfg.services.web.image, 'territorio-base-preview/web:local');
  assert.equal(cfg.services.api.image, 'territorio-base-preview/api:local');
  assert.equal(cfg.volumes['territorio-data'].name, 'territorio-base-preview_territorio-data');
});

test('la preview no hereda puertos del host ni el archivo de entorno de producción', () => {
  const cfg = composeConfig();
  for (const service of Object.values(cfg.services)) {
    assert.deepEqual(service.ports ?? [], [], 'ningún puerto publicado en el host');
    assert.notEqual(service.network_mode, 'host');
  }
  assert.deepEqual(
    cfg.services.web.env_file.map((file) => file.path),
    [join(root, '.env.preview')],
  );
  // Compose omite required=true en su JSON normalizado (es el valor por defecto).
  assert.notEqual(cfg.services.web.env_file[0].required, false);
  assert.equal(cfg.services.api.environment.TERRITORIO_MAX_CONCURRENT_JOBS, '1');
  assert.equal(cfg.services.web.read_only, true);
  assert.equal(cfg.services.web.user, '10001:10001');
});

test('el túnel tiene identidad y estado propios, sin privilegios ni acceso a secretos web', () => {
  const cfg = composeConfig();
  const tunnel = cfg.services.tailscale;
  assert.ok(tunnel, 'falta el servicio de túnel aislado');
  assert.equal(tunnel.hostname, 'territorio-base-preview');
  assert.match(tunnel.image, /^tailscale\/tailscale@sha256:[a-f0-9]{64}$/);
  assert.equal(tunnel.environment.TS_USERSPACE, 'true');
  assert.equal(tunnel.environment.TS_AUTH_ONCE, 'true');
  assert.equal(tunnel.environment.TS_BOOT_TIMEOUT, '30m', 'dar tiempo al login interactivo');
  assert.equal(tunnel.environment.TS_STATE_DIR, '/var/lib/tailscale');
  assert.equal(tunnel.environment.TS_LOCAL_ADDR_PORT, '127.0.0.1:41112');
  assert.equal(tunnel.env_file, undefined);
  assert.equal(
    tunnel.environment.TS_AUTHKEY,
    undefined,
    'autorización interactiva, sin copiar claves',
  );
  assert.deepEqual(tunnel.cap_drop, ['ALL']);
  assert.deepEqual(tunnel.cap_add ?? [], []);
  assert.deepEqual(tunnel.devices ?? [], []);
  assert.notEqual(tunnel.privileged, true);
  assert.equal(tunnel.container_name, undefined, 'Compose conserva el namespace');
  assert.ok(tunnel.security_opt.includes('no-new-privileges:true'));
  assert.equal(tunnel.restart, 'unless-stopped');
  assert.equal(cfg.volumes['tailscale-state'].name, 'territorio-base-preview_tailscale-state');
  assert.deepEqual(
    tunnel.volumes.map(({ type, target }) => ({ type, target })),
    [
      { type: 'bind', target: '/etc/tailscale' },
      { type: 'volume', target: '/var/lib/tailscale' },
    ],
  );
  const configMount = tunnel.volumes.find((volume) => volume.target === '/etc/tailscale');
  assert.equal(configMount.read_only, true);
  assert.equal(configMount.source, join(root, 'deploy/preview/runtime'));
  assert.equal(tunnel.environment.TS_SERVE_CONFIG, '/etc/tailscale/serve.json');
  const template = JSON.parse(readFileSync(join(root, 'deploy/preview/serve.json'), 'utf8'));
  assert.deepEqual(template.TCP, { 443: { HTTPS: true } });
  assert.deepEqual(template.Web, {
    '${TS_CERT_DOMAIN}:443': { Handlers: { '/': { Proxy: 'http://web:3000' } } },
  });
  assert.deepEqual(template.AllowFunnel, { '${TS_CERT_DOMAIN}:443': false });
});

test('el overlay conserva el namespace automático de volúmenes y no cambia el Compose base', () => {
  const other = composeConfig({ project: 'isolated-fixture' });
  assert.equal(other.volumes['territorio-data'].name, 'isolated-fixture_territorio-data');
  assert.equal(other.volumes['tailscale-state'].name, 'isolated-fixture_tailscale-state');
  const base = composeConfig({ preview: false });
  assert.equal(base.name, 'territorio-base');
  assert.equal(base.services.web.image, 'territorio-base/web:latest');
  assert.equal(base.volumes['territorio-data'].name, 'territorio-base_territorio-data');
  assert.equal(base.services.tailscale, undefined);
  assert.ok(base.services.web.ports.some((port) => port.target === 3000));
});

test('Git excluye la configuración operativa y las credenciales de la preview', () => {
  for (const path of ['.env.preview', 'deploy/preview/runtime/serve.json']) {
    execFileSync('git', ['check-ignore', '-q', '--', path], { cwd: root });
  }
});

test('el wrapper usa Docker rootless local y órdenes acotadas sin variables de producción', (t) => {
  const wrapper = join(root, 'scripts/preview.sh');
  assert.ok(existsSync(wrapper), 'falta el wrapper de preview');
  const fixture = mkdtempSync(join(tmpdir(), 'territorio-preview-cli-test-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  mkdirSync(join(fixture, 'scripts'));
  mkdirSync(join(fixture, 'bin'));
  mkdirSync(join(fixture, 'deploy/preview'), { recursive: true });
  copyFileSync(wrapper, join(fixture, 'scripts/preview.sh'));
  copyFileSync(join(root, 'deploy/preview/serve.json'), join(fixture, 'deploy/preview/serve.json'));
  // Fixture vacío y efímero. Nunca se lee el .env.preview del usuario.
  writeFileSync(join(fixture, '.env.preview'), '', { mode: 0o600 });
  const calls = join(fixture, 'docker-calls.jsonl');
  // Doble de Docker exclusivamente para probar órdenes destructivas sin ejecutarlas.
  // La resolución efectiva del YAML se prueba con Docker Compose real arriba.
  writeFileSync(
    join(fixture, 'bin/docker'),
    `#!/usr/bin/env node
require('node:fs').appendFileSync(process.env.TEST_DOCKER_CALLS, JSON.stringify({
  args: process.argv.slice(2), inherited: process.env.VITE_SUPABASE_URL ?? null
}) + '\\n');
`,
    { mode: 0o755 },
  );
  const env = {
    PATH: `${join(fixture, 'bin')}:${process.env.PATH}`,
    HOME: process.env.HOME,
    TEST_DOCKER_CALLS: calls,
    VITE_SUPABASE_URL: 'must-not-inherit.example.invalid',
    COMPOSE_PROJECT_NAME: 'must-not-touch-production',
    DOCKER_HOST: 'tcp://must-not-connect.example.invalid:2376',
    DOCKER_CONTEXT: 'must-not-use-remote-context',
    XDG_RUNTIME_DIR: '/tmp/must-not-select-this-runtime',
  };
  const prefix = [
    '--host',
    `unix:///run/user/${process.getuid()}/docker.sock`,
    'compose',
    '-p',
    'territorio-base-preview',
    '--env-file',
    '.env.preview',
    '-f',
    'compose.yaml',
    '-f',
    'compose.preview.yaml',
  ];
  const commands = [
    [[], ['ps']],
    [['check'], ['config', '--quiet']],
    [['build'], ['--parallel', '1', 'build', 'web', 'api']],
    [['up'], ['up', '-d', '--wait', '--wait-timeout', '120', 'web', 'api']],
    [['tailscale-up'], ['up', '-d', '--no-deps', 'tailscale']],
    [['stop'], ['stop']],
    [['down'], ['down']],
  ];
  for (const [args, expected] of commands) {
    writeFileSync(calls, '');
    const result = spawnSync('bash', [join(fixture, 'scripts/preview.sh'), ...args], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    const observed = readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
    for (const call of observed) {
      assert.equal(call.inherited, null);
      assert.deepEqual(call.args.slice(0, prefix.length), prefix);
    }
    assert.deepEqual(observed.at(-1).args, [...prefix, ...expected]);
  }
  const runtime = join(fixture, 'deploy/preview/runtime/serve.json');
  assert.deepEqual(JSON.parse(readFileSync(runtime, 'utf8')).AllowFunnel, {
    '${TS_CERT_DOMAIN}:443': false,
  });
  for (const args of [['config'], ['.env'], ['up', '-f', '/tmp/other.yaml'], ['down', '-v']]) {
    writeFileSync(calls, '');
    const result = spawnSync('bash', [join(fixture, 'scripts/preview.sh'), ...args], {
      cwd: tmpdir(),
      encoding: 'utf8',
      env,
    });
    assert.equal(result.status, 2);
    assert.equal(readFileSync(calls, 'utf8'), '', 'rechazar antes de invocar Docker');
  }
  mkdirSync(join(fixture, 'foreign/scripts'), { recursive: true });
  const relative = spawnSync('bash', ['scripts/preview.sh', 'check'], {
    cwd: fixture,
    encoding: 'utf8',
    env: { ...env, CDPATH: join(fixture, 'foreign') },
  });
  assert.equal(relative.status, 0, 'CDPATH no debe cambiar el worktree elegido');
  assert.equal(relative.stdout, '');

  const linkedPaths = [
    'deploy/preview/runtime',
    'deploy/preview/runtime/serve.json',
    'deploy/preview',
    'deploy',
    'deploy/preview/serve.json',
  ];
  for (const [index, path] of linkedPaths.entries()) {
    const link = join(fixture, path);
    const saved = join(fixture, 'saved-path');
    const target = join(fixture, 'foreign', `linked-target-${index}`);
    const isFile = path.endsWith('.json');
    if (!isFile) mkdirSync(target);
    renameSync(link, saved);
    symlinkSync(target, link);
    try {
      writeFileSync(calls, '');
      const result = spawnSync('bash', [join(fixture, 'scripts/preview.sh'), 'tailscale-up'], {
        cwd: tmpdir(),
        encoding: 'utf8',
        env,
      });
      assert.equal(result.status, 1, `rechazar el enlace ${path}`);
      assert.match(result.stderr, /enlaces simbólicos/);
      assert.equal(readFileSync(calls, 'utf8'), '', 'rechazar antes de invocar Docker');
      assert.equal(existsSync(isFile ? target : join(target, 'serve.json')), false);
    } finally {
      rmSync(link);
      renameSync(saved, link);
    }
  }
});
