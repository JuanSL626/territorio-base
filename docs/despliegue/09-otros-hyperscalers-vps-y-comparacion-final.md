# 09 — El resto de los hyperscalers, VPS baratos, otros PaaS, y la comparación final

Fecha: 2026-08-29. Ángulo de este informe: lo que los informes previos en este directorio
(`02-web-frontend-y-combo.md`, `06-hosting-gratis-api-raster.md`) no cubrieron — Google
Cloud, Azure, VPS de bajo costo, y un barrido de PaaS menores — más una tabla comparativa
final con **todo** lo investigado hasta ahora. No repite lo ya establecido en esos dos
informes (Oracle Always Free, Render, Koyeb, Fly.io, Railway, HF Spaces, Vercel Hobby,
Cloudflare Workers): construye encima.

Todos los números están verificados contra documentación oficial o fuentes citadas en
agosto de 2026. Donde no encontré un número confiable, lo digo explícitamente en vez de
rellenar con un promedio de blogs.

---

## 1. Google Cloud

### 1.1 Compute Engine `e2-micro` (Always Free) — la VM permanente real de GCP

Verificado contra la [página oficial de Always Free](https://docs.cloud.google.com/free/docs/free-cloud-features):

| Recurso | Cupo Always Free | Fuente |
|---|---|---|
| Cómputo | 1 instancia `e2-micro` no-preemptible/mes, **solo** en `us-west1` (Oregon), `us-central1` (Iowa) o `us-east1` (Carolina del Sur) | docs.cloud.google.com |
| RAM | **1 GB** (2 vCPU compartidas, mapeadas a ~1/8 de un core físico — bursteable por segundos, no sostenido) | Vantage/CloudPrice, confirmado contra Vantage instance specs |
| Disco | **30 GB-mes de persistent disk estándar** (no SSD) | docs.cloud.google.com |
| Cloud Storage | 5 GB-mes regional (solo `us-*`), 5.000 op. clase A + 50.000 clase B/mes | docs.cloud.google.com |
| Egress | **1 GB/mes** desde Norteamérica a todos los destinos (excepto China/Australia) | docs.cloud.google.com |
| Permanencia | **Permanente**, no de 12 meses — es la misma categoría "Always Free" que el resto de esta tabla | docs.cloud.google.com |
| Tarjeta | Sí, obligatoria en la cuenta de facturación | conocido, no vuelto a verificar acá |

**¿Alcanza 1 GB de RAM para el pipeline?** El propio brief del proyecto ya lo califica
como "dudoso", y esto lo confirma en vez de resolverlo. Con datos concretos del pipeline
(arrays float32 de ~1000×1000 px ≈ 4 MB cada uno, mosaico de 6 escenas Sentinel-2 con
varias bandas en vuelo para NDVI + pendiente + WorldCover), el peor caso razonable ronda
unos cientos de MB de arrays activos — no es un problema de "los arrays no entran", es un
problema de **margen**: sobre 1 GB total, restale SO + intérprete Python + GDAL cargado +
FastAPI/uvicorn (típicamente 150-250 MB de base) y queda un colchón de ~750-850 MB para
picos de reproyección/resampleo, que rasterio/GDAL sí puede duplicar temporalmente durante
un `reproject()` o `warp`. Es *posible* que corra, pero sin margen para un segundo request
concurrente ni para picos — y el propio diseño de un solo worker ya asume que no hay
concurrencia, lo cual ayuda.

**¿Sirve el swap como red de seguridad?** Sí, pero con matices honestos:
- Se puede crear un swapfile sobre los 30 GB de persistent disk gratis sin costo adicional
  — es solo espacio en el mismo disco ya incluido.
- GDAL, cuando trabaja con mapeos de memoria más grandes que la RAM, usa su propio manejador
  de "virtual memory" que expulsa páginas menos usadas antes de tocar swap del SO ([RFC 45
  de GDAL](https://gdal.org/development/rfc/rfc45_virtualmem.html)) — así que no es una
  situación de "todo o nada" con el swap del kernel.
- El costo real es de rendimiento, no de correctitud: un swap-out durante un pico de
  memoria puede añadir segundos a un análisis que ya tarda 10-90 s. Aceptable como red de
  seguridad contra un OOM kill, no como estrategia de operación normal.
- **Veredicto honesto**: el swapfile convierte "1 GB es dudoso" en "1 GB probablemente
  alcanza, con degradación ocasional en vez de crash" — pero solo probarlo con el pipeline
  real (mosaico completo, AOI grande) confirma si el colchón post-swap es suficiente. No es
  un descarte automático como Render/Koyeb (512 MB, sin ninguna red de seguridad posible
  porque tampoco dan disco gratis para swap), pero tampoco es la comodidad de Oracle (12 GB
  reales, sin necesidad de swap).

**El otro problema, más duro que la RAM: el egress de 1 GB/mes.** Esto no es un detalle
menor — es el mismo límite que descalifica a Cloud Run en el informe `06` (§ tabla,
fila Cloud Run), y aplica igual acá: cada GeoTIFF u overlay PNG que la API sirva hacia
`web` (que a su vez lo proxea al usuario) consume esta cuota. Un puñado de análisis con
descarga agotan 1 GB en un día de uso real. Esto convierte a e2-micro en una VM que
*computa* bien (con reservas de RAM) pero no puede *servir* resultados a un volumen
realista sin superar la cuota gratis y empezar a facturar egress estándar
(~US$0.12/GiB Premium Tier, ~US$0.085/GiB Standard Tier tras la franja gratis —
[cloud.google.com/network-tiers/pricing](https://cloud.google.com/network-tiers/pricing)).

**Veredicto**: e2-micro es la única VM *permanentemente* gratis de GCP, con wheels
`manylinux_x86_64` sin problema (es x86, no ARM — no hereda la trampa de arquitectura que sí
aplica a Oracle Ampere). Pero entre la RAM ajustada (mitigable con swap, no eliminable) y
el egress de 1 GB/mes (no mitigable sin pagar), no compite con Oracle Always Free (12 GB
RAM reales, 200 GB disco, 10 TB egress) para este caso de uso específico. Es una opción
honesta solo si el volumen de uso es muy bajo (demo, unos pocos análisis/día) y se acepta
la fragilidad de RAM.

### 1.2 Cloud Run — actualización sobre el informe `06`: gcsfuse SÍ evita reescribir código

El informe `06` (fila Cloud Run) asumía que sostener `/data` en Cloud Run exige
"reescribir el manejo de `/data` para usar GCS en vez de disco local" — verificado ahora
contra la [documentación oficial de Cloud Storage volume mounts para Cloud Run
services](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts):
el driver CSI `gcsfuse.run.googleapis.com` monta un bucket de GCS como un path POSIX
normal en el contenedor (ej. `/data`), sin necesitar que el código sepa que es un bucket
— es transparente a nivel de sistema de archivos, GA (no beta), configurable en el YAML
del servicio sin tocar `services/api`.

**Corrección al informe `06`**: no hace falta reescribir el código de guardado de GeoTIFF
para adoptar este patrón — solo declarar el volume mount. Las reservas que sí siguen
vigentes: FUSE añade latencia de red a cada escritura/lectura (relevante para un pipeline
que ya tarda 10-90 s), la semántica POSIX no es completa (ej. los archivos no son visibles
para otros lectores hasta que se cierran, sin rename atómico entre procesos — pero acá hay
un solo worker escribiendo y leyendo su propio archivo, así que este punto es en la
práctica inofensivo para este caso de uso), y el free tier de Cloud Storage (5 GB
regional) más el egress de 1 GiB/mes del propio Cloud Run siguen siendo los cuellos de
botella reales, no el mecanismo de montaje.

**Números del free tier permanente** (confirmado, ya citados en el informe `06`, re-verificados
acá): 2M requests/mes, 360.000 GiB-segundos, 180.000 vCPU-segundos, 1 GiB egress/mes desde
Norteamérica — **permanente**, no ligado a los 90 días de prueba.

### 1.3 Créditos de US$300 / 90 días

Confirmado contra
[cloud.google.com/free](https://cloud.google.com/free) y
[signup-faqs](https://cloud.google.com/signup-faqs): cuentas nuevas reciben
US$300 de crédito "Welcome", válido 90 días desde el signup. Cubre cualquier producto de
pago (Compute Engine con más RAM, Cloud Run por encima de cuota, egress) durante ese
período — útil para prototipar sin fricción, pero **no es una solución de despliegue**: a
los 90 días (o al agotar el crédito, lo que ocurra primero) la cuenta vuelve a las cuotas
Always Free normales, y cualquier recurso que dependía del crédito (ej. un e2-medium con
más RAM en vez del e2-micro) empieza a facturar a precio de lista si no se lo apaga o
redimensiona a tiempo. Nota aparte: el crédito no cubre Gemini API en AI Studio (irrelevante
acá) pero sí el resto de los ~20+ productos con capa gratis.

---

## 2. Azure

Se investigó específicamente porque los datos de la API (Microsoft Planetary Computer)
viven en Azure — la hipótesis del brief es que correr ahí acerca el cómputo a los datos.
El resultado es más matizado de lo que sugiere esa premisa.

### 2.1 VM B1s (free trial) — no es un equivalente permanente al e2-micro de GCP

| Recurso | Cupo | Fuente |
|---|---|---|
| Specs B1s | 1 vCPU, **1.0 GB RAM**, 4 GB de disco *local* (temporal, no persistente) | [Vantage instances.vantage.sh/azure/vm/b1s](https://instances.vantage.sh/azure/vm/b1s) |
| Horas gratis | 750 h/mes de B1s (alcanza para 24/7 de una sola instancia) | Microsoft Learn Q&A |
| Duración | **12 meses desde el signup**, no permanente | learn.microsoft.com |
| Disco persistente | **No incluido en el cupo gratis** — el disco de 4 GB del B1s es *temp storage* efímero (se pierde al detener/reiniciar la VM), un disco administrado (Managed Disk) real para `/data` es un recurso pago aparte | Vantage, Microsoft Learn |
| Egress | **No incluido** — la transferencia de datos de entrada/salida de la VM se factura aparte del cupo de 750 h | Microsoft Q&A ("Azure VM B1S free tier Data transfer limit") |

**Veredicto**: comparado con el e2-micro de GCP (mismo tamaño de RAM, 1 GB), el B1s de
Azure pierde en los tres ejes que importan acá: (1) es de **12 meses**, no permanente —
al año hay que migrar o empezar a pagar; (2) el disco persistente no está incluido, hay
que sumar un Managed Disk pago desde el día uno para no perder `/data` en cada reinicio;
(3) el egress tampoco está incluido en el cupo. No es competitivo para este caso de uso ni
siquiera antes de comparar contra Oracle — pierde directo contra la propia oferta
equivalente de GCP.

### 2.2 Azure Container Apps — free tier permanente, pero mismo problema de disco que Cloud Run

Confirmado contra [azure.microsoft.com/pricing/container-apps](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
y Microsoft Learn: **180.000 vCPU-segundos + 360.000 GiB-segundos + 2M requests por
suscripción, por mes — permanente**, prácticamente number-for-number igual al free tier de
Cloud Run. No tiene disco persistente nativo (igual que Cloud Run); el equivalente a
"montar un bucket" sería Azure Files, que no es gratis y sí exige código/config para
tratarlo como filesystem compartido — Azure no tiene un análogo directo y sin fricción al
GA de gcsfuse en Cloud Run confirmado en esta pasada.

### 2.3 Proximidad a Planetary Computer — el mérito es real pero más acotado de lo que sugiere el brief

Verificado directo contra la [documentación oficial de Planetary
Computer](https://planetarycomputer.microsoft.com/docs/concepts/computing/), cita textual:

> "Regardless of how you compute on the data, to ensure maximum efficiency you should
> locate your compute as close to the data as possible. Most of the Planetary Computer
> Data Catalog is hosted in Azure's **West Europe** region, so your compute should be
> there too."

Dos correcciones a la premisa del brief:

1. **La región relevante es West Europe, no East US.** Planetary Computer Pro (el
   servicio "Pro" más nuevo) sí está disponible en East US, North Central US, West
   Europe, Canada Central y UK South — pero el catálogo de datos abiertos que usa este
   proyecto (Sentinel-2, DEM, WorldCover, servido vía STAC + Blob Storage) vive
   mayormente en West Europe. Si se elige Azure por esto, la región a usar es
   **West Europe**, no East US.
2. **El ahorro real es de latencia, no de costo de egress.** El ingreso de datos
   (descargar bytes de un COG hacia tu propio servidor) **no se cobra en ningún
   hyperscaler** — GCP, Azure, AWS, Oracle, ni los VPS de la sección 3 cobran por tráfico
   entrante. Así que "estar cerca de los datos en la misma nube" no evita una tarifa de
   egress que de todos modos no existiría para ese sentido del tráfico; lo que sí gana es
   **round-trip time** más bajo en las docenas de range-requests que hace `odc-stac` para
   armar un mosaico de 6 escenas — con un pipeline de 10-90 s que hace muchas lecturas
   pequeñas, menos latencia de ida y vuelta sí se nota en el tiempo total, especialmente
   si el resto del stack (Oracle en la región que se elija, un VPS en EE.UU./Caribe, u
   otro hyperscaler) está a 100+ ms de Europa.

**Conclusión sobre Azure**: el mérito de estar "en la misma nube que los datos" es real
pero secundario (latencia, no costo), y para capturarlo hay que estar en **West Europe**
— lo cual aleja el servicio de Supabase (`us-west-1`, AWS Norte de California) y de los
usuarios finales en República Dominicana/Caribe, dos anclas geográficas que probablemente
pesan más que el ahorro de latencia hacia Planetary Computer en un pipeline que de todos
modos toma 10-90 s. Ni el B1s (temporal, sin disco) ni Container Apps (sin disco, mismo
problema que Cloud Run) superan a las opciones ya evaluadas en RAM+disco+permanencia. Azure
no entra al podio para este servicio.

---

## 3. VPS baratos — el escalón "casi gratis" con datos reales

Ninguna de estas opciones es gratis, pero a €4-5/mes muchas resuelven RAM + disco +
sin-sleep sin ninguna de las trampas operativas de un free tier (sin reclamo por
inactividad, sin límite de imagen artificial, control total).

| Proveedor | Plan | Precio/mes | vCPU | RAM | Disco | Ancho de banda | Ubicación relevante |
|---|---|---|---|---|---|---|---|
| **Hetzner Cloud** | CX22 | ~€4.35 (~US$4.7) | 2 (compartidas) | 4 GB | 40 GB NVMe | No confirmado explícito, generoso | **Solo EU** (y algo de Asia/US en otras familias) — irónicamente la más cercana a Planetary Computer (West Europe), la más lejos de Supabase/Caribe |
| **Contabo** | Cloud VPS 4GB | ~US$3.88–5.10 según disco | Variable (compartida) | 4 GB | 50–100 GB SSD/NVMe | No confirmado explícito | **NYC, St. Louis (US Central), Seattle** además de EU/Asia — St. Louis con pings de ~3 ms a metros de EE.UU., buena cobertura hacia el Caribe |
| **OVHcloud** | VPS-1 | ~US$4.54 | 2 | 4 GB | 40 GB NVMe | 500 Mbps, "unlimited traffic" | Datacenters US confirmados en la existencia del producto, ciudades específicas no confirmadas en esta pasada — verificar al elegir región |
| **IONOS** | Desde US$5 | US$5+ (plan 4 GB específico no confirmado) | — | — | — | — | **Newark NJ, Las Vegas NV, Lenexa KS** — Newark es razonablemente cercano a la costa este/Caribe |
| **DigitalOcean** | Droplet 4GB | US$24 | 2 | 4 GB | 80 GB SSD | 4 TB | Datacenter NYC confirmado (entre otros) — facturación por segundo desde ene-2026 |
| **Vultr** | Cloud Compute 4GB | US$20 | 2 | 4 GB | 80 GB SSD | 3 TB | **Miami** es el datacenter de Vultr más cercano geográficamente a República Dominicana de toda esta tabla |

Notas de honestidad:
- Los números de ancho de banda de Hetzner y OVH no se confirmaron con una cifra exacta en
  esta pasada — sus páginas de precios no detallaron el tope mensual en el fetch
  disponible; antes de comprometerse, confirmar directo en el checkout.
- El precio "por mes" de todos estos (salvo DO, que factura por segundo) es indicativo —
  verificar impuestos/región al momento de contratar.
- **Ningún VPS de esta lista está físicamente en el Caribe.** El más cercano a República
  Dominicana en km es Miami (Vultr); el segundo, cualquiera de las ubicaciones US-Este de
  Contabo/DO/IONOS. Ninguno acerca al servicio a los usuarios tanto como lo haría un
  datacenter real en la región (que ningún proveedor de esta lista ofrece).
- Hetzner es la mejor relación precio/RAM/disco de la tabla (4 GB RAM + 40 GB NVMe por
  ~US$4.7), pero solo en Europa — lo cual, notablemente, es la región más cercana a
  Planetary Computer (ver §2.3) aunque la más lejos de Supabase y de los usuarios finales.
- **Comparado con Oracle Always Free** (2 OCPU/12 GB RAM, 200 GB disco, 10 TB egress,
  gratis): ningún VPS de esta tabla iguala esas specs ni gratis ni pago a este precio —
  Oracle sigue ganando en papel. La ventaja real de pagar €4-5/mes por un VPS en vez de
  usar Oracle gratis es **eliminar el riesgo de reclamo por inactividad** (Oracle recupera
  instancias Always Free con <20% de uso sostenido por 7 días) y evitar la fricción de
  verificación de tarjeta/capacidad regional de Oracle — a cambio de RAM/disco más chicos
  (4 GB / 40 GB en vez de 12 GB / 200 GB) y un costo mensual real, aunque mínimo.

---

## 4. Otros PaaS — barrido rápido, la mayoría descalificado por RAM o por no tener free tier

| Plataforma | Free tier real | Veredicto |
|---|---|---|
| **Clever Cloud** | Ninguno desde ago-2023 — solo créditos de prueba y un plan DEV limitado a algunas bases de datos (sin backups/SLA) | Descalificado como "gratis"; de pago arranca ~€4.80/mes por la instancia más chica, comparable a los VPS de §3 pero como PaaS gestionado en vez de VPS crudo |
| **Platform.sh** | Prueba de 30 días bajo el plan Professional, sin capa gratis permanente; tras la prueba, el paquete Essential factura ~€21.60/mes por 0.65 GB RAM / 0.65 vCPU | Descalificado — ni gratis ni competitivo en RAM/precio para este caso |
| **Back4App Containers** | **256 MB RAM**, 600 h activas/mes, 0.25 CPU compartida, 100 GB transferencia, sin tarjeta | Descalificado — mismo problema de RAM que Render/Koyeb (256 MB es peor aún que los 512 MB que el propio proyecto ya descarta), y "600 h activas" sugiere un tope de actividad, no always-on real |
| **Qovery** | Sin capa gratis — arranca desde US$299/mes por asiento | Descalificado directo, fuera de rango de precio |
| **Porter (porter.run)** | No se encontró documentación de pricing/free-tier confiable y actual en esta pasada — las búsquedas devolvieron resultados de un producto no relacionado ("Porter Metrics") | No evaluable con confianza; si se quiere considerar, hay que verificar directo en porter.run antes de decidir, no contra esta investigación |
| **Sevalla** | Hosting **estático** gratis (compite con GitHub Pages/Cloudflare Pages); hosting de **aplicaciones** (lo que necesita este proyecto) es de pago desde US$5/mes | Descalificado como "gratis" para este caso — el free tier no cubre contenedores de aplicación |
| **Leapcell** | **256 MB RAM**, 1 GB de almacenamiento persistente, sin tarjeta obligatoria | Descalificado por RAM (mismo problema que Back4App) — notable que sí ofrece algo de disco persistente gratis, pero la RAM lo saca de carrera antes de que el disco importe |

Ninguno de estos siete aporta una opción viable nueva para `services/api`. El barrido
confirma, más que contradice, el patrón ya visto en el informe `06`: el free tier de PaaS
que junte RAM suficiente + disco persistente + sin-sleep para una imagen de 900 MB con
GDAL, simplemente no existe hoy entre las plataformas evaluadas en los tres informes.

---

## 5. Tabla comparativa final — todas las opciones investigadas

Consolida los tres informes (`02`, `06`, `09`). Ordenada de mejor a peor ajuste para
`services/api` (el componente que manda, por ser la restricción dura). Costo real/mes
asume uso 24/7 dentro de cupos donde aplica.

| # | Opción | Costo real/mes | RAM | Disco persistente | ¿Duerme? | ¿Free permanente? | Migración de código exigida |
|---|---|---|---|---|---|---|---|
| 1 | **Oracle Cloud Always Free (Ampere A1)** | **US$0** | 12 GB (2 OCPU) | 200 GB, real | No | **Sí, permanente** | Ninguna — Docker corre tal cual (wheels ARM64 confirmados) |
| 2 | **Hetzner CX22** (VPS pago) | ~US$4.7 | 4 GB | 40 GB NVMe | No | N/A (pago) | Ninguna — VPS crudo, mismo Dockerfile |
| 3 | **Contabo Cloud VPS 4GB** (US Central/NYC) | ~US$4–5 | 4 GB | 50–100 GB | No | N/A (pago) | Ninguna |
| 4 | **OVHcloud VPS-1** | ~US$4.5 | 4 GB | 40 GB NVMe | No | N/A (pago) | Ninguna |
| 5 | **Fly.io** (pago, ya no gratis) | ~US$10–15 | 1–2 GB configurable | Sí, volumen pago | No | No (retirado oct-2024) | Ninguna |
| 6 | **Google Compute Engine `e2-micro`** | US$0 (dentro de cupo) | 1 GB (RAM ajustada — swap mitiga, no resuelve) | 30 GB, real | No | **Sí, permanente** | Ninguna, pero egress de 1 GB/mes limita servir resultados a volumen bajo |
| 7 | **Google Cloud Run** | US$0 (dentro de cupo) | Hasta 32 GiB configurable | No nativo — gcsfuse (GA, sin reescribir código) mitiga | Escala a 0 (frío en segundos, no minutos) | **Sí, permanente** | Ninguna con gcsfuse (corrección al informe `06`) — pero egress 1 GiB/mes y RAM real de GCS-FUSE bajo prueba |
| 8 | **Vultr Cloud Compute 4GB** (Miami) | US$20 | 4 GB | 80 GB SSD | No | N/A (pago) | Ninguna — más caro que Hetzner/Contabo/OVH por la misma RAM, pero el más cercano geográficamente a RD |
| 9 | **DigitalOcean Droplet 4GB** (NYC) | US$24 | 4 GB | 80 GB SSD | No | N/A (pago) | Ninguna |
| 10 | **Azure Container Apps** | US$0 dentro de cupo, luego pago | Configurable, sin RAM propia gratis fuera de vCPU-s/GiB-s | No nativo (Azure Files, pago, sin equivalente confirmado a gcsfuse) | Escala a 0 | Sí, permanente el cupo — pero sin disco free | Requiere sacar `/data` del filesystem local igual que Cloud Run, sin mitigación confirmada |
| 11 | **Azure VM B1s** | US$0 por 12 meses, luego pago | 1 GB | **No incluido** (disco temp de 4 GB, no persistente) | No | **No — 12 meses, no permanente** | Ninguna técnica, pero exige presupuestar Managed Disk desde el día 1 |
| 12 | **Scaleway Serverless Containers** | US$0 dentro de cupo | Recomendado <1 GB | No | Escala a 0 | Cupo mensual, no confirmado si "permanente" en sentido estricto | Requiere externalizar `/data` a Object Storage (igual que Cloud Run) |
| 13 | **Render** | US$0 (no viable) / ~US$7.25 con disco pago | 512 MB free | No en free ($0.25/GB pago) | Sí, 15 min | Free sí es permanente, pero 512 MB descalifica | Ninguna, pero no alcanza en free |
| 14 | **Koyeb** | US$0 (no viable) | 512 MB | No (2 GB SSD total, imagen sola ya ocupa casi todo) | Sí, 1 h | Sí permanente, insuficiente | Ninguna, pero no alcanza |
| 15 | **Hugging Face Spaces** | US$0 (no aplica) | N/A | N/A | — | El free CPU Basic no cubre Docker (exige PRO) | Trampa de naming, no una opción real |
| 16 | **Zeabur** | US$0 (no viable) | 512 MB / 1 GB disco total | No efectivo (imagen ya ocupa el disco) | Sí | Sí permanente, insuficiente | Ninguna, pero no alcanza |
| 17 | **Back4App Containers** | US$0 (no viable) | 256 MB | Confirmado no aplica a este uso | No confirmado | Sí, pero insuficiente | Ninguna, pero no alcanza |
| 18 | **Leapcell** | US$0 (no viable) | 256 MB | 1 GB | No confirmado | Sí, pero insuficiente | Ninguna, pero no alcanza |
| 19 | **Railway, Fly.io free, Deta/Space, Adaptable, PythonAnywhere, Qovery, Platform.sh, Clever Cloud** | — | — | — | — | **No — sin free tier hoy, o sin soporte Docker** | N/A, directamente fuera |

Para `apps/web` (sin GDAL, sin disco, SSR liviano): el problema es mucho más fácil y
prácticamente cualquier fila de esta tabla lo serviría sin drama — la restricción real de
`apps/web` no es de recursos sino de arquitectura (`server.mjs` sin Nitro, ver informe
`02`), que aplica igual sin importar el hosting elegido para `api`.

---

## 6. Recomendación final

**Gratis, sí alcanza — con Oracle Cloud Always Free**, tal como concluye el informe `06`.
Ningún hallazgo de este informe lo desplaza: ni GCP (e2-micro con RAM ajustada y egress de
1 GB/mes, o Cloud Run sin disco nativo salvo el parche gcsfuse) ni Azure (VM temporal sin
disco free, Container Apps sin disco nativo) superan la combinación RAM+disco+permanencia
de Oracle.

**Si se prefiere no administrar una VM de Oracle a mano** (parcheo de SO, riesgo de
reclamo por inactividad, dependencia de capacidad Ampere en la región elegida), el
hallazgo más útil de este informe es que **el escalón pago más barato no es Fly.io a
US$10–15/mes** (como sugería el informe `02` para el combo) **sino un VPS crudo a
~US$4.5–5/mes** (Hetzner CX22, Contabo Cloud VPS 4GB, u OVHcloud VPS-1) — mismas 4 GB de
RAM, 40-100 GB de disco NVMe, sin sleep, sin límite de imagen, con el mismo
`docker compose up` que ya vive en el repo, y sin ninguna de las trampas operativas de
Oracle. La elección entre esos tres se reduce a ubicación: Contabo (St. Louis/NYC) y
OVHcloud (US, ciudad no confirmada) quedan más cerca de Supabase (`us-west-1`) y de
usuarios en RD/Caribe; Hetzner queda más cerca de Planetary Computer (West Europe) pero
lejos de ambos — y como el ahorro de estar cerca de Planetary Computer es de latencia, no
de costo (§2.3), y el pipeline ya tarda 10-90 s, la cercanía a Supabase y a los usuarios
finales pesa más en la práctica. **Recomendación puntual dentro de este hallazgo: Contabo
Cloud VPS 4GB en su datacenter de St. Louis (US Central)**, como mejor punto medio de
precio, specs, y proximidad simultánea a Supabase y al Caribe.

En síntesis, el orden de decisión honesto es:
1. **Cero costo, aceptando administrar una VM y el riesgo de reclamo por idle**: Oracle
   Cloud Always Free.
2. **~US$5/mes, cero riesgo operativo de plataforma, mismo esfuerzo de setup que Oracle**:
   un VPS crudo (Contabo/Hetzner/OVH).
3. **Ningún free tier de PaaS gestionado (Cloud Run, Container Apps, Scaleway, Render,
   Koyeb, etc.) resuelve RAM + disco + sin-sleep simultáneamente** para una imagen de 900
   MB con GDAL — todos exigen o sacrificar RAM, o sacrificar disco nativo (mitigable sin
   código en Cloud Run gracias a gcsfuse, no confirmado en ningún otro), o pagar de entrada.

---

## Fuentes citadas

- Google Cloud Always Free (specs oficiales): [docs.cloud.google.com/free/docs/free-cloud-features](https://docs.cloud.google.com/free/docs/free-cloud-features)
- e2-micro specs (RAM/vCPU): [Vantage — e2-micro](https://instances.vantage.sh/gcp/e2-micro), [CloudPrice](https://cloudprice.net/gcp/compute/instances/e2-micro)
- Cloud Run pricing/free tier: [cloud.google.com/run/pricing](https://cloud.google.com/run/pricing)
- Cloud Storage volume mounts (gcsfuse GA, sin reescribir código): [docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts](https://docs.cloud.google.com/run/docs/configuring/services/cloud-storage-volume-mounts)
- GDAL virtual memory / manejo de mapeos grandes: [gdal.org RFC 45](https://gdal.org/development/rfc/rfc45_virtualmem.html)
- Network tiers pricing (egress post-cuota): [cloud.google.com/network-tiers/pricing](https://cloud.google.com/network-tiers/pricing)
- GCP $300/90 días: [cloud.google.com/free](https://cloud.google.com/free), [cloud.google.com/signup-faqs](https://cloud.google.com/signup-faqs)
- Azure B1s specs: [Vantage — B1s](https://instances.vantage.sh/azure/vm/b1s), [Microsoft Q&A — data transfer B1s](https://learn.microsoft.com/en-us/answers/questions/1162917/azure-vm-b1s-free-tier-data-transfer-limit)
- Azure free account 750h/12 meses: [Microsoft Learn — create-free-services](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/create-free-services)
- Azure Container Apps free grant (permanente): [azure.microsoft.com/pricing/container-apps](https://azure.microsoft.com/en-us/pricing/details/container-apps/)
- Planetary Computer — región West Europe, cita textual sobre proximidad de cómputo: [planetarycomputer.microsoft.com/docs/concepts/computing](https://planetarycomputer.microsoft.com/docs/concepts/computing/)
- Planetary Computer Pro — regiones disponibles: [azure.microsoft.com/pricing/planetary-computer-pro](https://azure.microsoft.com/en-us/pricing/details/planetary-computer-pro/)
- Hetzner CX22: [vpsfor.dev](https://vpsfor.dev/posts/hetzner-cx22-pricing-2026/), [bestusavps.com](https://bestusavps.com/reviews/hetzner/)
- Contabo VPS + ubicaciones US: [cybernews.com](https://cybernews.com/best-web-hosting/contabo-review/pricing/), [contabo.com/en-us/locations/united-states](https://contabo.com/en-us/locations/united-states/)
- OVHcloud VPS: [us.ovhcloud.com/vps](https://us.ovhcloud.com/vps/)
- IONOS ubicaciones/precio base: [ionos.com/servers/cheap-vps](https://www.ionos.com/servers/cheap-vps)
- DigitalOcean droplet pricing: [digitalocean.com/pricing/droplets](https://www.digitalocean.com/pricing/droplets)
- Vultr pricing (Miami entre ubicaciones): búsqueda agregada, verificar ubicación exacta en vultr.com al contratar
- Clever Cloud (sin free tier desde 2023): agregadores (getapp.com, capterra.com) — no se encontró página oficial de pricing fetcheable directamente en esta pasada
- Platform.sh trial: agregadores de pricing, no verificado contra página oficial en esta pasada
- Back4App Containers: [back4app.com/pricing/container-as-a-service](https://www.back4app.com/pricing/container-as-a-service)
- Qovery (sin free tier, desde US$299/mes): [bunnyshell.com/comparisons/qovery-alternatives](https://www.bunnyshell.com/comparisons/qovery-alternatives/)
- Sevalla (estático gratis, apps de pago): [sevalla.com/pricing](https://sevalla.com/pricing/)
- Leapcell: [leapcell.io/pricing](https://leapcell.io/pricing), [docs.leapcell.io/service](https://docs.leapcell.io/service/)
- Adaptable.io (discontinuado): [adaptable.io/docs/free-app-hosting](https://adaptable.io/docs/free-app-hosting)

### Nota de honestidad

Porter (porter.run) no se pudo evaluar con confianza: las búsquedas devolvieron
resultados de un producto distinto ("Porter Metrics", una herramienta de reportes de
marketing) en vez de la plataforma de hosting de contenedores. Si se quiere considerar
Porter como opción, hay que verificar directo en su sitio antes de decidir — no está
reflejado en la tabla comparativa de la sección 5 más que como "no evaluable". El ancho de
banda exacto de Hetzner y OVHcloud, y la ciudad exacta del datacenter US de OVHcloud,
tampoco se confirmaron con una cifra/nombre concreto en esta pasada — antes de contratar,
verificar en el checkout de cada proveedor.
