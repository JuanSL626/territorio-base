# Marco Metodológico Base — Territorio Base

**Estado:** borrador v0.1 · **Fecha:** 2026-09-28
**Propósito:** definir un método repetible para investigar, estructurar y
comunicar condicionantes territoriales, normativos e institucionales. El núcleo
debe servir primero a República Dominicana y después a Colombia, sin cambiar la
forma en que se conserva la evidencia.

> Territorio Base no determina que un predio sea edificable, que una actividad
> esté permitida ni que una licencia será concedida. Organiza evidencia para la
> prefactibilidad y hace visibles sus fuentes, alcance, incertidumbres y
> responsables de validación.

---

## 1. El problema que resuelve

Un análisis territorial útil reúne información que normalmente vive separada:
cartografía, leyes, planes, actos administrativos, expedientes, instituciones,
proyectos y conocimiento local. Una capa sin su acto de origen no explica su
fuerza jurídica; una norma sin ámbito espacial puede no ser aplicable a un área;
un actor sin competencia ni proceso asociado es solo un nombre en un diagrama.

El producto debe conservar la cadena completa:

```text
fuente oficial
  → documento e instrumento vigente
    → disposición verificable
      → actor competente y proceso de gestión
        → ámbito espacial y calidad de su geometría
          → intersección con el AOI
            → hallazgo, límite u oportunidad
              → acción y validación humana necesaria
```

La ausencia de una entidad, una geometría o un resultado nunca equivale por sí
misma a que no exista una restricción.

## 2. Principios de diseño

1. **Evidencia antes que conclusión.** Toda afirmación relevante conserva
   fuente, versión, fecha de consulta y localización precisa: artículo, página,
   tabla, anexo o URL.
2. **Separar derecho, interpretación y geografía.** Una disposición jurídica,
   su lectura operativa y su geometría son objetos distintos que deben poder
   actualizarse independientemente.
3. **Gradualidad y trazabilidad.** Se publica lo que existe, se indica lo que
   falta y se mejora sin ocultar incertidumbre.
4. **Primacía de la fuente competente.** Los datos derivados o de terceros
   ayudan a descubrir y contrastar; no sustituyen un acto, plano o servicio
   oficial.
5. **Aplicación condicionada.** Una intersección espacial identifica una posible
   condicionante; la aplicabilidad definitiva depende de vigencia, jurisdicción,
   jerarquía, excepciones y autoridad competente.
6. **Escalabilidad por configuración.** El modelo base no contiene nombres de
   ministerios ni categorías nacionales como columnas fijas. Esos elementos
   pertenecen a un paquete de país versionado.
7. **Participación como evidencia.** La información de comunidad, academia y
   sectores productivos puede revelar conflictos o datos faltantes; se registra
   con procedencia y no se presenta como norma oficial.

## 3. Flujo metodológico

### Fase 0 — Alistamiento territorial

Definir el área de interés (AOI), fecha de corte, propósito de consulta y nivel
de detalle. Resolver las jurisdicciones que intersectan el AOI: municipio o
distrito, provincia/departamento, región, áreas especiales y autoridades
sectoriales pertinentes.

**Salida:** ficha de consulta y mapa de jurisdicciones con sus fuentes.

### Fase 1 — Inventario y verificación de fuentes

Construir un inventario de leyes, decretos, ordenanzas, instrumentos de
planificación, licencias o declaratorias, proyectos públicos y bases de datos.
Para cada fuente se comprueba autoridad emisora, fecha, estado de vigencia,
jurisdicción, versión, URL oficial y condiciones de acceso/uso.

**Salida:** registro documental; no se extraen conclusiones todavía.

### Fase 2 — Extracción de disposiciones y competencias

Una ficha documental describe el instrumento completo. Luego se extraen solo
las disposiciones que puedan afectar la consulta: clasificación/calificación del
suelo, usos, densidades, alturas, retiros, protección, gestión de riesgo,
patrimonio, infraestructura, procesos, permisos o participación.

Cada disposición queda vinculada a:

- el fragmento exacto de su fuente;
- su tema y efecto operativo potencial;
- el actor que la emite, implementa, autoriza, controla o consulta;
- sus condiciones, excepciones y fecha de efecto conocidas.

