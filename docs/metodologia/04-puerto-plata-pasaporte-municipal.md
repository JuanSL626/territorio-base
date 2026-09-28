# Pasaporte municipal — Puerto Plata

**Estado:** PT-0 iniciado · **Fecha de corte:** 2026-09-28

**Piloto:** [Puerto Plata](03-piloto-puerto-plata.md) · **Método:** [Marco Metodológico Base](01-marco-metodologico-base.md)

## 1. Propósito y alcance

Este documento es el primer registro operativo del piloto. Consolida hechos
verificados, fuentes obtenidas, incertidumbres y tareas; no sustituye el PMOT ni
constituye interpretación jurídica.

**Unidad del piloto:** municipio Puerto Plata, que comprende la cabecera de San
Felipe de Puerto Plata y los distritos municipales Maimón y Yásica Arriba. La
referencia administrativa inicial es el [atlas municipal de la ONE](https://www.one.gob.do/media/ojspv4na/atlas-expansi%C3%B3n-de-las-comunidades-urbanas-1988-2022-de-la-provincia-puerto-plata.pdf), con límites urbanos de 2022.

## 2. Estado de la evidencia PMOT

El portal oficial municipal presenta una categoría de documentación PMOT con
secciones de participación, documentación y cartografía. [Portal PMOT](https://ayuntamientopuertoplata.gob.do/transparencia/documentos/plan-municipal-de-ordenamiento-territorial/)

La revisión de los archivos publicados permite distinguir documentos técnicos
del proceso de la evidencia de adopción. Esta distinción es esencial: un archivo
alojado por el Ayuntamiento es una fuente institucional relevante, pero una
memoria, borrador o informe de formulación no prueba por sí mismo que sus
parámetros tengan vigencia jurídica.

| ID | Documento / hito | Tipo de evidencia | Fecha / versión observada | Estado editorial | Uso permitido en Territorio Base |
|---|---|---|---|---|---|
| PP-PMOT-01 | [Diagnóstico PMOT](https://ayuntamientopuertoplata.gob.do/transparencia/wp-content/uploads/2026/04/01-DIAGNOSTICO.pdf) | Reporte técnico de diagnóstico | 11 nov. 2025; 298 páginas | `fuente obtenida` | Contexto, actores, proyectos, indicadores, vacíos y referencias. No define por sí solo un régimen aplicable. |
| PP-PMOT-03 | [Etapa 6: visión, objetivos y lineamientos](https://ayuntamientopuertoplata.gob.do/transparencia/wp-content/uploads/2026/04/03-VISION-OBJETIVOS-Y-LINEAMIENTOS.pdf) | Reporte técnico prospectivo | Portada: versión 1, 23 jul. 2025; hoja de verificación con revisión posterior 5 ago. 2025 | `fuente obtenida` | Visión, objetivos, lineamientos y trazabilidad de participación. La diferencia de fechas se conserva como metadato, no se corrige por inferencia. |
| PP-PMOT-04 | [Etapa 7: formulación PMOT](https://ayuntamientopuertoplata.gob.do/transparencia/wp-content/uploads/2026/04/04-FORMULACION.pdf) | Reporte técnico de formulación | Versión 2, 31 oct. 2025; 130 páginas | `fuente obtenida` | Proponer disposiciones a revisar: usos, parámetros edificatorios, espacio público, UOU/UOD y detalle del Centro Histórico. No mostrar valores como exigencia vigente hasta verificar acto de adopción y cartografía aplicable. |
| PP-PMOT-05 | [Vista pública](https://ayuntamientopuertoplata.gob.do/alcaldia-de-puerto-plata-realiza-vista-publica-sobre-el-plan-municipal-de-ordenamiento-territorial-pmot/) | Hito de participación | 16 oct. 2025 | `fuente obtenida` | Prueba de proceso participativo; no de adopción. |
| PP-PMOT-06 | [Presentación municipal del plan](https://ayuntamientopuertoplata.gob.do/alcalde-diomedes-roque-garcia-y-ayuntamiento-se-puerto-plata-junto-al-ministro-paliza-encabezan-presentacion-del-plan-de-ordenamiento-territorial/) | Comunicación institucional | 9 abr. 2026 | `fuente obtenida` | Prueba de presentación pública; no de adopción, publicación oficial del acto ni vigencia. |
| PP-PMOT-07 | Acto de adopción, publicación, fecha de entrada en vigencia y validación técnica MEPyD | Acto normativo / administrativo esperado | Sin verificar | `pendiente crítico` | Ninguno hasta obtener fuente primaria. |
| PP-PMOT-08 | Cartografía normativa oficial y catálogo de capas | Dato geoespacial esperado | Sin verificar | `pendiente crítico` | Ninguna intersección normativa automática hasta confirmar capa, versión, escala, cobertura y vigencia. |

### Hallazgo PT-0.1 — El PMOT debe modelarse por etapas y estado jurídico

La secuencia publicada separa diagnóstico, prospectiva y formulación. La Etapa
7 contiene, entre otros, calificación de usos, parámetros de altura, ocupación,
densidad, espacio público, fichas por unidad de ordenamiento y un anexo para el
Centro Histórico. Esa riqueza técnica la hace muy útil para investigación, pero
también aumenta el riesgo de mostrar un parámetro propuesto como norma vigente.

**Acción:** el registro de documentos debe tener los campos `estado jurídico`,
`etapa del proceso`, `versión`, `fecha de documento`, `fecha de publicación` y
`fuente del estado`. Ningún campo debe derivarse de una nota de prensa.

## 3. Jurisdicciones, actores y escalas iniciales

| Escala | Actor / jurisdicción | Papel a verificar en el piloto | Estado |
|---|---|---|---|
| Nacional | MEPyD | Rectoría, revisión/validación técnica de PMOT y marco nacional de ordenamiento. | `identificado` |
| Nacional | MIVED, Ministerio de Medio Ambiente, Cultura, Turismo, MOPC y Registro Inmobiliario | Competencias sectoriales, autorizaciones, patrimonio, infraestructura y estado jurídico del inmueble. | `identificado` |
| Municipal | Ayuntamiento de Puerto Plata / planeamiento urbano | Formulación, gestión urbana, instrumentos y coordinación municipal. | `identificado` |
| Distrital | Maimón y Yásica Arriba | Información local, implementación o articulación según competencias y capacidad disponible. | `identificado` |
| Comunitario/privado | Juntas de vecinos, asociaciones productivas, Cámara de Comercio, sector turístico, academia y organizaciones civiles | Evidencia participativa, conocimiento territorial y monitoreo; no sustituyen la competencia pública. | `identificado` |

La fuente nacional de contexto es la [orientación MEPyD sobre Ley 368-22](https://mepyd.gob.do/las-145-preguntas-de-ley-ordenamiento-territorial), que señala la revisión y validación técnica de PMOT por MEPyD. La ley y su reglamento deberán conservarse también desde su publicación primaria.

### Hallazgo PT-0.2 — La capacidad es parte de la aplicabilidad práctica

El diagnóstico PMOT y la revisión Banco Mundial/GFDRR identifican capacidad,
coordinación e información como variables críticas de implementación. En el
piloto no se calificará el desempeño de instituciones; se registrará la evidencia
disponible de competencia, mecanismo de coordinación y dato faltante.

**Acción:** crear una ficha de competencia por actor con `atribución`,
`instrumento fuente`, `escala`, `rol`, `proceso asociado`, `contacto/fuente
pública`, `capacidad por verificar` y `fecha de revisión`.

## 4. Registro normativo mínimo viable

Este registro prioriza documentos necesarios para poder investigar los AOI. No
es un catálogo completo de normas dominicanas.

| Familia | Documento / evidencia por obtener | Finalidad de la consulta | Estado |
|---|---|---|---|
| Ordenamiento nacional | Ley 368-22 y reglamento en fuente primaria | Jerarquía, clases de suelo, instrumentos, competencias y procedimientos. | `prioridad alta` |
| Gobierno local | Ley 176-07 en fuente primaria | Competencias municipales, planeamiento urbano y coordinación. | `prioridad alta` |
| PMOT | Acto de adopción, documento consolidado y cartografía oficial | Distinguir propuesta de régimen vigente y localizar sus ámbitos. | `pendiente crítico` |
| Patrimonio | Acta 11-08, Plan Regulador y documentos del Centro Histórico | AOI A: patrimonio, usos, intervenciones y actores competentes. | `pendiente` |
| Ambiente/riesgo | Determinantes, áreas protegidas, hidrología, riesgo y autorizaciones aplicables | AOI A y B: restricciones, condicionantes y responsables. | `prioridad alta` |
| Proyectos supramunicipales | Instrumentos oficiales vinculados a puerto, turismo, vías, agua u otras infraestructuras | Distinguir proyecto, anuncio e instrumento con efectos territoriales. | `pendiente` |
| Catastro/títulos | Fuentes oficiales solo si la consulta evoluciona a predio concreto | Establecer límites y procesos de certificación, no inferir dominio. | `no iniciado` |

## 5. Geografía y calidad de evidencia

| Tema | Fuente inicial | Nivel de evidencia actual | Uso inicial |
|---|---|---|---|
| Límite municipal, distritos y límites urbanos 2022 | Atlas ONE | B — cartografía oficial en PDF hasta localizar vector oficial | Referencia de alcance; no norma de uso del suelo. |
| AOI A y B | Polígonos de investigación por definir | Sin nivel hasta documentar fuente y método | No ejecutar intersecciones normativas. |
| Unidades de ordenamiento, usos y parámetros PMOT | Etapa 7, posiblemente planos/anexos | C/D hasta obtener cartografía normativa oficial o transformar plano con método | Investigación visual/documental; no resultado automático. |
| Patrimonio, costa, áreas protegidas, red hídrica y riesgo | Fuentes sectoriales oficiales por inventariar | Pendiente | Prioridad de búsqueda para AOI A y B. |

### Hallazgo PT-0.3 — La disponibilidad de PDF no equivale a capa oficial

La Etapa 7 tiene estructura suficiente para orientar la búsqueda de unidades,
usos y parámetros, pero su archivo publicado no sustituye una capa con
metadatos, escala, vigencia y acto de adopción. Si se georreferencia un plano,
su nivel será C y el resultado deberá conservar su error y método.

## 6. Dossiers de AOI: estado de preparación

| AOI | Estado | Evidencia para empezar | Dependencia antes del cruce |
|---|---|---|---|
| A — Centro tradicional y borde costero de San Felipe | `preseleccionado` | PMOT diagnóstico/formulación, referencias de Centro Histórico, costa, turismo y espacio público. | Delimitación consensuada, acto/plan patrimonial y capas oficiales pertinentes. |
| B — Núcleo de Yásica Arriba y transición rural | `preseleccionado` | PMOT diagnóstico/formulación, división administrativa, red hídrica/riesgo y contexto rural. | Delimitación consensuada y fuentes ambientales/rurales oficiales. |
| C — Maimón/Punta Bergantín | `condicional` | Referencias a turismo y posibles proyectos especiales. | Confirmar instrumento público, área y relación con el municipio/AOI. |

## 7. Próximas acciones verificables

1. Obtener desde fuente primaria el acto de adopción del PMOT, fecha de entrada
   en vigencia, documento consolidado y evidencia de validación técnica.
2. Inventariar los archivos de cartografía publicados en el portal PMOT:
   nombre, URL, formato, fecha, sistema de referencia, escala, cobertura y
   licencia.
3. Preparar el paquete RD mínimo: Ley 368-22, reglamento y Ley 176-07 con
   localizadores verificables.
4. Proponer los polígonos exactos de AOI A y B para aprobación, usando la fuente
   administrativa disponible y una justificación de alcance.
5. Abrir las primeras fichas de disposición: una territorial, una patrimonial y
   una ambiental/riesgo por AOI, sin marcar ninguna como conclusión definitiva.

## 8. Regla de salida de PT-0

El piloto puede pasar a PT-1 cuando el equipo pueda mostrar, para cada AOI, al
menos una fuente municipal, una fuente nacional, un actor competente, una
geometría con nivel conocido y un vacío explícito. Si el acto de adopción o la
cartografía normativa siguen ausentes, el piloto continúa como
**prediagnóstico de evidencia**, no como consulta normativa concluyente.
