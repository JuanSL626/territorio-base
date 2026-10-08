# Hoja de ruta de datos para Colombia

- **Estado:** activa
- **Horizonte:** 0–18 meses
- **Última revisión:** 2026-10-08

## Objetivo

Convertir Territorio Base en un repositorio de contexto territorial para
Colombia que pueda alimentar diagnósticos de ordenamiento, inmobiliarios,
ambientales, mineros, de infraestructura y de prefactibilidad solar.

La primera meta no es copiar todos los datos del país. Es poder consultar un
AOI, conservar un snapshot reproducible y reutilizarlo cuando exista una
necesidad comprobada.

## Decisiones vigentes

- Priorizar la fuente oficial directa. Croma queda como referencia de
  descubrimiento y comparación, no como dependencia de ejecución.
- Mantener la división actual: raster en Python; fuentes vectoriales y
  tabulares en TypeScript.
- Consultar por AOI, municipio o período antes de plantear una ingestión
  nacional.
- Guardar inicialmente los resultados en `analysis.result_json`, incluyendo
  procedencia, fecha, parámetros, licencia y advertencias.
- No crear todavía un modelo universal de proveedores, una cola ETL ni una
  base PostGIS. Se añaden cuando dos o más flujos necesiten consultar y cruzar
  persistentemente los mismos datos.
- `sin resultados`, `sin cobertura` y `fuente no disponible` son estados
  distintos.
- Una fuente solo entra a producción después de comprobar acceso automático,
  cobertura, licencia, vigencia, esquema y una consulta real.

## Aprendizajes de la evaluación de Croma

Croma fue útil para descubrir y comparar fuentes colombianas, pero también
mostró qué responsabilidades debe asumir Territorio Base aunque cambie el
proveedor:

- Separar siempre **autoridad original** (IGAC, ANM, SECOP, SIATA, CREG) de
  **proveedor de acceso**. En mapas y reportes la atribución principal es de la
  autoridad; el intermediario queda registrado en la procedencia.
- No tratar toda respuesta como una capa GIS. Catastro y minería entregan
  geometrías; SECOP y CREG aportan contexto tabular o documental que necesita
  una relación territorial verificable.
- Distinguir tres usos: consulta en vivo para información volátil, snapshot
  inmutable por análisis e ingestión versionada solo para datos estables y
  reutilizados.
- Conservar endpoint y versión, parámetros, fecha de consulta, vigencia del
  dato, cobertura, licencia, respuesta original o hash y advertencias de
  frescura. Una respuesta `stale` nunca equivale a una respuesta vigente.
- Aislar los fallos por fuente y respetar cuotas, `Retry-After`, paginación y
  cambios de esquema. Una fuente caída degrada el diagnóstico; no lo invalida
  completo.
- Los catálogos y OpenAPI sirven para descubrir contratos, pero cada endpoint
  debe probarse con casos reales antes de incorporarlo.
- Una API paginada para consultas puntuales no es un mecanismo razonable para
  replicar millones de predios. La ingestión nacional requiere descarga masiva
  oficial, incrementales o un acuerdo específico con el proveedor.
- Un agregador sí puede justificar su costo cuando estabiliza una fuente
  interna no documentada, mantiene un índice documental o conserva copias
  históricas. Ese valor apareció especialmente en SIATA en vivo, CREG y el
  avalúo predial; no es necesario para IGAC abierto, ANM o SECOP.
- Croma no reemplaza las fuentes necesarias para prefactibilidad solar:
  irradiación, capacidad de conexión, subestaciones y red siguen pendientes de
  contratos oficiales de UPME/XM u otra autoridad competente.

Por estas razones Croma queda como referencia de descubrimiento y posible
respaldo selectivo, no como dependencia transversal ni como fuente oficial.

## Inventario nacional comprobado