**Salida:** catálogo de disposiciones y matriz de competencias.

### Fase 3 — Localización y calidad espacial

Localizar cada ámbito espacial usando primero una capa oficial editable. Si no
existe, se documenta si hay cartografía oficial, plano escaneado o solamente
descripción textual. Georreferenciar una imagen es una transformación derivada,
no una nueva fuente oficial.

| Nivel | Tipo de evidencia espacial | Uso permitido en la plataforma |
|---|---|---|
| A | Geometría oficial, descargable o servida por la autoridad | Puede alimentar análisis automático, siempre con vigencia y cobertura visibles. |
| B | Cartografía oficial digital sin geometría editable | Visualización y análisis condicionado; requiere método de extracción documentado. |
| C | Plano/PDF georreferenciado por Territorio Base | Exploración y prediagnóstico; mostrar puntos de control, error, autor y fecha. |
| D | Delimitación descrita solo en texto | Señal informativa; no produce intersecciones automáticas. |
| E | Sin localización verificable | Se conserva como vacío de evidencia y posible tarea de investigación. |

**Salida:** registro de ámbito espacial y, si aplica, una transformación
geográfica reproducible.

### Fase 4 — Diagnóstico integrado

Cruzar únicamente geometrías aptas con el AOI y presentar los resultados por
dimensión: natural/riesgo, construido y funcional, socioeconómica, normativa,
institucional y proyectos. Cada hallazgo debe diferenciar:

- **hecho observado:** por ejemplo, el AOI intersecta una geometría A;
- **condicionante identificado:** existe una disposición potencialmente
  aplicable;
- **incertidumbre:** faltan datos, plano preciso, vigencia confirmada o
  interpretación competente;
- **siguiente acción:** documento, autoridad o validación necesarios.

**Salida:** matriz de hallazgos, no un dictamen.

### Fase 5 — Gestión, priorización y seguimiento

Convertir los hallazgos validados en acciones: consultar autoridad, obtener
plano, solicitar certificación, coordinar actores, actualizar un instrumento o
considerar un proyecto. Cada acción tiene responsable, prioridad, plazo,
dependencias, evidencia de cierre y estado.

**Salida:** agenda de gestión y tablero de seguimiento.

## 4. Ficha documental mínima

| Grupo | Campos requeridos |
|---|---|
| Identidad | título oficial, tipo de instrumento, emisor, identificador, enlace oficial, fecha de emisión/aprobación, versión y vigencia |
| Alcance | escala/jurisdicción, territorio al que aplica, temas, población o activos afectados |
| Contenido | objetivo, disposiciones relevantes, fragmento citables, excepciones conocidas |
| Aplicación | posible efecto territorial, relación con otros instrumentos, procesos o permisos relacionados |
| Crítica | barreras, vacíos, contradicciones, facilitadores, nivel de confianza y tareas pendientes |
| Gestión | actores emisores, competentes, consultados y afectados; mecanismo de coordinación |
| Espacio | ámbito espacial, fuente geométrica, nivel A–E, fecha, cobertura y método de georreferenciación si existe |

La ficha inicial del [mapa de actores de República Dominicana](../normativa/01-mapa-actores-rd.md)
es un antecedente y se ampliará con esta estructura.

## 5. Modelo conceptual común

Estos son conceptos de negocio, no una propuesta cerrada de tablas ni una
decisión de base de datos.

```text
Pais ──< Jurisdiccion ──< Instrumento ──< Documento ──< Disposicion
                                      │                  │
                                      │                  ├──< Competencia >── Actor
                                      │                  ├──< AmbitoEspacial >── EvidenciaGeografica
                                      │                  └──< RequisitoProceso >── ProcesoGestion
AOI ──< Interseccion >── AmbitoEspacial ──< Hallazgo ──< Accion
Proyecto ──< AmbitoEspacial / Actor / Hallazgo
```

