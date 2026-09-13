# Preview online no productiva

Este procedimiento usa `compose.yaml` más `compose.preview.yaml`; no sustituye
el despliegue base. Requiere Docker Compose con `!reset` y `!override`
(2.24.4 o posterior; resolución probada con 5.5.1), Bash, Node 24+ y pnpm.
Usa el Docker rootless del usuario mediante `unix:///run/user/<UID>/docker.sock`,
no el Docker del sistema ni un daemon remoto. No necesita `sudo` y no cambia
el contexto Docker de otras aplicaciones.

## Límites y preparación

- Proyecto Docker: `territorio-base-preview`. Imágenes web/API propias.
- Volúmenes: `territorio-base-preview_territorio-data` y
  `territorio-base-preview_tailscale-state`. Nunca montar los de producción.
- Sin puertos publicados del host; el servicio raster sigue siendo interno.
- Identidad Tailscale nueva: `territorio-base-preview`, en userspace, sin TUN,
  privilegios, capacidades adicionales, red del host ni Docker socket.
- No reutilizar ni publicar el hostname administrativo del servidor.
- `.env.preview` debe existir, ser un archivo regular del usuario actual con
  permisos 600 y estar excluido de Git. Cada creación/edición real requiere
  permiso específico. No copiar `.env` de otro entorno ni compartir secretos.
- Completar `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY` y `DATABASE_URL` para el proyecto autorizado.
  Usar la conexión Session pooler de Supabase (5432, TLS). Un restablecimiento
  requiere aprobación específica para un único cambio acotado y revisar su
  impacto en otras conexiones; no repetirlo como intento de diagnóstico.
- `WEB_PUBLIC_URL` debe corresponder al origen final aprobado. El wrapper evita
  que variables exportadas por otro despliegue reemplacen las de este archivo.
- Un solo trabajo raster concurrente. No se agregan cron jobs ni servicios de pago.

## Comprobaciones y arranque

Desde la raíz del worktree:

```bash
pnpm run test:preview
bash -n scripts/preview.sh
bash scripts/preview.sh check
bash scripts/preview.sh build
bash scripts/preview.sh up
bash scripts/preview.sh ps
```

`test:preview` resuelve el Compose real sin leer archivos de entorno y usa un
doble de Docker solo para verificar las órdenes del wrapper sin arrancar ni
borrar recursos. No prueba login, conexión a Supabase ni tráfico público.
`check` valida sintaxis, no comprueba que las claves funcionen o estén completas.
`build` compila las imágenes (BuildKit puede paralelizar etapas); `up` espera salud de web/API, sin activar
Tailscale. Comprobar después el esquema remoto en solo lectura: nada de
migraciones, resets, usuarios o análisis de prueba sin autorización específica.

No ejecutar `docker compose config` sin `--quiet` con credenciales reales.
Para inspeccionar la configuración estructural, usar la suite de pruebas.
El wrapper rechaza archivos de entorno alternativos, flags extra y `down -v`.
También ignora `CDPATH` para elegir el worktree y rechaza enlaces simbólicos
en las rutas de configuración de Tailscale antes de copiar o montar archivos.

## Autorización del túnel y publicación

1. Tras verificar la aplicación local dentro de la red Docker, ejecutar:

   ```bash
   bash scripts/preview.sh tailscale-up
   ```

   Esto inicializa `deploy/preview/runtime/serve.json` desde la plantilla
   privada, únicamente si no existe. La configuración operativa queda fuera
   de Git; el estado de autenticación vive en el volumen Tailscale separado.
   El directorio completo se monta en solo lectura para detectar cambios
   atómicos del JSON. La plantilla no contiene claves.
   `TS_BOOT_TIMEOUT=30m` da una ventana acotada para el login interactivo;
   el límite predeterminado de 60 segundos puede reiniciar el contenedor y
   cambiar el enlace mientras se autoriza. Si vence la ventana, detener solo
   este nodo y obtener su enlace vigente, sin borrar el volumen ni rotar claves.
2. Autorizar únicamente la identidad nueva mediante su enlace de login de
   Tailscale. No es necesario copiar una auth key al contenedor web. Comprobar
   el nombre DNS real que asignó Tailscale; no inventar la URL ni sustituirla
   por la del servidor administrativo. Revisar si la tailnet permite HTTPS y
   Funnel para este nodo. Cualquier cambio de política requiere mostrar y
   autorizar el diff exacto, sin ampliar acceso a otros nodos.
   La confirmación del navegador no basta: verificar `BackendState=Running`,
   el nombre DNS del nodo y que no haya reinicios antes de continuar.
