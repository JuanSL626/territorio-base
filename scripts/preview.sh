#!/usr/bin/env bash
# Operaciones acotadas para la preview: sin secretos en salida ni flags libres.
set -euo pipefail

usage() {
  printf 'Uso: bash scripts/preview.sh [check|build|up|tailscale-up|ps|stop|down]\n' >&2
  exit 2
}

(( $# <= 1 )) || usage
action="${1:-ps}"
case "$action" in
  check) set -- config --quiet ;;
  build) set -- --parallel 1 build web api ;;
  up) set -- up -d --wait --wait-timeout 120 web api ;;
  tailscale-up) set -- up -d --no-deps tailscale ;;
  ps|stop|down) set -- "$action" ;;
  *) usage ;;
esac

CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ ! -f .env.preview || -L .env.preview ]]; then
  printf 'Falta el archivo privado regular .env.preview; no se usará .env.\n' >&2
  exit 1
fi
if [[ "$(stat -c '%a' .env.preview)" != 600 || "$(stat -c '%u' .env.preview)" != "$EUID" ]]; then
  printf '.env.preview debe pertenecer al usuario actual y tener permisos 600.\n' >&2
  exit 1
fi

if [[ "$action" == tailscale-up ]]; then
  # No seguir enlaces al copiar la plantilla o montar la configuración local.
  for path in deploy deploy/preview deploy/preview/serve.json \
    deploy/preview/runtime deploy/preview/runtime/serve.json; do
    if [[ -L "$path" ]]; then
      printf 'La configuración de preview no admite enlaces simbólicos.\n' >&2
      exit 1
    fi
  done
fi

# --env-file no gana a variables exportadas en el shell. No heredar valores de
# otro despliegue ni un daemon remoto. Usar el Docker rootless del usuario,
# sin depender del contexto activo ni de XDG_RUNTIME_DIR.
unset VITE_SUPABASE_URL VITE_SUPABASE_PUBLISHABLE_KEY WEB_PORT WEB_PUBLIC_URL
unset TERRITORIO_MAX_CONCURRENT_JOBS TERRITORIO_JOB_TTL_HOURS TERRITORIO_API_TOKEN
unset DOCKER_HOST DOCKER_CONTEXT COMPOSE_FILE COMPOSE_PROJECT_NAME COMPOSE_ENV_FILES COMPOSE_PROFILES
compose=(docker --host "unix:///run/user/${EUID}/docker.sock" compose -p territorio-base-preview
  --env-file .env.preview -f compose.yaml -f compose.preview.yaml)

# Un error de parseo de dotenv podría incluir valores: mostrar solo un aviso.
if ! "${compose[@]}" config --quiet >/dev/null 2>&1; then
  printf 'No se pudo validar la configuración privada. Revisarla localmente, sin compartir valores.\n' >&2
  exit 1
fi
[[ "$action" != check ]] || exit 0

if [[ "$action" == tailscale-up ]]; then
  # Solo contiene rutas, no claves. Mantener el JSON runtime fuera de Git y
  # conservar una publicación ya autorizada cuando se reinicie el contenedor.
  mkdir -p -m 755 deploy/preview/runtime
  if [[ ! -e deploy/preview/runtime/serve.json ]]; then
    install -m 644 deploy/preview/serve.json deploy/preview/runtime/serve.json
  fi
fi

exec "${compose[@]}" "$@"