| Entidad | Función |
|---|---|
| `País` / `PaquetePaís` | Vocabularios, jerarquías, fuentes, instituciones y flujos propios de cada país. |
| `Jurisdicción` | Unidad territorial y autoridad que puede cambiar la aplicación de una regla. |
| `Instrumento` | Familia normativa o de planificación: ley, POT, PMOT, ordenanza, plan sectorial, declaratoria, licencia, etc. |
| `Documento` | Versión concreta y verificable de un instrumento o fuente técnica. |
| `Disposición` | Regla atómica extraída con cita, condición, tema y efecto potencial. |
| `Actor` y `Competencia` | Organización, unidad, sector, escala, rol, atribución, capacidad y relación. |
| `ÁmbitoEspacial` | Territorio, elemento, zona o perímetro al que se refiere una regla o proyecto. |
| `EvidenciaGeográfica` | Archivo/servicio, geometría, calidad A–E, licenciamiento, método y trazabilidad. |
| `ProcesoGestión` | Consulta, certificación, concepto, licencia, concertación, participación o actualización. |
| `Proyecto` | Intervención existente, propuesta o en ejecución que puede condicionar decisiones. |
| `Hallazgo` / `Acción` | Resultado interpretativo siempre enlazado a evidencia y su siguiente paso gestionable. |

## 6. Paquetes de país

El núcleo no asume que todos los países llamen igual al suelo, a sus planes o a
sus autoridades. Cada paquete conserva equivalencias sin forzar identidades
falsas.

### República Dominicana — primer paquete

Prioridades iniciales:

- jerarquía de leyes, decretos, resoluciones, planes y ordenanzas;
- clasificación/calificación del suelo y planes municipales;
- Ayuntamiento, MEPyD, MIVED, Ministerio de Medio Ambiente, patrimonio,
  infraestructura, catastro y Registro Inmobiliario;
- fuentes oficiales de planes, delimitaciones, riesgo, áreas protegidas y
  documentos municipales;
- procesos que exigen consulta oficial en vez de inferencia automática.

### Colombia — segundo paquete

Prioridades de adaptación:

- POT, PBOT y EOT; sus documentos técnicos, cartografía y acuerdos de adopción;
- clasificación del suelo (urbano, rural y expansión, entre otras categorías
  aplicables al instrumento) y tratamientos/normas urbanísticas;
- determinantes ambientales, concertación con autoridades ambientales y
  relación con programas, proyectos, gestión y financiación;
- municipio/distrito, departamento, CAR, autoridad ambiental, curadurías cuando
  correspondan y entidades nacionales;
- instrumentos de gestión y financiación del suelo, planes parciales y
  procedimientos de consulta o licencia que requieran autoridad competente.

El paquete colombiano se diseñará contra fuentes primarias vigentes, no por
traslado literal del paquete dominicano.

## 7. Referentes y decisiones de abstracción