Las fuentes globales que ya cubren Colombia —DEM, Sentinel-2, WorldCover,
OpenStreetMap, WDPA y WRI Aqueduct— se mantienen como línea base; están
documentadas en el [README](../README.md#fuentes-de-datos).

| Dominio | Fuente oficial y acceso comprobado | Cobertura útil | Uso previsto | Estado |
|---|---|---|---|---|
| División territorial | DANE, [MGN 2025](https://portalgis.dane.gov.co/mparcgis/rest/services/MGN2025/Serv_CapasMGN_2025/MapServer) y [DIVIPOLA](https://www.datos.gov.co/resource/gdxc-w37w.json) | Nacional: departamentos, municipios, rural/urbano, manzanas y códigos | Resolver el AOI a códigos oficiales y unir todas las fuentes | Prioridad 0 |
| Catastro | IGAC, [base catastral pública](https://services2.arcgis.com/RVvWzU3lgJISqdke/arcgis/rest/services/CATASTRO_PUBLICO_31082026/FeatureServer) y [zonas homogéneas](https://services2.arcgis.com/RVvWzU3lgJISqdke/arcgis/rest/services/Zonas_Homogeneas_Gestor_IGAC_Vigencias_2026/FeatureServer) | Municipios administrados por IGAC; no cubre todos los gestores descentralizados | Terrenos, construcciones, dirección, destino, áreas, zonas físicas y valor de zona | Corto plazo |
| Áreas protegidas | Parques Nacionales, [RUNAP](https://mapas.parquesnacionales.gov.co/arcgis/rest/services/pnn/runap/MapServer/0) | Nacional; publicación anunciada semanalmente | Restricciones ambientales oficiales y contraste con WDPA | Corto plazo |
| Minería | ANM, [ANNA Minería MapServer](https://annamineria.anm.gov.co/annageo/rest/services/SIGM/VisorGeneral/MapServer) | Nacional | Títulos, solicitudes, reservas y áreas restringidas o excluibles | Corto plazo |
| Contratación pública | Colombia Compra Eficiente, [procesos SECOP II](https://www.datos.gov.co/resource/p6dx-8zbt.json) y [contratos](https://www.datos.gov.co/resource/jbjy-vk9h.json) | Nacional; actualización diaria | Inversión pública por municipio, sector, categoría y período | Corto plazo |
| Hidrometeorología | IDEAM, [catálogo de estaciones](https://www.datos.gov.co/resource/hp9r-jxuu.json) | Red nacional de estaciones; no es una superficie continua | Estaciones cercanas, variables disponibles y vigencia | Mediano plazo |
| Inundación | IDEAM, mapas por períodos de retorno en datos.gov.co | Solo centros poblados publicados; no es cobertura continua nacional | Advertencia de amenaza donde exista cartografía | Mediano plazo |
| Geología y amenazas | Servicio Geológico Colombiano, FeatureServers públicos | Nacional o por amenaza: fallas, unidades geológicas, sismicidad, volcanes y movimientos en masa | Restricciones y contexto geotécnico preliminar | Mediano plazo |
| Suelo rural | UPRA, datasets geográficos en datos.gov.co | Nacional según producto | Aptitud agropecuaria/forestal y rangos de precio rural | Mediano plazo |
| Transporte | INVÍAS, [red vial nacional](https://www.datos.gov.co/resource/ie7y-asdn.json) | Red nacional con geometría | Accesibilidad, proximidad vial y contexto logístico | Mediano plazo |

### Límites que no deben ocultarse

- La publicación abierta del IGAC permite obtener el terreno y sus atributos,
  pero no el avalúo catastral individual vigente ni información de propietarios.
- Las geometrías catastrales son referenciales y no certifican linderos.
- Los gestores catastrales descentralizados requieren conectores propios.
- Los mapas de inundación publicados para determinados centros poblados no
  deben presentarse como un mapa continuo de amenaza nacional.
- La ubicación administrativa de SECOP no identifica necesariamente el punto
  donde se ejecuta un contrato; se agrega por municipio y no se geocodifica de
  forma ficticia.
- SIATA es regional del Valle de Aburrá, no una fuente nacional.
- CREG es principalmente documental. Un índice equivalente al de Croma
  requeriría crawling, extracción de texto y mantenimiento continuo.
- Para prefactibilidad solar todavía faltan irradiación validada y capacidad de
  conexión a red. El acceso oficial de UPME/XM debe comprobarse antes de
  prometer esas capas.

## Resultado común mínimo

Cada consulta incorporada debe conservar, como mínimo:

```ts
{
  authority: string
  sourceId: string
  endpoint: string
  sourceVersion: string | null
  queriedAt: string
  sourceUpdatedAt: string | null
  coverage: "national" | "partial" | "regional"
  license: string | null
  request: Record<string, unknown>
  payloadHash: string
  status: "ok" | "empty" | "not_covered" | "error"
  warnings: string[]
}
```

Este bloque describe procedencia; cada fuente conserva su propio esquema de
dominio. No se normalizan predios, estaciones y contratos en una entidad
geográfica genérica.

## Corto plazo — 0 a 3 meses

### Resultado esperado

Un AOI colombiano se ubica oficialmente, consulta las fuentes nacionales de
mayor valor y deja un snapshot reproducible sin depender de Croma.

### Orden de ejecución

1. **Base territorial y procedencia**
   - Resolver departamento, municipio, clase urbano/rural y códigos DANE con el
     MGN/DIVIPOLA.
   - Incorporar el bloque común de procedencia al contrato de análisis.
   - Usar cuatro AOI de referencia: municipio IGAC, ciudad con gestor
     descentralizado, zona rural/minera y zona costera.
2. **IGAC directo**
   - Consultar terreno urbano y rural por punto o AOI.
   - Unir `REGISTRO_1`, `REGISTRO_2`, construcciones y zonas homogéneas.
   - Reportar `not_covered` cuando el gestor no sea IGAC.
   - Descubrir la publicación mensual vigente; no fijar permanentemente una URL
     fechada.
3. **RUNAP**
   - Intersectar áreas protegidas oficiales con el AOI.
   - Mantener WDPA como contraste global, identificando discrepancias en vez de
     mezclar ambas fuentes silenciosamente.
4. **ANM**
   - Intersectar títulos, solicitudes y las principales áreas mineras
     restringidas o excluibles.
   - Descubrir capas por nombre/esquema, no solamente por ID numérico.
5. **SECOP**
   - Consultar procesos y contratos por código territorial y período mediante
     SoQL.
   - Entregar totales, valores, sectores y registros relevantes; no puntos
     inventados.

### Criterio de salida

- Los cuatro AOI de referencia terminan en `ok`, `empty` o `not_covered` según
  corresponda, sin confundir esos estados con errores.
- Cada dato nuevo muestra autoridad, fecha, cobertura, licencia y advertencia.
- Un fallo de IGAC, RUNAP, ANM o SECOP no impide completar las demás fuentes.
- El reporte y el ZIP reproducen la procedencia del snapshot.
- No hay secretos en el navegador ni nuevas dependencias si `fetch`, Turf y los
  validadores instalados cubren el trabajo.

## Mediano plazo — 3 a 9 meses

### Resultado esperado

El repositorio añade amenazas, ambiente, suelo, población e infraestructura
para diagnósticos nacionales más completos.

| Orden | Entrega | Resultado |
|---:|---|---|
| 1 | SGC | Fallas, unidades geológicas, zonas sísmicas/volcánicas e inventario de movimientos en masa, con escala y fecha visibles |
| 2 | IDEAM | Catálogo de estaciones cercanas y cartografía de inundación solo donde exista cobertura publicada |
| 3 | UPRA | Aptitud y precios rurales como contexto regional, conservando año, escala y clase |
| 4 | INVÍAS | Red vial oficial, distancia al AOI y acceso por categoría de vía |
| 5 | DANE social | Población y vivienda municipal a partir de archivos o servicios oficiales versionados, sin copiar indicadores sin fecha o metodología |
| 6 | Energía | Investigación técnica de UPME/XM: red, subestaciones, capacidad e irradiación; implementar únicamente contratos oficiales verificables |

En este horizonte se añade una caché compartida solo para datasets que varios
análisis descarguen repetidamente. La clave debe incluir fuente, versión y
consulta; el snapshot de cada análisis sigue siendo inmutable.

### Criterio de salida

- Cada dominio tiene al menos una consulta real automatizada y una prueba de
  contrato contra un fixture guardado.
- La UI distingue cobertura nacional, parcial y regional.
- La fecha y escala del dato aparecen junto al indicador derivado.
- Existe una revisión trimestral de URLs, esquemas, licencias y frescura.
- UPME/XM queda implementado o registrado explícitamente como bloqueado; nunca
  se sustituye por datos simulados.

## Largo plazo — 9 a 18 meses

### Resultado esperado

Pasar de snapshots aislados a un repositorio nacional reutilizable únicamente
donde el uso real lo justifique.

1. **Repositorio espacial compartido**
   - Activar PostGIS cuando sean necesarias búsquedas cruzadas entre análisis o
     cuando las descargas repetidas dominen el tiempo de ejecución.
   - Separar `source_snapshot`, features versionados y resultados derivados.
   - Mantener archivos grandes o snapshots originales en almacenamiento de
     objetos, no en filas JSON gigantes.
2. **Cobertura catastral ampliada**
   - Añadir gestores descentralizados por demanda comprobada, empezando por una
     sola jurisdicción.
   - Mantener el mismo contrato de procedencia y `not_covered`.
3. **Prefactibilidad energética**
   - Incorporar irradiación, red y capacidad de conexión cuando existan fuentes
     estables y derechos de reutilización claros.
   - Combinar con pendiente, cobertura, RUNAP, ANM, vías, catastro y precio de
     tierra; no convertir el resultado en un estudio definitivo.
4. **Series y evolución territorial**
   - Versionar cambios catastrales, mineros, ambientales y de infraestructura.
   - Permitir comparar snapshots sin sobrescribir el dato usado por análisis
     anteriores.
5. **Operación de fuentes**
   - Actualizaciones según la cadencia de cada autoridad.
   - Alertas por cambio de esquema, ausencia de actualización o licencia.
   - Métricas simples de éxito, latencia y frescura por fuente; sin montar una
     plataforma de observabilidad separada.

### Criterio de salida

- Un análisis puede reutilizar una versión previamente almacenada y declarar
  exactamente cuál utilizó.
- Las actualizaciones no alteran resultados históricos.
- La cobertura catastral se informa por gestor, no con una etiqueta nacional
  engañosa.
- Cada análisis especializado —territorial, inmobiliario o solar— declara qué
  fuentes son evidencia, cuáles son aproximaciones y qué información falta.

## Priorización por producto

| Producto | Fuentes esenciales | Fuentes posteriores |
|---|---|---|
| Planificación territorial | DANE, RUNAP, ANM, SGC, IDEAM, INVÍAS, SECOP | UPRA, series históricas y catastros locales |
| Diagnóstico inmobiliario | IGAC, DANE, RUNAP, SGC/IDEAM, INVÍAS | Gestor catastral local, mercado y normativa municipal |
| Prefactibilidad solar | DEM, pendiente, WorldCover, RUNAP, ANM, INVÍAS, UPRA | Irradiación, red UPME/XM, capacidad de conexión y catastro local |

## Trabajo deliberadamente pospuesto

- Espejo nacional de IGAC, SECOP o cualquier FeatureServer.
- Integración genérica de todos los endpoints de Croma.
- SIATA mientras el producto se concentre en cobertura nacional.
- Crawler e índice de texto completo de CREG.
- Geocodificación automática de contratos SECOP.
- PostGIS, colas y ETL distribuido antes de medir reutilización o cuellos de
  botella.

## Próxima revisión

Revisar esta hoja de ruta al cerrar cada horizonte o cuando cambie uno de estos
supuestos: cobertura del IGAC, disponibilidad de UPME/XM, derechos de
redistribución o necesidad comprobada de consultas entre análisis.
