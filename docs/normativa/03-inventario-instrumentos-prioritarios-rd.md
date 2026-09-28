# Inventario priorizado de instrumentos — República Dominicana

**Estado:** v0.1 · registro de investigación, no dictamen jurídico  
**Fecha de corte:** 2026-09-28  
**Marco:** [Sistema de normativa, planificación y gestión](02-sistema-normativo-y-de-gestion-rd.md)

## 1. Alcance y lectura correcta

Este inventario es el primer paquete reutilizable de República Dominicana para
Territorio Base. Prioriza instrumentos y fuentes que permiten investigar un AOI
sin confundir una referencia nacional con una regla aplicable a un predio.

No certifica vigencia integral, derogatorias, modificaciones, exigibilidad ni
orden de trámites. Esas conclusiones requieren cotejar el texto, sus
modificaciones, el acto competente y las circunstancias del caso. En especial,
un plan municipal o un plano técnico solo pasa a `aplicable potencialmente`
cuando se localizan su acto de adopción, fecha de entrada en vigencia y ámbito
espacial.

### Estados de la fuente

| Estado | Significado editorial |
|---|---|
| **P — primaria localizada** | Se encontró ley, acto o publicación normativa de primera fuente. Aún se registra revisión de modificaciones/vigencia cuando sea necesaria. |
| **I — institucional localizada** | Se encontró una fuente oficial del actor que describe servicio, competencia, requisito o dato; falta localizar el acto/regla precisa si se va a aplicar. |
| **M — municipal pendiente** | La fuente nacional existe, pero el instrumento concreto, su adopción o su cartografía se deben verificar ante el ayuntamiento. |
| **D — dato de referencia** | Fuente geoespacial/estadística útil para ubicar o contextualizar; no es por sí misma norma de uso del suelo. |
| **C — condicionada** | Solo entra al expediente si la localización, tipo de proyecto o proceso activa su análisis. |

## 2. Inventario inicial