| Referente | Aporte que se adopta | No se copia literalmente |
|---|---|---|
| PMOT Puerto Plata (diagnóstico institucional, archivo de referencia local) | cadena evidencia → diagnóstico → implicación → decisión; fichas documentales y mapa de actores | sus conclusiones, actores y normas locales |
| [KitOT — DNP Colombia](https://portalterritorial.dnp.gov.co/KitOT/Content/uploads/C%20INTRODUCCION.pdf) | ciclo alistamiento, diagnóstico, formulación, implementación y seguimiento | categorías o requerimientos particulares sin validar vigencia |
| [MinAmbiente Colombia — determinantes ambientales](https://www.minambiente.gov.co/ordenamiento-ambiental-territorial-y-sistema-nacional-ambiental/serie-documentos-para-el-ordenamiento-ambiental-territorial/) | conectar determinante, figura jurídica, cartografía, régimen, gestión, financiación y proyecto | asumir que toda determinante tiene geometría pública |
| [IG-UTP — ONU-Hábitat](https://unhabitat.org/international-guidelines-on-urban-and-territorial-planning-ig-utp-handbook) | calidad del proceso, gobernanza y articulación multinivel | un modelo institucional único |
| [ILUP/PLUD — FAO](https://www.fao.org/land-water/land/land-governance-and-planning/integrated-land-use-planning/en) | participación, conflicto de usos, ruralidad y revisión iterativa | mecanismos de participación sin contexto local |
| [City Resilience Profiling Tool](https://unhabitat.org/guide-to-the-city-resilience-profiling-tool) | diagnóstico multiamenaza, multisectorial y orientado a acción | un índice de resiliencia como resultado único |
| [UNDRR Scorecard](https://mcr2030.undrr.org/disaster-resilience-scorecard-cities) | brechas → responsables → acciones priorizadas → seguimiento | puntajes como sustituto de evidencia |
| [Planning Data](https://www.planning.data.gov.uk/docs) | entidad geográfica con documento, fecha, calidad, cobertura y advertencia de ausencia de datos | sus taxonomías inglesas |
| [XPlanung](https://www.digitale.planung.bayern.de/xplanung/) | coexistencia de metadatos estructurados, geometría y PDF/raster cuando la vectorización es parcial | su formato técnico alemán como requisito del producto |
| [INSPIRE Land Use](https://knowledge-base.inspire.ec.europa.eu/publications/inspire-data-specification-land-use-technical-guidelines_en) | vocabulario e interoperabilidad para información de uso del suelo | su esquema europeo completo en la primera versión |
| [UN-IGIF](https://ggim.un.org/UN-IGIF/overview/) | gobierno de datos, estándares, alianzas, capacidades y sostenibilidad | una implementación nacional antes de validar el piloto |

## 8. Qué se puede y no se puede automatizar

| Automático o asistido | Revisión humana o competente obligatoria |
|---|---|
| detectar jurisdicciones y cruzar geometrías A; registrar versión, fecha y URL; alertar documentos vencidos; localizar texto y proponer extracción; mostrar coberturas y vacíos | interpretar jerarquía/conflicto de normas; establecer edificabilidad o permiso; validar una georreferenciación; resolver límites ambiguos; definir aplicabilidad final; confirmar requisitos del trámite |

La interfaz debe explicar el límite en el mismo lugar donde muestra el
resultado, no esconderlo en una nota legal al final.

## 9. Hoja de ruta

### Hito 1 — Especificación y vocabulario

1. Validar este marco con planificación, derecho urbano/ambiental y SIG.
2. Construir una matriz detallada de los referentes de la sección 7.
3. Definir el glosario común y las equivalencias por país.

**Criterio de salida:** cada concepto del modelo tiene definición, ejemplo,
propietario de dato y límite de interpretación.

### Hito 2 — Piloto documental en República Dominicana

1. Seleccionar un municipio y un AOI de prueba.
2. Registrar un conjunto pequeño de instrumentos de alta prioridad.
3. Crear fichas, disposiciones y evidencias espaciales A–E.
4. Validar el mapa de actores y el flujo de consulta con una contraparte local.

**Criterio de salida:** un hallazgo puede recorrerse de vuelta hasta su fuente,
y las incertidumbres aparecen antes de cualquier conclusión.

### Hito 3 — Producto mínimo

1. Diseñar persistencia y permisos de edición después del piloto.
2. Mostrar registro documental, mapa de actores, evidencia espacial y matriz de
   hallazgos.
3. Incorporar tareas de validación y actualización.

**Criterio de salida:** el sistema conserva procedencia, no convierte ausencia
en autorización y permite actualizar una fuente sin reescribir el diagnóstico.

### Hito 4 — Adaptación Colombia

1. Elaborar el paquete Colombia con especialistas y fuentes oficiales vigentes.
2. Probar el núcleo con POT/PBOT/EOT y determinantes ambientales de un
   municipio piloto.
3. Ajustar equivalencias sin modificar el historial del paquete dominicano.

**Criterio de salida:** los dos países comparten el núcleo y producen salidas
comparables, pero mantienen su vocabulario, fuentes y autoridades propias.

## 10. Decisiones pendientes

- Definir el primer municipio piloto y las contrapartes de validación.
- Acordar la política editorial: quién puede crear, revisar, aprobar y archivar
  fichas y disposiciones.
- Establecer tolerancias y protocolo para georreferenciación de planos PDF.
- Confirmar licencias, acceso y actualización de fuentes municipales.
- Diseñar un mecanismo para registrar conflicto entre fuentes sin ocultarlo.
- Decidir cuándo una ficha pasa de investigación interna a publicación.

---

Este documento define una metodología y no sustituye la revisión jurídica,
urbanística, ambiental, catastral o registral requerida para una decisión real.
