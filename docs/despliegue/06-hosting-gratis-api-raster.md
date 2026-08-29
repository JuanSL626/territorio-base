# 06 — Hosting gratis para `services/api` (el raster Python)

Investigación de despliegue gratuito para el servicio raster. **No toca el repo.**
Todos los números están verificados contra documentación oficial o búsquedas de
agosto 2026 — se cita la fuente en cada afirmación. Donde la fuente no daba un
número exacto, se marca explícitamente como no confirmado.

`apps/web` (TanStack Start/Node, sin disco, SSR) es un problema mucho más fácil
y no es el foco de este memo — la mayoría de las plataformas evaluadas aquí lo
sirven sin drama porque no carga GDAL ni necesita disco.

## 0. Qué exige realmente `services/api`

Leído el código, no asumido:

- **Un solo worker uvicorn a propósito** (`Dockerfile`: `--workers 1`). El
  `JobStore` (`src/territorio_base_api/jobs.py`) vive como diccionario en
  memoria de proceso. Cualquier plataforma que levante **más de una instancia
  en paralelo** del contenedor (autoscaling horizontal sin fijar máx=1) rompe
  la consistencia del estado de jobs — no es un detalle solo de Fly/Cloud Run,
  aplica a cualquiera de las opciones evaluadas.
- **`/data` tiene dos usos, con impacto MUY distinto si se pierde:**
  - `analyses/<job_id>/…` (`config.py: analyses_dir`) — GeoTIFF y JSON de cada
    job, con **TTL de 72 h** (`TERRITORIO_JOB_TTL_HOURS`) purgado al arrancar
    (`jobs.py`). Si el disco es efímero y el contenedor se reinicia, se
    pierden los resultados que el usuario todavía no descargó — **esto sí
    rompe la UX**, no es cosmético: un análisis de 10-90 s recién terminado
    puede desaparecer antes de que el usuario le dé "descargar GeoTIFF".
  - `coastal/<cache_key>/…` (`config.py: coastal_dir`, `main.py:
    _coastal_dir`) — caché de Aqueduct keyed por (AOI, preset). Perder esto
    en un reinicio **no rompe nada**, solo fuerza recomputar (golpe de
    performance, no de correctitud).
  - Conclusión: disco persistente no es opcional para una buena experiencia,
    pero la app *sobrevive* sin él siempre que el contenedor no se reinicie
    en medio de una sesión activa de usuario. En una plataforma que duerme
    por inactividad y despierta con disco limpio, cada ciclo de sueño borra
    los análisis pendientes de descarga.
- **Imagen 900 MB**, base Debian (glibc) — el comentario del Dockerfile lo
  deja explícito: nada de Alpine/musl sin compilar GDAL a mano.

---

## 1. Tabla comparativa

