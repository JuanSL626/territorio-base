# 07 — AWS a fondo para `territorio-base`

Fecha: 2026-08-29. Ángulo de este informe: evaluar cada servicio de AWS que podría
hostear `services/api` (raster Python) y `apps/web` (TanStack Start/Node SSR), con
números verificados contra documentación y precios oficiales de agosto 2026. Los
informes `02-web-frontend-y-combo.md` y `06-hosting-gratis-api-raster.md` cubren el
resto del panorama (Render, Koyeb, Railway, Fly.io, Oracle, Vercel, Cloudflare); este
memo no repite esos hallazgos, solo cierra con la comparación final contra Oracle
Always Free.

**No toca el repo.**

---

## 0. Resumen ejecutivo

- **AWS reformó su free tier el 15-jul-2025.** Cuentas nuevas ya NO reciben 750 h/mes
  de EC2 gratis por 12 meses — reciben **US$100 de crédito al registrarse, hasta
  US$200 completando actividades, y el plan gratuito expira a los 6 meses o cuando
  se acaban los créditos, lo que ocurra primero.** Las cuentas creadas *antes* del
  15-jul-2025 conservan el esquema legado (12 meses, 750 h). Esto es la variable que
  más condiciona todo lo demás en este informe — **confirmá la fecha de creación de
  la cuenta antes de planificar sobre EC2.**
- **EC2/Lightsail/Elastic Beanstalk no sirven de base**, tenga o no la cuenta el
  esquema legado: 1 GB de RAM en t2.micro/t3.micro es dudoso para el pipeline raster
  solo, y el free tier cubre **una sola instancia** — no alcanza para correr la API
  y la web gratis a la vez sin repartir 1 GB entre ambas.
- **Lambda es el único servicio de cómputo de AWS con free tier realmente permanente**
  (1M requests + 400.000 GB-segundos + 100 GB de streaming, cada mes, para siempre,
  sin importar antigüedad de cuenta). Memoria configurable hasta 10 GB — mucho más
  holgado que el 1 GB de EC2 para los arrays float32. Imagen de contenedor hasta
  10 GB — los 900 MB del Dockerfile actual entran con margen. Pero **exige reescribir
  la arquitectura de jobs**: el `JobStore` en memoria de un solo proceso no sobrevive
  a un modelo de ejecución sin estado y potencialmente concurrente. No es "desplegar
  y listo".
- **App Runner y ECS Fargate no tienen free tier** — arrancan cobrando desde el primer
  minuto (~US$14-36/mes en la config mínima viable). No compiten con las opciones
  gratuitas de otros informes.
- **S3 tiene free tier de 12 meses (no permanente); CloudFront tiene free tier
  permanente** (1 TB egress + 10M requests/mes, para siempre). Vale la pena sacar los
  GeoTIFF/PNG de `/data` hacia S3+CloudFront **independientemente** de qué cómputo se
  elija.
- **Sí hay copias de Sentinel-2, Copernicus DEM y WorldCover en AWS Open Data**, y esto
  sí pesa: Sentinel-2 (el dataset más pesado, 6 escenas por análisis) vive en
  `us-west-2`, gratis y sin requester-pays. Copernicus DEM y WorldCover viven en
  `eu-central-1` — correr en `us-west-2` te acerca al dataset más voluminoso pero deja
  los otros dos a un salto de región.
- **Conclusión**: la mejor combinación en AWS (Lambda + DynamoDB + S3 + CloudFront,
  todo en `us-west-2`) puede terminar costando **US$0/mes de forma permanente** a
  escala hobby, pero exige una reescritura real del servicio de jobs. **Oracle Always
  Free exige cero reescritura** (proceso único persistente, 12 GB RAM, 200 GB disco) y
  sigue siendo la opción de menor esfuerzo. AWS gana en "gratis para siempre sin
  depender de que Oracle no te reclame la instancia", pierde en "correlativo directo
  con el código que ya existe".

