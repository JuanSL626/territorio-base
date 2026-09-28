# Matriz de metodologías y decisiones de adopción

**Estado:** borrador v0.1 · **Fecha:** 2026-09-28
**Complementa:** [Marco Metodológico Base](01-marco-metodologico-base.md)

## 1. Propósito

Esta matriz convierte referencias externas en decisiones explícitas para
Territorio Base. No pretende certificar que una metodología sea válida para
República Dominicana o Colombia por el solo hecho de existir: separa sus
principios reutilizables de sus normas, indicadores, instituciones y escalas de
origen.

Cada referencia se evalúa según cinco preguntas:

1. ¿Qué problema resuelve?
2. ¿Cuál es su unidad de información verificable?
3. ¿Qué parte cambia una decisión de diseño de Territorio Base?
4. ¿Qué no debemos trasladar literalmente?
5. ¿Cuándo entra en el trabajo: ahora, piloto o etapa futura?

### Prioridades

| Prioridad | Significado |
|---|---|
| **P0 — fundacional** | Define el núcleo metodológico o una regla indispensable antes del piloto. |
| **P1 — piloto** | Debe aplicarse y validarse en un municipio de República Dominicana. |
| **P2 — evolución** | Informa escalabilidad, interoperabilidad o módulos que no deben bloquear el piloto. |

---

## 2. Matriz comparativa