| Plataforma | RAM/CPU free | Límite imagen | ¿Duerme? | Disco persistente free | Timeout / SSE | Egress free | Tarjeta | Veredicto |
|---|---|---|---|---|---|---|---|---|
| **Fly.io** | — | — | — | — | — | — | — | **No hay free tier.** Retirado oct-2024; solo trial de 2 h VM o 7 días. Cuentas "Hobby" viejas conservan hasta 3 GB de volumen, pero eso no es una opción para un despliegue nuevo hoy. [saaspricepulse](https://www.saaspricepulse.com/blog/flyio-free-tier-2026) |
| **Render** | 512 MB / 0.1 CPU | No publicado explícito | Sí, a los 15 min de inactividad, ~1 min para despertar | **No** — disco solo en planes pagos ($0.25/GB/mes) | 100 min de request, sí soporta SSE | **5 GB/mes** (recortado de 100 GB en abr-2026) | No para el free tier | 512 MB descalifica (el propio README del servicio anticipa OOM), sin disco free, y encima el ciclo de sueño borra `/data` en cada wake — combinación letal. [Render docs](https://render.com/docs/free) · [srvrlss](https://www.srvrlss.io/provider/render/) · [bex.co (egress cut)](https://bex.co/blog/2026/08/21/renders-1-5b-valuation-metered-egress-bill) |
| **Railway** | — | — | — | — | — | — | No para el trial | Ya no tiene free tier permanente: $5 de crédito único, se agota en días/semanas corriendo 24/7, y a los 30 días los contenedores se detienen. No sirve como base estable. [kuberns](https://kuberns.com/blogs/railway-free-tier/) |
| **Koyeb** | 512 MB / 0.1 vCPU | **2 GB de SSD total** (imagen + runtime) | Sí, a la hora de inactividad, sin poder desactivarlo en free | **No** — volúmenes no disponibles en el free tier | No confirmado en docs públicas | No confirmado | A veces (si no puede verificar humano automáticamente) | 512 MB descalifica igual que Render; y 2 GB de SSD total para una imagen de 900 MB deja casi nada de margen para el propio runtime + caché. [koyeb docs](https://www.koyeb.com/docs/reference/instances) |
| **Hugging Face Spaces** | 16 GB / 2 vCPU en CPU Basic… | — | Sleep a las 48 h en free | 50 GB efímero (no persistente); persistente desde $5/mes | No confirmado | No confirmado | No para crear el Space | **…pero un Space Docker (el único SDK que sirve para un backend FastAPI a medida) requiere plan PRO para crearse.** El CPU Basic gratis es real, pero no para Docker — es la trampa de esta opción. [HF forums](https://discuss.huggingface.co/t/can-hugging-face-pro-run-a-docker-space-on-the-free-cpu-basic-tier/177957) |
| **Google Cloud Run** | Hasta 32 GiB configurables, pagás por uso real dentro de 180.000 vCPU-s + 360.000 GiB-s/mes gratis | Sin límite duro (capas ≤ 9.9 GB) | Escala a 0 por defecto (no es "dormir" con wake lento — cada instancia fría es nueva, arranque típico de pocos segundos, no 30-60 s) | **No nativo.** `/data` no persiste entre instancias. Se puede montar un bucket GCS vía `gcsfuse` (GA) — funciona pero agrega latencia de red a cada escritura de GeoTIFF | Hasta 60 min, streaming/SSE en GA | Solo **1 GiB/mes** a Norteamérica dentro de siempre-gratis | **Sí, obligatoria** (cuenta de facturación) aunque no cobre dentro de cuota | Técnicamente el más capaz (RAM, timeout, sin límite de imagen), pero exige reescribir el manejo de `/data` para usar GCS en vez de disco local, y el egress gratis (1 GiB) se agota rápido si se sirven GeoTIFF de varios MB directo a usuarios. [Cloud Run pricing](https://cloud.google.com/run/pricing) · [cloudchipr](https://cloudchipr.com/blog/cloud-run-pricing) |
| **Oracle Cloud Always Free (Ampere A1)** | **2 OCPU / 12 GB RAM** (VM completa, no contenedor gestionado) | N/A — es una VM, corrés Docker vos mismo, sin límite de imagen más allá del disco | **No duerme** — es una VM siempre encendida | **200 GB** de block storage (boot + volúmenes), tuyo, real, POSIX | N/A — vos controlás nginx/uvicorn, sin timeout de plataforma; SSE funciona nativo | **10 TB/mes** | Sí, tarjeta de crédito real (no prepago/débito con PIN) para verificación | Ver sección 3 — es la única opción que da cómputo + disco + sin-sleep genuinamente gratis, con trampas operativas, no técnicas. [Oracle docs oficiales](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm) |
| **Scaleway Serverless Containers** | Free: 2M requests, 500.000 seg-core, 500.000 GB-s/mes | Recomendado <1 GB (900 MB entra justo) | Escala a 0 (serverless) | **No** — almacenamiento efímero, sin volumen persistente en este producto | No confirmado el máximo exacto; documentación no fue accesible en esta pasada | Ingress/egress incluidos en el free tier | No confirmado | Candidato honesto para *cómputo*, pero sin disco — habría que externalizar `/data` a Object Storage (cambio de código), igual que Cloud Run. [Scaleway](https://www.scaleway.com/en/serverless-containers/) |
| **Northflank** | No publica techo por servicio; documentación orienta a 0.1–1 vCPU / ~512 MB en el plan Sandbox | No confirmado | **No** — Sandbox es "always-on, no sleeping" | Sí soporta volúmenes, pero no confirmado si el plan Sandbox gratis los incluye sin costo | No confirmado | No confirmado | **Sí, obligatoria** desde el signup, incluso para el plan gratis | Interesante por "no duerme", pero exige tarjeta de entrada y el techo de RAM real para el free tier no está publicado — no se puede confiar en él sin probarlo primero. [Northflank docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank) |
| **Zeabur** | **512 MB RAM / 1 vCPU**, 1 GB de disco | Con 1 GB de disco total, una imagen de 900 MB no deja margen de trabajo | Sí, duerme por inactividad, wake de pocos segundos | Sí soporta volúmenes, pero el disco total del free tier (1 GB) ya está copado por la imagen | No confirmado | No confirmado | No para el free plan | Mismo problema de fondo que Koyeb/Render: RAM y disco insuficientes para una imagen GDAL de 900 MB. [Zeabur docs](https://zeabur.com/docs/en-US/pricing/free-plan) |
| **Deta / Space** | — | — | — | — | — | — | — | **Discontinuado.** Deta Space cerró el 17-oct-2024. No es una opción hoy. [HN](https://news.ycombinator.com/item?id=41426388) |
| **PythonAnywhere** | — | — | — | — | — | — | — | **Descalificado de raíz**: no soporta contenedores Docker propios en ningún plan, gratis o pago — el staff lo confirmó explícitamente como algo que no van a soportar. [PA forums](https://www.pythonanywhere.com/forums/topic/4019/) |
| **Replit** | 512 MB / 0.5 vCPU en free | No es el modelo de despliegue principal (Nix, no Docker crudo) | Duerme a los 5 min | No confirmado como persistente en free | No confirmado | No confirmado | No para el free tier | "Always On" (necesario para no dormir) es exclusivo de Replit Core, **$20/mes** — no hay forma gratis de mantenerlo despierto. Descalificado. [p0stman](https://p0stman.com/guides/replit-limitations) |

---

## 2. Por qué el "duerme + cold start" es más grave acá que en un CRUD típico

El análisis tarda **10-90 s** y el usuario está esperando una barra de progreso
por SSE. Si el contenedor estaba dormido:

- Con Render/Koyeb/Zeabur (~1 min de wake): la primera request del usuario ya
  se come 60 s **antes** de que arranque el análisis de 90 s → una espera de
  hasta 2.5 minutos percibida como "se colgó".
- Con Cloud Run (arranque en frío de pocos segundos, no minutos, porque no es
  un "sueño" sino una instancia nueva por request): el golpe es mucho menor,
  pero sigue sumando a cada primera request tras inactividad.
- Con Oracle (VM siempre encendida): cero cold start — el único caso en la
  lista donde el análisis de 90 s es lo único que el usuario espera.

## 3. Oracle Cloud Always Free — la opción que merece la lupa

**Sigue vigente en agosto 2026, verificado contra la página oficial de
Oracle** (no un blog): [Always Free
Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm).

- **Shape `VM.Standard.A1.Flex`: 2 OCPU + 12 GB RAM totales por cuenta**, no
  4/24 — hay muchísimos artículos de 2023-2025 (y algún blog "2026" con fecha
  falsa) que todavía citan 4 OCPU/24 GB; Oracle recortó ese cupo el
  15-jun-2026 según un hilo de su propio foro de la comunidad. **Usá el link
  de arriba, no un blog, para confirmar el número el día del signup** — puede
  volver a cambiar.
- 2 OCPU / 12 GB alcanza sobrado para el patrón descrito (arrays float32 de
  ~1000×1000 px, varios en vuelo, 6 escenas Sentinel-2 mosaicadas).
- **200 GB de block storage gratis** — disco real, montado en la VM, no un
  volumen "best effort": ahí vive `/data` sin ningún compromiso.
- **10 TB/mes de egress** — sin comparación con el 1 GiB de Cloud Run o los
  5 GB de Render.
- No es un PaaS: es una VM Ubuntu/Oracle Linux donde vos instalás Docker y
  corrés `docker compose up` con el mismo `Dockerfile` del repo. Sin límite
  de tamaño de imagen impuesto por la plataforma (solo el disco de 200 GB).

### La trampa real no es técnica, es operativa — tres cosas a vigilar

1. **Wheels ARM64: verificado, SÍ existen — no hay que compilar nada.**
   Se comprobó contra PyPI (no de memoria) para las versiones exactas
   fijadas en `services/api/uv.lock`:
   - `rasterio==1.4.4` → `manylinux_2_28_aarch64` ✅
   - `pyproj==3.7.2` → `manylinux_2_28_aarch64` ✅
   - `shapely==2.1.2` → `manylinux2014_aarch64` ✅

   Búsquedas web genéricas dicen lo contrario ("rasterio no tiene wheels
   ARM64"), pero eso describe versiones viejas — con el lockfile actual del
   repo, un `docker build --platform linux/arm64` (o build nativo en la VM
   Ampere, que ya es ARM) resuelve todo por wheel, sin compilar GDAL a mano.
   Esto tira abajo la premisa "puede haber que compilar" del enunciado: no
   hace falta, con las versiones que el repo ya fija.
2. **Reclamo por inactividad.** Oracle reclama instancias Always Free si
   durante 7 días seguidos CPU, red y memoria están **todas** por debajo del
   20% (documentado oficialmente). Un demo territorial de uso esporádico
   (no 24/7 con tráfico real) puede calificar como "idle" y ser detenido —
   mitigable con un heartbeat liviano (cron pegándole a `/healthz` cada
   tanto) o aceptando el riesgo y reiniciando si pasa.
3. **Tarjeta de crédito real y capacidad regional.** Pide tarjeta de crédito
   (no débito con PIN, no prepago) para verificación — no cobra mientras te
   mantengas dentro de Always Free, pero si la región elegida en el signup
   no tiene capacidad Ampere A1 disponible (pasa seguido en regiones
   populares), hay que crear la cuenta en otra región o reintentar. Una
   cuenta por persona; abandonarla 30+ días la vuelve candidata a
   suspensión.

## 4. Lo que NO sirve y por qué (resumen honesto)

- **Fly.io, Railway, Deta/Space**: no tienen free tier hoy, punto — no es un
  problema de límites técnicos, ya no existe la opción gratis.
- **Render, Koyeb, Zeabur, Replit**: 512 MB de RAM es insuficiente para el
  patrón de memoria descrito (arrays float32 de banda completa, varios en
  vuelo) — el propio contexto del proyecto lo anticipa ("con 512 MB
  probablemente muera"), y ninguno de estos cuatro ofrece más RAM gratis.
  Sumale que ninguno da disco persistente gratis, y en Koyeb/Zeabur el disco
  total (2 GB / 1 GB) ni siquiera alcanza para la imagen de 900 MB con
  margen operativo.
- **Hugging Face Spaces**: el CPU Basic gratis es real, pero **no para
  Docker** — crear un Space Docker (el único SDK viable para un backend
  FastAPI hecho a medida) exige plan PRO. Es una trampa de naming: "free
  tier" existe, pero no cubre el tipo de Space que este servicio necesita.
- **PythonAnywhere**: fuera de discusión, no soporta Docker en ningún plan.

## 5. Ranking final — top 3 para ESTE servicio

### 1º — Oracle Cloud Always Free (Ampere A1, VM.Standard.A1.Flex)
**Por qué gana:** es la única opción de la lista que da simultáneamente RAM
suficiente (12 GB), disco persistente real (200 GB, sin condicionamiento),
cero cold start (VM siempre encendida) y egress generoso (10 TB), todo sin
costo mientras se mantenga dentro del cupo. Los wheels ARM64 para
rasterio/pyproj/shapely están confirmados en el lockfile actual del repo, así
que no hay que tocar una línea de `services/api` para que corra — solo el
Dockerfile necesita construirse para `linux/arm64` (o construirse nativo en
la VM).
**Qué se pierde:** control tipo PaaS (no hay deploy por git push, hay que
mantener la VM vos mismo — parchear el SO, renovar certificados si servís
HTTPS directo, configurar el firewall); riesgo de reclamo por inactividad si
el uso es muy esporádico; depende de que haya capacidad Ampere A1 en la
región elegida al momento del signup.

### 2º — Google Cloud Run
**Por qué entra:** es la opción "PaaS de verdad" más capaz técnicamente —
memoria configurable hasta 32 GiB dentro de la cuota gratis, timeout de 60
min con SSE en GA, sin límite de tamaño de imagen. El cold start es de
segundos, no de un minuto, porque no es "dormir y despertar" sino instancias
nuevas bajo demanda.
**Qué se pierde:** no hay disco persistente nativo — mantener el
comportamiento actual de `/data` exige reescribir el guardado de GeoTIFF y
la caché de Aqueduct para usar un bucket GCS montado por `gcsfuse` (cambio
de código, no solo de infraestructura), lo cual añade latencia de red a cada
escritura/lectura. Además el egress gratis (1 GiB/mes) es minúsculo si se
sirven GeoTIFF pesados directo a usuarios finales, y GCP exige tarjeta de
crédito en la cuenta de facturación desde el signup.

### 3º — Scaleway Serverless Containers
**Por qué entra, con reservas:** cupo gratis mensual (2M requests, 500.000
seg-core, 500.000 GB-s) razonable para uso esporádico, escala a cero sin
cargo, e imagen de 900 MB entra dentro de lo recomendado (<1 GB). Egress
incluido en el free tier, a diferencia de Cloud Run.
**Qué se pierde:** mismo problema estructural que Cloud Run — sin volumen
persistente en el producto, `/data` necesitaría migrar a Object Storage
(cambio de código). Además varios números clave (timeout exacto, memoria
máxima por contenedor, comportamiento post-cuota) no se pudieron confirmar
contra la documentación oficial en esta pasada — antes de comprometerse hay
que leer `containers-limitations` directo en el sitio de Scaleway, la
búsqueda automatizada no devolvió el contenido completo de esa página.

## 6. Conclusión honesta

Gratis **sí alcanza** para este servicio, pero solo con Oracle Cloud Always
Free — y ahí "gratis" significa administrar una VM real, no un `git push`
a un PaaS. Si lo que se quiere es una experiencia tipo PaaS (deploy
automático, sin mantener SO), la respuesta honesta es que ningún free tier
de PaaS cubre simultáneamente RAM + disco persistente + sin-sleep para una
imagen de 900 MB con GDAL — Cloud Run es lo más cerca, pero a costa de
reescribir el manejo de `/data` para usar object storage.

Si en algún punto se prefiere no mantener una VM y sí pagar algo mínimo, el
escalón pago más barato que sí resuelve RAM + disco + sin-sleep sin tocar
código es **Render Starter (con disco agregado): US$7/mes de compute + 900
MB de disco a US$0.25/GB/mes ≈ US$0.25/mes de disco → ~US$7.25/mes total**
([Render pricing](https://render.com/pricing) — verificar el número exacto
de compute al momento de decidir, no se confirmó el precio de Starter en
esta pasada, solo el de disco).

---

### Fuentes citadas
- Render: [docs.render.com/free](https://render.com/docs/free), [srvrlss.io](https://www.srvrlss.io/provider/render/), [egress cut abr-2026](https://bex.co/blog/2026/08/21/renders-1-5b-valuation-metered-egress-bill)
- Railway: [kuberns.com](https://kuberns.com/blogs/railway-free-tier/)
- Koyeb: [koyeb.com/docs/reference/instances](https://www.koyeb.com/docs/reference/instances)
- Hugging Face Spaces: [discuss.huggingface.co](https://discuss.huggingface.co/t/can-hugging-face-pro-run-a-docker-space-on-the-free-cpu-basic-tier/177957), [docs Docker Spaces](https://huggingface.co/docs/hub/en/spaces-sdks-docker)
- Google Cloud Run: [cloud.google.com/run/pricing](https://cloud.google.com/run/pricing), [cloudchipr.com](https://cloudchipr.com/blog/cloud-run-pricing)
- Oracle Cloud Always Free: [docs.oracle.com — Always Free Resources (oficial)](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [reclamo de idle — HN](https://news.ycombinator.com/item?id=34680826), [recorte a 2 OCPU/12GB — foro Oracle](https://community.oracle.com/customerconnect/discussion/970310/oci-always-free-updated-ampere-a1-compute-allocation)
- Scaleway: [scaleway.com/en/serverless-containers](https://www.scaleway.com/en/serverless-containers/)
- Northflank: [northflank.com/docs](https://northflank.com/docs/v1/application/billing/pricing-on-northflank)
- Zeabur: [zeabur.com/docs — free plan](https://zeabur.com/docs/en-US/pricing/free-plan)
- Fly.io: [saaspricepulse.com](https://www.saaspricepulse.com/blog/flyio-free-tier-2026)
- Deta/Space: [Hacker News — shutdown](https://news.ycombinator.com/item?id=41426388)
- PythonAnywhere: [pythonanywhere.com/forums](https://www.pythonanywhere.com/forums/topic/4019/)
- Replit: [p0stman.com](https://p0stman.com/guides/replit-limitations)
- Wheels ARM64 (rasterio/pyproj/shapely): verificado directo contra PyPI JSON API para las versiones fijadas en `services/api/uv.lock` (rasterio 1.4.4, pyproj 3.7.2, shapely 2.1.2), no contra búsqueda genérica.