3. Revisar Supabase Auth para ese origen. Proponer y autorizar por separado el
   diff exacto de Site URL, redirects, proveedores o plantillas antes de
   guardarlo. Preservar redirects existentes y mantener el registro abierto
   (`disable_signup=false`), sin añadir una pantalla de registro en este alcance.
   No enviar invitaciones ni crear usuarios sin permiso.
4. Validar login con una cuenta autorizada, mapa, análisis pequeño y descarga.
   El análisis de prueba escribe datos: requiere su permiso específico.
5. Solo después de esas validaciones y de la autorización de publicación,
   cambiar a `true` el valor de `AllowFunnel` en el JSON de runtime, conservando
   `${TS_CERT_DOMAIN}:443` y el proxy exclusivo a `http://web:3000`.
   No cambiar la plantilla versionada `deploy/preview/serve.json`, que debe
   permanecer privada por defecto. Comprobar la configuración efectiva del
   contenedor Tailscale tras el cambio, no solo el contenido del archivo.
6. Abrir la URL HTTPS exacta desde un cliente sin tailnet: pantalla de acceso,
   rutas privadas denegadas sin sesión y ninguna ruta administrativa expuesta.
   Probar parada/arranque de estos contenedores y recuperación de la misma URL.
   No declarar la preview lista antes de completar estas pruebas reales.

La salud de Tailscale solo indica que tiene una IP de tailnet; no acredita la
salud de la aplicación ni que Funnel sea accesible desde internet.

## Parada, reversión y persistencia

```bash
bash scripts/preview.sh stop
# Retirar también contenedores/red de la preview, conservando ambos volúmenes:
bash scripts/preview.sh down
# Recuperar el entorno, incluida una configuración de Funnel ya autorizada:
bash scripts/preview.sh up
bash scripts/preview.sh tailscale-up
```

Para retirar solo el acceso público, devolver `AllowFunnel` a `false` en el
JSON de runtime y verificar la denegación desde fuera. Si no se puede verificar,
parar la preview. No tocar el Tailscale administrativo ni borrar volúmenes.
`restart: unless-stopped` recupera contenedores después de reiniciar Docker;
una parada explícita requiere el arranque manual anterior. No garantiza uptime.

## Exportación de seguridad local (solo con autorización)

Los volúmenes no contienen la base de datos remota de Supabase. El estado de
Tailscale sí contiene material de autenticación: tratar su exportación como
secreto. Con los contenedores de preview detenidos y las imágenes ya construidas,
la siguiente receta exporta solo esos volúmenes, sin red, en archivos privados:

```bash
umask 077
backup_dir=$(mktemp -d "$HOME/territorio-preview-backup.XXXXXX")
for volume in territorio-base-preview_territorio-data territorio-base-preview_tailscale-state; do
  docker --host "unix:///run/user/$(id -u)/docker.sock" volume inspect "$volume" >/dev/null || exit 1
  docker --host "unix:///run/user/$(id -u)/docker.sock" run --rm --network none --user 0:0 \
    --mount "type=volume,source=$volume,target=/data,readonly" \
    --entrypoint tar territorio-base-preview/api:local \
    -C /data -czf - . > "$backup_dir/$volume.tar.gz" || exit 1
  tar -tzf "$backup_dir/$volume.tar.gz" >/dev/null || exit 1
done
```

No subir esas exportaciones a Git ni a un destino externo sin permiso. Un
respaldo de Supabase y una restauración requieren su propio procedimiento y
verificación; no se hacen automáticamente aquí. Si se revierte una versión de
la aplicación, mantener estos volúmenes y volver a construir en el worktree de
preview la revisión aprobada, sin cambiar producción ni el esquema remoto.

Referencia de parámetros y montaje de directorio:
https://tailscale.com/docs/features/containers/docker/docker-params

Tiempo de arranque de la imagen fijada (Tailscale 1.102.3):
https://github.com/tailscale/tailscale/blob/v1.102.3/cmd/containerboot/settings.go

Funnel y los planes gratuitos tienen límites de uso y disponibilidad; el
servidor debe permanecer encendido y conectado. Esta configuración no es una
promesa de disponibilidad ni un despliegue de producción.