| Referencia | Problema que aborda | Unidad verificable | Decisión que adopta Territorio Base | Límite de adopción | Prioridad |
|---|---|---|---|---|---|
| **PMOT Puerto Plata (2025)** | Diagnóstico municipal integrado, actores, normas y proyectos. | Ficha documental, actor, proyecto, hallazgo, indicador y ámbito. | La cadena `evidencia → hallazgo → implicación → decisión`, las fichas normativas y el análisis institucional. | No trasladar conclusiones, actores ni disposiciones locales de Puerto Plata. | P0 |
| **Banco Mundial / GFDRR (2022)**, [Urbanization and Territorial Development Review](https://documents1.worldbank.org/curated/en/099520007132233569/pdf/P172715065b95b0bc08ce70a7fe6442f014.pdf) | Urbanización, disparidades, marco territorial, capacidad municipal y vivienda a escala país. | Indicador territorial, instrumento, institución, capacidad, brecha y recomendación. | Medir la madurez territorial a partir de marco regulatorio, estructura institucional e información/capacidades; cruzada con legitimidad, capacidad y gobernanza. | Es una línea base 2022: no usarla para confirmar vigencia de la Ley 368-22 ni resolver condiciones de un predio. | P0 |
| **Kit de Ordenamiento Territorial — DNP Colombia**, [KitOT](https://portalterritorial.dnp.gov.co/KitOT/Content/uploads/C%20INTRODUCCION.pdf) | Formulación y actualización de POT/PBOT/EOT y POD. | Etapa, insumo, decisión, instrumento y producto de planificación. | Ciclo operativo: alistamiento, diagnóstico, formulación, implementación y seguimiento. | No imponer sus contenidos específicos a República Dominicana. | P0 |
| **Determinantes ambientales — MinAmbiente Colombia**, [serie oficial](https://www.minambiente.gov.co/ordenamiento-ambiental-territorial-y-sistema-nacional-ambiental/serie-documentos-para-el-ordenamiento-ambiental-territorial/) | Incorporación de condicionantes ambientales en POT y concertación institucional. | Determinante, figura jurídica, disposición, cartografía, régimen, actor, proyecto e instrumento de gestión/financiación. | Cada condicionante debe poder enlazar regla, autoridad competente, geografía, medida de manejo y acción de gestión. | No presuponer geometría pública, vigencia ni efecto equivalente fuera de Colombia. | P0 para Colombia |
| **IG-UTP — ONU-Hábitat**, [handbook](https://unhabitat.org/international-guidelines-on-urban-and-territorial-planning-ig-utp-handbook) | Calidad del proceso de planificación, articulación de escalas y gobernanza. | Proceso, decisión, actor, mecanismo de participación y resultado. | Evaluar calidad de decisión y de implementación, no solo producir mapas. | No convertir principios universales en requisitos jurídicos nacionales. | P1 |
| **ILUP/PLUD — FAO**, [Integrated Land-Use Planning](https://www.fao.org/land-water/land/land-governance-and-planning/integrated-land-use-planning/en) | Uso del suelo rural/periurbano, conflictos, participación y negociación. | Actor, interés, conflicto de uso, evidencia local, acuerdo y acción. | Registrar intereses divergentes, conflictos y evidencia participativa con origen y fecha. | La participación no reemplaza acto administrativo, cartografía oficial ni consulta competente. | P1 |
| **City Resilience Profiling Tool — ONU-Hábitat**, [guía](https://unhabitat.org/guide-to-the-city-resilience-profiling-tool) | Diagnóstico urbano multiamenaza, multisectorial y orientado a acción. | Sistema urbano, amenaza, exposición, vulnerabilidad, capacidad y acción. | Presentar riesgo como relación entre sistemas, no como una capa aislada; sostener línea base y priorización. | No crear un índice opaco de resiliencia en la primera versión. | P1 |
| **Disaster Resilience Scorecard — UNDRR**, [Scorecard](https://mcr2030.undrr.org/disaster-resilience-scorecard-cities) | Identificar brechas de resiliencia y convertirlas en plan de acción. | Criterio, evidencia, puntuación justificada, responsable, acción y seguimiento. | Usar una matriz de brecha: evidencia, responsable, prioridad, plazo y prueba de cierre. | No usar puntajes como sustituto de análisis, ni prometer una certificación. | P1 |
| **Planning Data — Inglaterra**, [documentación](https://www.planning.data.gov.uk/docs) | Publicar y consultar restricciones y datos de planificación de forma trazable. | Entidad, conjunto de datos, documento, organización, geometría, inicio/fin, calidad y cobertura. | Toda entidad espacial conserva `document-url`, fuente, fecha, cobertura, calidad y advertencia de ausencia de datos. | No adoptar la taxonomía inglesa ni inferir ausencia de restricción por ausencia de entidad. | P0 |
| **XPlanung — Alemania**, [estándar](https://www.digitale.planung.bayern.de/xplanung/) | Intercambio digital de planes legalmente significativos, incluso con vectorización parcial. | Plan, metadato, objeto espacial, norma/leyenda, documento raster o PDF y validación. | Permitir que metadatos estructurados y PDF/plano coexistan; una geometría derivada nunca suplanta al documento. | No implementar XPlanGML ni el marco jurídico alemán como dependencia del piloto. | P2 |
| **INSPIRE Land Use — Unión Europea**, [guía técnica](https://knowledge-base.inspire.ec.europa.eu/publications/inspire-data-specification-land-use-technical-guidelines_en) | Interoperabilidad del dato de uso del suelo. | Dataset, clasificación, geometría, metadato y servicio. | Mantener vocabularios versionados, metadatos de cobertura y equivalencias entre clasificaciones nacionales. | No importar el esquema europeo completo ni hacer equivalencias legales automáticas. | P2 |
| **UN-IGIF**, [marco](https://ggim.un.org/UN-IGIF/overview/) | Gobernanza, estándares, capacidades y sostenibilidad de información geoespacial. | Política, estándar, alianza, capacidad, servicio y plan de implementación. | Tratar actualización, alianzas, capacidades y estándares como parte del producto, no como operación invisible. | No intentar construir una infraestructura nacional antes de probar el caso municipal. | P2 |

---

## 3. Decisiones ya tomadas

### D-01 — Núcleo común de evidencia

Territorio Base conservará como objetos independientes: `Documento`,
`Disposición`, `Actor/Competencia`, `ÁmbitoEspacial`,
`EvidenciaGeográfica`, `Hallazgo`, `Acción` y `Proyecto`.

**Fundamento:** PMOT, Planning Data, XPlanung y determinantes ambientales.

### D-02 — La geografía tiene niveles de evidencia

Una disposición puede ser vigente sin tener polígono. La plataforma aplicará los
niveles A–E definidos en el Marco Metodológico Base; solo la geometría adecuada
para análisis automático puede producir una intersección.

**Fundamento:** PMOT, Planning Data y XPlanung.

### D-03 — Ausencia no significa permiso

La falta de una capa, de un registro o de un documento no se mostrará como
ausencia de condicionantes. Se mostrará como cobertura o evidencia insuficiente.

**Fundamento:** Planning Data y la práctica de fichas críticas del PMOT.

### D-04 — Normativa, diagnóstico y gestión son capas distintas

Una regla no es un hallazgo; una intersección no es un permiso; una acción de
gestión no modifica una norma. Las relaciones serán explícitas y auditables.

**Fundamento:** PMOT, MinAmbiente Colombia y UNDRR.

### D-05 — Madurez territorial como lectura complementaria

La plataforma incorporará, inicialmente como una ficha cualitativa y no como
índice numérico, tres bloques de madurez:

| Bloque | Pregunta de diagnóstico |
|---|---|
| Marco regulatorio | ¿Existen instrumentos vigentes, jerarquizados y articulados? |
| Estructura institucional | ¿Hay competencias, coordinación, presupuesto y capacidad técnica para aplicarlos? |
| Información y capacidades | ¿Hay información suficiente, a escala adecuada, actualizable y comprensible? |

Estos bloques se observarán bajo tres condiciones: legitimidad/relevancia,
factibilidad/capacidad y efectividad/gobernanza/participación.

**Fundamento:** estudio del Banco Mundial/GFDRR. No constituye una calificación
del municipio ni una auditoría institucional.

### D-06 — Conflictos e intereses son información de primer orden

Un conflicto de usos, un interés comunitario o una observación sectorial se
guardará con fuente, fecha, actor, escala y evidencia. Podrá desencadenar una
tarea de validación, pero no modificará por sí solo el régimen jurídico.

**Fundamento:** FAO ILUP/PLUD e IG-UTP.

### D-07 — Paquetes nacionales versionados

República Dominicana y Colombia compartirán el núcleo, pero cada una tendrá
vocabularios, jerarquías documentales, fuentes, instituciones, procesos y
equivalencias propios. `Suelo urbanizable` o `determinante ambiental` serán
conceptos del paquete de país, no columnas universales.

**Fundamento:** KitOT, MinAmbiente Colombia e INSPIRE.

---

## 4. Exclusiones deliberadas de la primera versión

| Exclusión | Motivo |
|---|---|
| Dictamen automático de edificabilidad, uso permitido o concesión de permiso | Requiere interpretación jurídica, expedientes y autoridad competente. |
| Digitalización masiva de todos los PDF | Antes se valida qué instrumentos, escalas y geometrías tienen utilidad y calidad suficiente. |
| Índice único de madurez o resiliencia | Oculta evidencia y puede dar una apariencia engañosa de precisión. |
| Equivalencia directa RD ↔ Colombia | Las categorías similares pueden tener jerarquía, competencia y efecto distintos. |
| Implementación completa de estándares XPlanung/INSPIRE | Son referencias de interoperabilidad, no el alcance del piloto. |
| Mostrar información comunitaria como norma oficial | Debe conservar su naturaleza, procedencia y límites. |

---

## 5. Backlog metodológico priorizado

### P0 — Antes de diseñar la base de datos

1. Escribir el glosario de entidades y relaciones del núcleo común.
2. Diseñar la ficha documental y la ficha de disposición con ejemplos reales.
3. Definir el protocolo A–E para evidencia espacial, incluida
   georreferenciación de PDF.
4. Establecer la matriz de madurez territorial cualitativa.
5. Inventariar fuentes oficiales y jerarquía documental de República Dominicana.

**Salida:** especificación de datos conceptual v0.1 y protocolo editorial.

### P1 — Piloto República Dominicana

1. Seleccionar municipio, AOI y fecha de corte.
2. Cargar un conjunto limitado de instrumentos críticos y sus fuentes.
3. Validar actores, competencias, procesos y mecanismos de coordinación.
4. Registrar ámbitos espaciales A–E y comprobar un flujo de intersección.
5. Convertir tres a cinco hallazgos en acciones verificables.

**Salida:** caso completo y revisable, no una cobertura nacional incompleta.

### P2 — Escalabilidad y Colombia

1. Definir mapeos de equivalencia entre paquetes nacionales sin aplanar sus
   diferencias jurídicas.
2. Diseñar importación/exportación de datos y metadatos interoperables.
3. Crear el paquete Colombia usando POT/PBOT/EOT, determinantes ambientales,
   autoridades ambientales e instrumentos de gestión.
4. Revisar las necesidades de actualización, alianzas y gobernanza de datos.

**Salida:** segundo piloto país con el mismo núcleo y trazabilidad comparable.

---

## 6. Criterios para pasar al diseño técnico

No se debe crear persistencia, APIs ni pantallas definitivas hasta que el equipo
pueda responder, usando un ejemplo real, a estas preguntas:

1. ¿Cuál es la fuente primaria y la versión del documento?
2. ¿Qué disposición exacta estamos presentando y dónde se encuentra?
3. ¿Quién tiene competencia sobre ella y qué proceso aplica?
4. ¿Cuál es el ámbito espacial y qué nivel A–E tiene su evidencia?
5. ¿Qué afirma el sistema, qué no sabe y qué validación falta?
6. ¿Qué acción concreta puede ejecutar una persona responsable?

Si alguna respuesta no puede conservarse en los datos, el modelo aún no está
listo para implementarse.

---

## 7. Próximo documento

El siguiente artefacto será la **Especificación de Datos Conceptual v0.1**. Debe
traducir las decisiones D-01 a D-07 en definiciones, atributos mínimos,
relaciones, estados de validación y ejemplos de República Dominicana, sin elegir
todavía una tecnología de persistencia.