---

## 1. El giro de 2025-2026 en el AWS Free Tier

Verificado contra el [anuncio oficial de AWS](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/)
del 16-jul-2025 y los [AWS Free Tier Terms](https://aws.amazon.com/free/terms) vigentes:

- Desde el **15-jul-2025**, las cuentas nuevas eligen entre **Free account plan** o
  **Paid account plan**. Ambas arrancan con **US$100 en créditos** al registrarse, y
  pueden ganar **hasta US$100 adicionales** completando actividades guiadas (usar EC2,
  Bedrock, etc.) — tope de US$200.
- El **Free account plan expira a los 6 meses desde la creación de la cuenta, o cuando
  se agotan los créditos**, lo que ocurra primero. Los créditos en sí expiran a los 12
  meses. Pasado el vencimiento hay 90 días para pasar a Paid plan antes de que AWS
  cierre la cuenta y borre los recursos.
- Separado de esto, **más de 30 servicios siguen teniendo una franja "Always Free"**
  permanente con límites mensuales — Lambda y CloudFront son los dos que importan acá
  (§3 y §5).
- **Cuentas creadas antes del 15-jul-2025 conservan el esquema legado sin cambios**:
  750 h/mes de EC2 t2.micro/t3.micro, 5 GB de S3, 5 GB de EFS, etc., válidos durante
  los primeros 12 meses de la cuenta — no 12 meses desde ahora, 12 meses desde que se
  creó la cuenta.

Fuentes: [aws.amazon.com/about-aws/whats-new/2025/07/...](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/) ·
[aws.amazon.com/free/terms](https://aws.amazon.com/free/terms) ·
[docs.aws.amazon.com/.../free-tier.html](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html)

**Implicación práctica**: cualquier plan que dependa de "12 meses gratis de EC2/S3/EFS"
solo es válido si la cuenta de AWS del proyecto ya existía antes de julio de 2025. Si
se va a abrir una cuenta nueva para este despliegue, esa ventana ya no existe — lo que
queda es el crédito de 6 meses (que se agota corriendo servicios pagos) y la franja
Always Free permanente de un puñado de servicios.

---

## 2. EC2, Elastic Beanstalk, Lightsail — por qué no alcanzan

### EC2 t2.micro / t3.micro

- **RAM: 1 GB**, 1 vCPU (t2) o 2 vCPU compartidas (t3). El propio brief del proyecto ya
  lo anticipa: "con 512 MB se muere; 1 GB es dudoso". El pipeline mosaica 6 escenas
  Sentinel-2 y mantiene varios arrays float32 de ~1000×1000 px en vuelo simultáneamente
  (NDVI, pendiente, WorldCover) más el runtime de rasterio/GDAL (que ya consume
  decenas de MB solo en cargar). 1 GB da margen pero sin colchón: un pico de
  concurrencia (dos análisis solapados, aunque el servicio use un solo worker) o un
  AOI más grande de lo típico puede tirar el proceso por OOM. No hay swap por defecto
  en una instancia free tier — habría que crear un swapfile en el EBS a mano, lo que
  ayuda pero no lo vuelve seguro (con memoria float32 que crece con el AOI, un swap en
  disco de red degradaría el rendimiento de 10-90 s a algo mucho peor bajo presión).
- **El free tier cubre 750 horas/mes en total**, no 750 por instancia — alcanza para
  **una sola instancia corriendo 24/7**, no dos. `apps/web` (SSR siempre encendido) y
  `services/api` (el raster) no caben ambas gratis al mismo tiempo salvo que compartan
  la misma instancia de 1 GB — lo cual empeora el problema de memoria del punto
  anterior, porque ahora Node y el proceso de uvicorn compiten por esa misma RAM.
- Aplica solo a **cuentas legado (pre-15-jul-2025)**, y solo por 12 meses desde que esa
  cuenta se creó — no es un colchón indefinido.
- **Veredicto: no sirve de base**, ni para una pieza ni para el par. RAM insuficiente
  con margen cero, y el free tier no cubre ambos procesos aunque la cuenta sea legado.

### Elastic Beanstalk

Elastic Beanstalk no cobra nada por sí mismo — es una capa de orquestación sobre
EC2/S3/RDS, así que hereda exactamente las mismas limitaciones de RAM y de free tier
de EC2 de arriba (un t2.micro por 12 meses en cuentas legado). No resuelve nada que EC2
puro no resuelva; agrega complejidad de despliegue sin agregar recursos.
[Referencia](https://www.pump.co/blog/aws-elastic-beanstalk/).

### Lightsail

El free trial corto de Lightsail (90 días sobre planes de US$5-12/mes) **fue retirado
para clientes nuevos** — Lightsail hoy se financia con el mismo crédito general de
hasta US$200/6 meses del punto 1, no con un trial propio. Ya sea legado o nuevo, no hay
ninguna instancia de Lightsail que sea gratis *de forma permanente*.
[repost.aws](https://repost.aws/questions/QUgWKsPw-aSZqMUHFFvPS3kg/lightsail-free-tier-specifications-3-months-90-days).

**Veredicto de la sección: ningún cómputo "instancia siempre encendida" de AWS es
gratis de forma permanente hoy.** Esto descarta de raíz la opción más parecida
arquitectónicamente al código actual (proceso único, disco local, sin reescritura).

---

## 3. AWS Lambda — el candidato real, con letra chica

### Lo que sí es gratis para siempre

Confirmado contra la [página oficial de Lambda pricing](https://aws.amazon.com/lambda/pricing/)
y múltiples fuentes cruzadas: **1.000.000 de requests/mes + 400.000 GB-segundos de
cómputo/mes + 100 GB de datos de response streaming/mes**, repartidos entre todas las
funciones de la cuenta, en x86 y Graviton2/ARM. A diferencia del free tier de 12 meses,
**este no expira nunca y no depende de la fecha de creación de la cuenta** — es Always
Free tanto en el plan gratuito como en el de pago.

Cálculo de escala: un análisis típico de 60 s a 3 GB de memoria configurada consume
180 GB-segundos. Los 400.000 GB-segundos gratis alcanzan para **~2.200 análisis/mes**
antes de empezar a pagar — muy por encima del tráfico esperable de una herramienta de
análisis territorial de uso ocasional.

### Límites técnicos relevantes

- **Imagen de contenedor: hasta 10 GiB descomprimidos** (todas las capas incluidas).
  Los 900 MB actuales entran con mucho margen.
  [docs.aws.amazon.com/lambda/.../images-create.html](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- **Timeout máximo: 15 minutos** — cubre sobrado la ventana de 10-90 s del análisis.
- **Memoria configurable hasta 10.240 MB** (10 GB) en incrementos de 1 MB, con la CPU
  escalando junto con la memoria. Esto es objetivamente mejor que el 1 GB dudoso de
  EC2 free tier para el mismo pipeline — se le puede dar 3-4 GB al análisis sin pensar
  dos veces, dentro del free tier si el volumen de jobs es bajo.
- **`/tmp` (ephemeral storage): 512 MB gratis, configurable hasta 10 GB** (a
  US$0,0000000309 por GB-segundo el exceso). Es efímero por diseño — se borra entre
  invocaciones "frías" — así que no reemplaza a `/data` para nada que deba sobrevivir
  más allá de una sola invocación; sirve como scratch de trabajo durante el análisis
  (lectura de ventanas COG, mosaico intermedio) pero el resultado final tiene que salir
  hacia S3 antes de que la invocación termine.
- **SSE / streaming: sí, pero no "gratis" en el sentido de zero-effort.** Las Function
  URLs soportan un `InvokeMode: RESPONSE_STREAM` (contra `BUFFERED` por defecto, que
  tiene un techo de 6 MB de payload) que permite mandar la respuesta en partes a medida
  que se generan, con hasta 200 MB de payload total.
  [docs.aws.amazon.com/lambda/.../config-rs-invoke-furls.html](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html)
  El soporte nativo (`awslambda.streamifyResponse()`) es **solo para runtimes managed
  de Node.js**. Para Python (el caso de `services/api`), la vía documentada y usada en
  producción es el **Lambda Web Adapter** (extensión oficial de AWS, capa/sidecar que
  proxea cualquier servidor HTTP normal — en este caso FastAPI/uvicorn tal cual ya
  corre hoy — hacia el protocolo de streaming de Lambda), con
  `AWS_LWA_INVOKE_MODE=RESPONSE_STREAM` en el contenedor y `RESPONSE_STREAM` en la
  Function URL. AWS publica un ejemplo de referencia exacto para este caso —
  FastAPI + streaming — en
  [aws/aws-lambda-web-adapter/examples/fastapi-response-streaming](https://github.com/aws/aws-lambda-web-adapter/tree/main/examples/fastapi-response-streaming).
  Esto es trabajo real de integración (agregar la capa, las env vars, ajustar el
  Dockerfile), pero no es una reescritura del framework — FastAPI se mantiene.

### El problema de fondo: el `JobStore` en memoria no sobrevive a Lambda

Esto es lo más importante de esta sección y el motivo por el que Lambda **no es un
"lift and shift"** del Dockerfile actual, sea cual sea el streaming:

- Lambda ejecuta cada invocación en un **entorno de ejecución que puede ser nuevo en
  cualquier momento** (cold start) y que **puede reciclarse o correr en paralelo** bajo
  concurrencia — no hay garantía de que la invocación que sirve el `POST /analyze` y la
  que sirve después el `GET` de progreso SSE caigan en el mismo proceso con el mismo
  diccionario en memoria. El diseño actual (`JobStore` en memoria de un único worker
  uvicorn, `--workers 1` a propósito) asume exactamente lo contrario: un solo proceso
  vivo que ve todas las requests.
- Hay dos caminos, ninguno gratis en esfuerzo de ingeniería:
  1. **Colapsar creación + progreso + resultado en una sola invocación larga** que
     mantiene la conexión de streaming abierta durante los 10-90 s completos del
     análisis (en vez de `202 + polling`, un único request que empieza a mandar SSE de
     inmediato y termina entregando el resultado). Encaja mejor con el modelo de
     ejecución de Lambda, pero cambia el contrato HTTP que hoy expone la API — el
     front tendría que abrir una única conexión larga en lugar de crear el job y
     después conectarse aparte al SSE por `job_id`.
  2. **Mover el estado del job a algo compartido entre invocaciones** — DynamoDB es la
     opción obvia (free tier Always Free: 25 GB de storage + 25 unidades de lectura y
     escritura provisionadas, permanente, sin fecha de vencimiento) — y hacer que el
     endpoint de progreso *consulte* ese estado en vez de recibirlo push del propio
     proceso de cómputo. Mantiene el contrato HTTP actual (`202` + `job_id` + SSE por
     separado) pero es, en los hechos, reescribir `jobs.py` sobre un backend distinto.
  - Cualquiera de las dos rutas es trabajo de arquitectura real, no configuración de
    despliegue. Vale la pena decirlo así de directo: **Lambda resuelve el problema de
    costo, no resuelve gratis el problema de estado que el código de hoy da por
    sentado.**

### Cold start con una imagen de 900 MB + GDAL

No hay un número oficial de AWS para "cold start de imagen de N MB con GDAL" — depende
de qué se toca en el arranque, no solo del tamaño de la imagen (Lambda cachea y
deduplica capas de contenedor, y cachea a nivel de AZ tras el primer cold start). Lo
que sí es un hecho verificable: **desplegar rasterio/GDAL en contenedores Lambda es un
patrón consolidado**, no experimental — proyectos como
[titiler](https://github.com/developmentseed/titiler)/`geolambda`/`lambgeo` lo hacen en
producción hace años, con la receta estándar de fijar `GDAL_DATA` y `PROJ_LIB` (o
`PROJ_NETWORK=ON` con GDAL 3.1+/PROJ 7.1+) y escribir cualquier scratch de GDAL en
`/tmp`. El punto real de fricción no verificado con precisión: cuánto tarda el import
de rasterio + la inicialización de GDAL en frío en esta imagen específica — no hay
forma de saberlo sin medirlo, y vale la pena tratarlo como una incógnita a validar con
un prototipo antes de comprometerse, no como un número que se pueda dar por bueno de
antemano.

Un detalle que cierra esta puerta como mitigación gratis: **SnapStart (el mecanismo de
AWS para llevar cold starts a sub-segundo) no soporta imágenes de contenedor** — solo
paquetes ZIP en runtimes Java 11+, Python 3.12+ o .NET 8+. Con GDAL/rasterio, el
paquete tiene que ser contenedor (un ZIP de Lambda no da margen para las librerías
nativas), así que SnapStart queda descartado de entrada. La mitigación paga sería
"provisioned concurrency" (mantener N entornos calientes) — eso sí tiene costo
mensual y ya no es free tier.
[docs.aws.amazon.com/lambda/latest/dg/snapstart.html](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)

### Disco persistente para Lambda: no hay, hay que rodearlo

- `/tmp` es efímero, ya cubierto arriba.
- **EFS es la única forma de disco persistente que Lambda puede montar**, pero (a)
  requiere que la función corra dentro de una VPC con configuración de red adicional,
  y (b) el free tier de EFS (5 GB/12 meses) **es del esquema legado, no permanente** —
  ver §1. Fuera de ese free tier, EFS Standard cuesta ~US$0,30/GB-mes.
- Dado que los dos usos reales de `/data` son (a) resultados de análisis con TTL de
  72 h y (b) caché de Aqueduct, **ninguno de los dos necesita ser un filesystem POSIX
  persistente** — ambos son objetos con clave, el caso de uso ideal de S3, no de EFS.
  Ver §5.

---

## 4. App Runner y ECS Fargate — no tienen free tier, cuánto cuestan

Ninguno de los dos ofrece una franja gratis propia; ambos cobran desde el primer minuto
de uso (más allá del crédito general de cuenta nueva del §1).

- **App Runner**: US$0,064/vCPU-hora + US$0,007/GB-hora mientras procesa activamente
  ("provisioned" en reposo solo cobra la memoria, no la CPU). Config mínima:
  0,25 vCPU / 0,5 GB. Corriendo 24/7 activo: 0,25 × 0,064 × 730 h + 0,5 × 0,007 × 730 h
  ≈ **US$11,68 + US$2,56 ≈ US$14,2/mes** — y esa config de 0,5 GB no alcanza igual para
  el pipeline raster. Subir a algo viable en memoria (2 GB+) multiplica el costo.
  Sin disco persistente nativo salvo montar EFS por separado (con su propio costo).
  [aws.amazon.com/apprunner/pricing](https://aws.amazon.com/apprunner/pricing/) (vía
  fuentes cruzadas, no hay franja "free tier" documentada más allá del crédito de
  cuenta nueva).
- **ECS Fargate**: US$0,04048/vCPU-hora + US$0,004445/GB-hora (Linux/x86, us-east-1).
  Una tarea modesta de 1 vCPU / 2 GB corriendo 24/7: 0,04048 × 730 + 0,004445 × 2 × 730
  ≈ **US$29,55 + US$6,49 ≈ US$36/mes**, sin contar el load balancer si se usa uno
  delante. Primeros 20 GB de storage efímero por tarea incluidos, el resto se cobra
  aparte.

**Veredicto: ninguno compite con las opciones gratis evaluadas en `06-*.md`, ni con
Lambda.** Se los incluye por completitud porque el brief los pidió explícitamente, no
porque haya un caso real para usarlos acá.

---

## 5. S3 + CloudFront para los archivos de salida

### S3: 12 meses, no permanente

El free tier de S3 (5 GB de storage, 20.000 GET, 2.000 PUT) es parte del esquema
**legado de 12 meses** — no es Always Free. En una cuenta nueva post-julio-2025 se paga
desde el primer byte (a las tarifas estándar, ~US$0,023/GB-mes en Standard), cubierto
solo por el crédito general de 6 meses si se lo consume ahí.

Aun así, el costo real es marginal para este caso de uso: los GeoTIFF tienen **TTL de
72 h** y se purgan solos, así que el volumen en reposo nunca crece sin límite — a
cualquier tarifa estándar de S3, unos pocos GB en rotación constante cuestan centavos
al mes, con o sin free tier.

### CloudFront: sí es permanente

**1 TB de transferencia de salida + 10.000.000 de requests HTTP/HTTPS + 2.000.000 de
invocaciones de CloudFront Functions, cada mes, para siempre, sin fecha de
vencimiento, para cualquier cuenta** — esta franja no depende de si la cuenta es
legado o nueva. [Verificado cruzando múltiples fuentes sobre la página oficial de
pricing; AWS no publica esto en una sola tabla consolidada por servicio, pero el
carácter "always free" y sin expiración de CloudFront es consistente en toda la
documentación reciente.]

### Por qué conviene sacar `/data` hacia S3+CloudFront de todas formas

Esto no depende de elegir Lambda como cómputo — **aplica incluso si el cómputo termina
siendo Oracle Always Free o cualquier otra opción con disco propio**:

1. Los overlays PNG y los GeoTIFF descargables son objetos inmutables una vez
   generados — el caso de uso exacto para el que existen S3+CloudFront.
2. Serviros desde CloudFront (permanentemente gratis hasta 1 TB/mes) le saca tráfico de
   tiles al proxy servidor-servidor que hoy corre `apps/web` — el propio brief del
   proyecto marca esa ruta como sensible a latencia. CloudFront con edge caching reduce
   exactamente esa presión para overlays que no cambian una vez generados.
3. Implica cambios de código acotados: donde `main.py`/`config.py` hoy escriben a
   `analyses_dir`/`coastal_dir` en disco local, escribirían (o subirían tras generar en
   scratch local/`/tmp`) a un bucket S3 con esas mismas claves lógicas. No es un cambio
   de arquitectura del pipeline de cómputo, solo del *sink* de persistencia — bastante
   más chico que la reescritura del `JobStore` que exige Lambda.

---

## 6. Registry of Open Data on AWS — sí hay copias, y sí importa la región

Confirmado contra el [Registry of Open Data on AWS](https://registry.opendata.aws/) y
los YAML fuente en [awslabs/open-data-registry](https://github.com/awslabs/open-data-registry):

| Dataset | Bucket S3 | Región | Requester-pays |
|---|---|---|---|
| **Sentinel-2 L2A COGs** (Earth Search / Element 84) | `s3://e84-earth-search-sentinel-data` | **us-west-2** | No |
| **Copernicus DEM GLO-30** (Sinergise) | `s3://copernicus-dem-30m` | **eu-central-1** | No |
| **ESA WorldCover** (VITO) | `s3://esa-worldcover` | **eu-central-1** | No |

Los tres son públicos, sin necesidad de credenciales (`--no-sign-request`), y ninguno
cobra requester-pays — la lectura en sí es gratis desde cualquier región. Lo que cambia
con la región de cómputo es **la transferencia de datos entre regiones** (con costo y
latencia) contra **la transferencia dentro de la misma región** (gratis y rápida).

**Lectura del hallazgo**: no hay una única región de AWS que colocalice los tres
datasets — Sentinel-2 vive en `us-west-2`, DEM y WorldCover en `eu-central-1`. Pero no
pesan igual en el pipeline:

- **Sentinel-2 es, con diferencia, el dataset más pesado por análisis** — 6 escenas
  mosaicadas en cada corrida. Correr el cómputo en `us-west-2` da acceso same-region
  (gratis, baja latencia) exactamente al dataset que más se lee por request.
- **Copernicus DEM y WorldCover son consultas mucho más chicas y estables** — no son 6
  escenas por análisis, son recortes de un raster global que cambia poco. El propio
  código ya tiene un patrón de caché para Aqueduct (`coastal_dir`, keyed por AOI); el
  mismo patrón — cachear en el propio bucket S3 del proyecto, en `us-west-2`, los
  tiles de DEM/WorldCover que cubren el territorio de República Dominicana — convierte
  el costo cross-region de esos dos datasets en **un costo de sincronización única**
  (correr una vez, guardar localmente) en vez de un costo recurrente por análisis.

Comparado con la situación actual (todo servido desde Microsoft Planetary Computer,
sobre Azure Blob Storage, sin importar en qué nube corra el cómputo — siempre hay un
salto de proveedor), correr en AWS `us-west-2` **sí mejora la localidad** para la
porción más pesada del tráfico de datos, aunque no para las tres fuentes por igual. No
es un cambio que borre el argumento a favor de Lambda/AWS, pero tampoco es gratis:
exige mantener dos rutas de acceso a datos (MPC como hoy, o Earth Search + Copernicus
DEM + WorldCover directos si se migra) y validar que el procesamiento de Earth Search
(mismo Sentinel-2 L2A, pipeline de procesamiento no necesariamente idéntico byte a
byte al de MPC) da resultados equivalentes para NDVI antes de confiar en él en
producción.

---

## 7. La mejor combinación en AWS, costo real, y comparación con Oracle

### La combinación

**Lambda (contenedor, RESPONSE_STREAM vía Lambda Web Adapter) + DynamoDB (estado de
jobs) + S3 (GeoTIFF/PNG) + CloudFront (entrega) — todo en `us-west-2`** para
`services/api`. Para `apps/web`: Lambda también, con Lambda Web Adapter proxeando el
`server.mjs` de `node:http` tal cual existe hoy — a diferencia de Cloudflare Workers
(que exige un entrypoint `fetch`), el Web Adapter proxea cualquier servidor HTTP
normal sin reescribirlo, así que el "SSR siempre encendido sin Nitro" del brief no
choca acá del mismo modo que choca con Workers (ver `02-*.md` §0). El costo de que
"siempre encendido" se vuelva "se despierta por request" es el cold start de cada
invocación fría — aceptable a bajo tráfico, mitigable con provisioned concurrency si
hace falta consistencia (ya no gratis).

### Costo real mensual

A escala hobby/portafolio (el volumen que este proyecto declara: análisis
ocasionales, no un servicio con tráfico constante):

- **Lambda**: US$0, dentro de los 400.000 GB-segundos + 1M requests permanentes de
  ambos servicios combinados (el cálculo de §3 ya muestra que 1 solo servicio tiene
  margen para ~2.200 análisis/mes antes de salir del free tier).
- **DynamoDB**: US$0, dentro de los 25 GB + 25 RCU/WCU Always Free.
- **S3**: unos pocos centavos/mes — GeoTIFF con TTL de 72 h nunca acumulan volumen, y
  aunque el free tier de 12 meses no aplique a una cuenta nueva, las tarifas estándar
  sobre pocos GB en rotación son marginales.
- **CloudFront**: US$0, dentro de 1 TB/mes Always Free — muy por encima de lo que un
  uso hobby de overlays PNG puede generar.
- **Total estimado: US$0-2/mes**, indefinidamente, sin depender de ningún reloj de 6 o
  12 meses.

### Comparación final contra Oracle Always Free

| | **AWS (Lambda+DynamoDB+S3+CloudFront)** | **Oracle Always Free (Ampere A1)** |
|---|---|---|
| Costo mensual a escala hobby | ~US$0-2, permanente | US$0, permanente |
| RAM/cómputo disponible | Hasta 10 GB configurables *por invocación*, no persistente | 12 GB RAM persistentes, 2 OCPU, siempre |
| Disco persistente | No nativo — hay que rearquitecturar a S3/DynamoDB | 200 GB en disco, tal cual el código ya lo espera |
| Cambios de código requeridos | **Reescribir el `JobStore`** (DynamoDB o colapsar en una invocación larga), adaptar streaming (Lambda Web Adapter), mover `/data` a S3 | Ninguno — el Dockerfile de 900 MB corre tal cual, un solo proceso, disco local |
| Riesgo operativo | Cold start no medido con GDAL/900 MB; SnapStart no aplica a contenedores | Oracle reclama instancias con <20% de uso por 7 días — hay que generar carga sintética o aceptar el riesgo |
| Requiere tarjeta | Sí | Sí |
| Vence en 6/12 meses | **No** — Always Free real, sin importar antigüedad de cuenta | No — Always Free real |

**Conclusión**: si el criterio es "menor esfuerzo de ingeniería para lo que ya existe
hoy", Oracle Always Free sigue ganando — no exige tocar `jobs.py` ni el modelo de
persistencia. Si el criterio es "menor riesgo de que la plataforma te saque la
alfombra" (Oracle recorta cupos y reclama instancias idle; AWS Lambda/DynamoDB/S3/
CloudFront Always Free no tiene ese patrón histórico), **AWS gana, pero cobra el precio
en una reescritura real del servicio de jobs** que no es cosmética. No es una decisión
que se pueda tomar solo mirando precios — depende de cuánto esfuerzo de refactor está
dispuesto a poner el equipo a cambio de sacarse de encima el riesgo de reclamo de
Oracle.

---

## Fuentes citadas

- [AWS Free Tier — anuncio del cambio de julio 2025](https://aws.amazon.com/about-aws/whats-new/2025/07/aws-free-tier-credits-month-free-plan/)
- [AWS Free Tier Terms](https://aws.amazon.com/free/terms)
- [AWS Free Tier — documentación de billing](https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/free-tier.html)
- [AWS Lambda Pricing](https://aws.amazon.com/lambda/pricing/)
- [Lambda — invocar función con response streaming vía Function URLs](https://docs.aws.amazon.com/lambda/latest/dg/config-rs-invoke-furls.html)
- [Lambda — crear función con imagen de contenedor](https://docs.aws.amazon.com/lambda/latest/dg/images-create.html)
- [Lambda SnapStart — documentación oficial](https://docs.aws.amazon.com/lambda/latest/dg/snapstart.html)
- [aws/aws-lambda-web-adapter — ejemplo FastAPI response streaming](https://github.com/aws/aws-lambda-web-adapter/tree/main/examples/fastapi-response-streaming)
- [AWS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Registry of Open Data on AWS](https://registry.opendata.aws/)
- [ESA WorldCover — Registry of Open Data](https://registry.opendata.aws/esa-worldcover-vito/)
- [Copernicus DEM — Registry of Open Data](https://registry.opendata.aws/copernicus-dem/)
- [Sentinel-2 L2A COGs — Registry of Open Data](https://registry.opendata.aws/sentinel-2-l2a-cogs/)
- [awslabs/open-data-registry — YAML fuente de los tres datasets](https://github.com/awslabs/open-data-registry)
- [Lightsail free trial — repost.aws](https://repost.aws/questions/QUgWKsPw-aSZqMUHFFvPS3kg/lightsail-free-tier-specifications-3-months-90-days)