| ID | Instrumento / evidencia | Familia y qué permite investigar | Actor(es) a mapear | Activación | Fuente de partida | Estado / siguiente verificación |
|---|---|---|---|---|---|---|
| RD-OT-001 | [Ley 368-22 de Ordenamiento Territorial, Uso de Suelo y Asentamientos Humanos](https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3400549&managementType=1) | Marco de ordenamiento, uso de suelo, asentamientos e información territorial. | Congreso/Poder Ejecutivo, MEPyD, gobiernos locales y autoridades sectoriales según disposición. | Nuclear. | Publicación de la Consultoría Jurídica. | **P**. Indexar artículos relevantes por tema y cotejar vigencia/modificaciones antes de extraer reglas. |
| RD-OT-002 | [Reglamento de aplicación de la Ley 368-22](https://mepyd.gob.do/publicacion/reglamento-de-aplicacion-ley-no-368-22-de-ordenamiento-territorial) | Desarrollo operativo de instrumentos, actores y procesos de ordenamiento. | MEPyD, ayuntamientos y actores que el reglamento designe. | Nuclear cuando se estudien instrumentos de ordenamiento. | Publicación MEPyD. | **I**. Obtener identificador del acto, versión consolidada y artículos/análogos aplicables. |
| RD-OT-003 | [Ley 176-07 del Distrito Nacional y los Municipios](https://consultoria.gov.do/Consulta/Home/FileManagement?documentId=3345180&managementType=1) | Competencias y organización del gobierno local; punto de partida para plan, ordenanza y gestión municipal. | Ayuntamiento, concejo municipal, distritos municipales y órganos locales pertinentes. | Nuclear en todo AOI municipal. | Publicación de la Consultoría Jurídica. | **P**. Relacionar artículos con el instrumento y trámite municipal específicos. |
| RD-OT-004 | PMOT, ordenanza, reglamento urbano y cartografía del municipio | Modelo local, unidades, clasificación/calificación, parámetros, espacio público o gestión, si el instrumento lo contempla. | Ayuntamiento y órgano que adopta/valida según corresponda. | Nuclear, pero varía por municipio. | Portal municipal, gaceta/acto o solicitud formal. | **M**. Exigir acto de adopción, vigencia, versión consolidada, plano/leyenda y metadatos antes de espacializar efectos. |
| RD-OT-005 | [División Territorial 2020 de la ONE](https://www.one.gob.do/publicaciones/2021/division-territorial-2020/) | Jurisdicción administrativa de referencia para ubicar AOI y autoridades. | ONE, municipio y fuente legal de división si se requiere precisión. | Nuclear. | Publicación ONE. | **D**. Localizar vector/servicio, fecha, escala y CRS; no usar como límite de zonificación o predial. |
| RD-AM-001 | [Ley 64-00 General sobre Medio Ambiente y Recursos Naturales](https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3334621&managementType=1) | Marco ambiental, responsabilidades y relación entre ambiente, recursos naturales y desarrollo. | Ministerio de Medio Ambiente, ayuntamiento y autoridad sectorial pertinente. | Nuclear como marco; aplicación concreta condicionada. | Publicación de la Consultoría Jurídica. | **P**. Extraer solo disposiciones vinculadas a la consulta y verificar modificaciones/reglamentos específicos. |
| RD-AM-002 | [Autorizaciones ambientales](https://ambiente.gob.do/autorizaciones-ambientales/servicios/autorizaciones-ambientales/) y [términos de referencia](https://serviciosdigitales.ambiente.gob.do/tdr/) | Ruta administrativa, requisitos iniciales y estudios/expedientes ambientales posibles. | Ministerio de Medio Ambiente. | **C**: proyecto, actividad o condición ambiental que requiera evaluación. | Servicios oficiales del Ministerio. | **I/C**. Registrar categoría y requisitos solo cuando la autoridad o la fuente vigente los confirme para el caso. |
| RD-AM-003 | [Mapas de áreas protegidas](https://ambiente.gob.do/informacion-ambiental/areas-protegidas/mapas/) | Localización de figuras ambientales publicadas y necesidad de buscar su acto/régimen. | Ministerio de Medio Ambiente y autoridad/administrador de la figura. | **C**: intersección o proximidad verificable. | Publicación oficial de mapas. | **I/C**. Conseguir acto, delimitación digital, escala, fecha y régimen; el mapa web no basta para concluir aplicabilidad. |
| RD-RI-001 | Gestión integral del riesgo: [estructura y funciones de Defensa Civil](https://defensacivil.gob.do/transparencia/index.php/organigrama/organigrama-dinamico) | Planes, coordinación, información y medidas de prevención, mitigación y respuesta. | CNE, Defensa Civil, municipio y comité territorial pertinente. | **C**: amenaza, exposición, infraestructura crítica o planeación de emergencia. | Fuente institucional; la referencia legislativa de partida es Ley 147-02. | **I/C**. Localizar texto primario y normativa vigente, plan/mapa con método, cobertura y autoridad productora. |
| RD-ED-001 | [Ley 160-21 que crea el Ministerio de Vivienda y Edificaciones](https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3398300&managementType=1) | Rectoría sectorial de vivienda, hábitat y edificaciones. | MIVED, ayuntamiento y profesionales habilitados. | **C**: proyecto de edificación. | Publicación de la Consultoría Jurídica. | **P/C**. Vincular modalidad de licencia y requisitos técnicos actuales, no solo la ley de creación. |
| RD-ED-002 | [Servicios/competencias de MIVED](https://map.gob.do/COEDOM/Home/Details/181?Ruta=1) | Requisitos de licencia, habilitaciones y estudios técnicos que se deban consultar. | MIVED y profesionales/entidades habilitadas. | **C**: proyecto de edificación. | Catálogo institucional del Estado. | **I/C**. Capturar versión del requisito aplicable y evidencia de habilitación por tipo de proyecto. |
| RD-MOV-001 | [MOPC: competencias institucionales](https://map.gob.do/COEDOM/Home/Details/119?Ruta=2) | Red pública, acceso, intervención vial, derecho de vía o infraestructura bajo su competencia. | MOPC, titular de la vía y ayuntamiento. | **C**: acceso/conexión/intervención o colindancia con infraestructura pública. | Catálogo institucional del Estado. | **I/C**. Identificar titularidad, afectación, norma o autorización específica. |
| RD-MOV-002 | [Requerimientos de impacto de tráfico del INTRANT](https://intrant.gob.do/movilidad/index.php/estudios/impacto-de-trafico/item/download/13_e72c806e07c6ee9073e80ce56cfca0f1) | Estudios y evaluación de impacto de tráfico para desarrollos que alcancen los criterios indicados por la fuente vigente. | INTRANT, MOPC, ayuntamiento y profesional habilitado. | **C**: tipología, intensidad, estacionamientos o acceso que active el requisito. | Documento institucional INTRANT. | **I/C**. Comprobar versión, umbrales y relación con el proyecto antes de marcarlo como requerido. |
| RD-AG-001 | [Ley 5852 sobre Dominio de Aguas Terrestres y Distribución de Aguas Públicas](https://transparencia.indrhi.gob.do/Descargar/1596/leyes-principales/11113/ley-5852-62-sobre-dominio-de-aguas-terrestres-y-distribucion-de-aguas-publicas.pdf) | Marco de referencia sobre aguas públicas y aprovechamientos; no sustituye la consulta sectorial actual. | INDRHI y entidades competentes según recurso/servicio. | **C**: captación, cauce, obra hidráulica, drenaje, descarga o uso de agua. | Publicación institucional INDRHI. | **P/C**. Confirmar reglamentación y procedimiento vigente para el tipo de aprovechamiento/intervención. |
| RD-AG-002 | [Documentos y atlas de recursos hídricos del INDRHI](https://indrhi.gob.do/documentos/) | Contexto de recursos, cuencas y obras; búsqueda de datos y estudios sectoriales. | INDRHI, prestador de agua/saneamiento y municipio competente. | **C**: relación hídrica o demanda de servicios. | Portal documental institucional. | **I/C**. Distinguir atlas/contexto de permiso, disponibilidad de servicio y delimitación de cauce. |
| RD-PAT-001 | [Funciones de la Dirección Nacional de Patrimonio Monumental](https://www.cultura.gob.do/transparencia/phocadownload/Organigrama2021/new/DIRECCIN_NACIONALDE_PATRIOMONIO_MONUMENTAL.pdf) | Protección, estudios, planes, autorizaciones e inspección de bienes monumentales dentro de su ámbito. | Ministerio de Cultura / DNPM y ayuntamiento. | **C**: declaratoria, inventario, centro histórico, bien o entorno patrimonial a verificar. | Documento institucional de funciones. | **I/C**. Localizar declaratoria/plan regulador, perímetro y trámite concreto; no inferir régimen por cercanía. |
| RD-TEN-001 | [Ley 108-05 y marco legal del Registro Inmobiliario](https://ri.gob.do/?page_id=606) | Registro de derechos, títulos, mensuras y actuaciones inmobiliarias; no define el uso permitido. | Registro Inmobiliario, Registro de Títulos y Mensuras Catastrales. | **C**: predio identificado, adquisición, certificación o expediente. | Marco legal oficial del Registro Inmobiliario. | **P/C**. Obtener certificación/actuación concreta y registrar fecha; no usar geometría de usuario como prueba de dominio. |
| RD-TEN-002 | [Reglamentos y disposiciones técnicas del Registro Inmobiliario](https://logros.ri.gob.do/index.php/descarga/) | Requisitos y procedimientos técnicos/registrales actualizados. | Registro Inmobiliario. | **C**: actuación registral o mensura concreta. | Repositorio institucional. | **I/C**. Seleccionar la disposición vigente por trámite y conservar versión/fecha de entrada en vigencia. |
| RD-DAT-001 | [SIGEO RD y datos ambientales publicados](https://ambiente.gob.do/medio-ambiente-balance-gestion-proteccion-ambiental-2025-2026/) | Fuente a investigar para capas ambientales georreferenciadas, junto a sus metadatos y reglas de uso. | Ministerio de Medio Ambiente / productor de cada capa. | Cuando una capa sectorial apoye el diagnóstico. | Comunicación institucional sobre la plataforma. | **I/D**. Localizar servicio/dataset directo, licencia, fecha, escala, CRS, cobertura y responsable antes de análisis automático. |
| RD-PAR-001 | Participación territorial en el marco de la [Ley 368-22](https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3400549&managementType=1) | Participación, observaciones, conflictos y acuerdos asociados a planificación y gestión. | Ayuntamiento, MEPyD, comunidades, sector privado, academia y sociedad civil. | Transversal: proceso participativo o evidencia territorial aportada. | Texto legal y actas/convocatorias concretas. | **P** para el marco; **M/I** para cada proceso. Conservar procedencia, fecha y representatividad sin tratarlo como norma. |

## 3. Instrumentos expresamente separados del paquete nacional

Estos elementos son indispensables para una consulta municipal, pero no se
pueden completar de forma responsable con una búsqueda nacional:

| Elemento | Por qué no se debe generalizar | Evidencia mínima requerida |
|---|---|---|
| PMOT y ordenanzas locales | Pueden tener nombres, contenido, estado jurídico y cartografía distintos por municipio. | Documento consolidado, acto de adopción, fecha de vigencia, plano/leyenda y fuente municipal. |
| Certificación/consulta de uso de suelo | El servicio y sus requisitos pueden diferir por ayuntamiento. | Requisito municipal vigente, respuesta/certificación y predio identificado. |
| Área protegida, patrimonio, franja o servidumbre concreta | La figura debe tener acto, perímetro y régimen propios. | Acto de origen, geografía con nivel A–E y autoridad competente. |
| Derecho de vía, acceso o red de servicio | Depende del titular de la infraestructura y del proyecto. | Identificación de titularidad, plano/afectación y requisito específico. |
| Título, carga, mensura o límite predial | La evidencia es individual, con posibles restricciones de acceso. | Certificación o plano oficial actualizado. |
| Proyecto de inversión | El anuncio no equivale a proyecto aprobado ni a delimitación oficial. | Entidad responsable, acto/instrumento, estado, horizonte y área verificable. |

## 4. Cómo pasa un registro a disposición o capa espacial

El inventario no se carga directamente como una regla del mapa. Cada registro
debe pasar estas puertas:

```text
instrumento priorizado
  → fuente primaria o institucional identificada
    → versión / estado jurídico verificados para el caso
      → disposición o requisito con localizador exacto
        → actor y condición de activación
          → ámbito espacial con calidad A–E, o vacío explícito
            → hallazgo condicionado y siguiente acción
```

La extracción inicial del piloto debe tomar solo tres disposiciones, una por
grupo, para probar el modelo sin simular completitud nacional:

1. una territorial/municipal;
2. una ambiental, de riesgo o hídrica;
3. una de gestión del desarrollo (edificación, movilidad, patrimonio o tenencia)
   activada por el AOI.

## 5. Backlog de verificación

### P0 — habilita el piloto municipal

1. Localizar y registrar los artículos específicos de Ley 368-22, su reglamento
   y Ley 176-07 que describen instrumento, competencia, adopción/validación y
   publicidad aplicables.
2. Obtener el acto de adopción, vigencia, versión consolidada y cartografía del
   PMOT/ordenanzas de Puerto Plata.
3. Inventariar el servicio/dataset directo de cartografía ambiental y confirmar
   sus metadatos.
4. Fijar una fuente administrativa vectorial para los AOI, separada de la
   geometría normativa.

### P1 — activa módulos condicionales

1. Cotejar régimen y capa de áreas protegidas, riesgo, recursos hídricos y
   patrimonio que puedan afectar los AOI.
2. Para cada proyecto, comprobar requisitos actuales de MIVED, Medio Ambiente,
   INTRANT, MOPC, INDRHI/prestador y ayuntamiento solo cuando haya condición de
   activación.
3. Registrar reglamentos y disposiciones técnicas de Registro Inmobiliario por
   trámite, sin importar datos individuales a la plataforma.

### P2 — prepara escalabilidad a Colombia

1. Mantener estas familias como vocabulario común, pero mover los nombres de
   leyes, entidades y procesos a un `PaquetePaís` versionado.
2. Modelar equivalencias por función (`plan municipal`, `acto de adopción`,
   `determinante sectorial`, `acto individual`), no por traducción literal de
   nombres.

## 6. Definición de terminado para este inventario

Un instrumento deja de ser solo una fila de investigación cuando posee fuente,
estado, localizador, actor, condición de activación, calidad espacial y una
acción siguiente. Hasta entonces, Tierra Base debe mostrarlo como **referencia
en investigación**, no como condicionante automático.
