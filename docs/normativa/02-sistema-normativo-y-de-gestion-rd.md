# Sistema de normativa, planificación y gestión — República Dominicana

**Estado:** mapa base v0.1 · **Fecha de corte:** 2026-09-28  
**Complementa:** [Mapa de actores](01-mapa-actores-rd.md) y [Marco Metodológico Base](../metodologia/01-marco-metodologico-base.md)

El catálogo que convierte esta arquitectura en registros de investigación está
en el [Inventario priorizado de instrumentos](03-inventario-instrumentos-prioritarios-rd.md).

## 1. Para qué sirve este mapa

Este es el mapa operativo del sistema que Tierra Base debe investigar en
República Dominicana. No es un organigrama del Estado, un listado exhaustivo
de trámites ni una opinión sobre la viabilidad de un proyecto. Responde cuatro
preguntas antes de cualquier cruce espacial:

1. ¿Qué **instrumento** puede condicionar la decisión?
2. ¿Qué **actor** lo emite, adopta, valida, aplica, autoriza, controla o
   publica?
3. ¿Qué **evidencia** demuestra su vigencia, alcance y localización?
4. ¿Qué depende del lugar, tipología y escala concretos del proyecto?

La unidad de trabajo no es el ministerio ni el PDF: es la relación trazable
`instrumento → disposición → actor/rol → ámbito espacial → proceso →
evidencia`. Un mismo actor puede aparecer varias veces con roles distintos; un
instrumento puede requerir coordinación de varios actores.

> **Límite de uso.** La presencia de un actor o instrumento en este mapa no
> significa que aplique a todos los predios ni que constituya una secuencia
> obligatoria de permisos. La aplicación final corresponde a la autoridad y al
> expediente del caso.

---

## 2. Las seis funciones que no se deben mezclar

| Función | Pregunta que responde | Evidencia que debe conservar Tierra Base |
|---|---|---|
| **Normar** | ¿Cuál es la regla de mayor jerarquía y su texto vigente? | Ley, decreto, reglamento, ordenanza, Gaceta o publicación primaria. |
| **Planificar** | ¿Qué visión, modelo, clasificación o programa organiza un territorio? | Plan, memoria, anexo, cartografía, acto de adopción y vigencia. |
| **Adoptar / validar** | ¿Qué convierte una propuesta técnica en instrumento aplicable, si procede? | Acto competente, fecha de entrada en vigencia y constancia de validación cuando aplique. |
| **Autorizar / controlar** | ¿Qué decisión individual, permiso, certificación o inspección exige el caso? | Requisito oficial, expediente, resolución/certificación y autoridad decisora. |
| **Producir datos** | ¿Qué delimitación, registro o capa permite ubicar una regla? | Servicio/capa, metadatos, fecha, escala, cobertura, licencia y método. |
| **Participar / ejecutar** | ¿Quién aporta evidencia local, coordina, financia, construye o recibe impactos? | Acta, consulta, convenio, proyecto, presupuesto o registro de participación. |

Una regla escrita no es todavía una geometría; una geometría no es todavía una
autorización; y una participación pública no reemplaza un acto administrativo.

---

## 3. Mapa de instrumentos

La siguiente arquitectura ordena fuentes por su función. No presume que todos
los elementos estén publicados, vigentes o georreferenciados en cada municipio.

| Capa | Familia de instrumentos | Qué puede responder | Fuente/actor inicial | Forma espacial esperable | Prueba mínima antes de mostrar un efecto |
|---|---|---|---|---|---|
| 1 | Constitución, leyes y códigos | Competencias, principios, procedimientos, definiciones y límites generales. | Congreso, Poder Ejecutivo y publicación jurídica oficial. | Normalmente D/E: aplicación territorial descrita, no siempre polígono. | Texto primario, fecha, vigencia y localizador exacto. |
| 2 | Decretos y reglamentos | Desarrollo de una ley, sistema, método, instrumentos o trámite. | Poder Ejecutivo / órgano rector. | D/E, salvo anexos espaciales. | Publicación oficial y relación expresa con la ley. |
| 3 | Política, estrategia y planificación nacional / regional | Objetivos, coordinación intersectorial, prioridades de inversión o marco territorial. | MEPyD y entidades sectoriales competentes. | D/E o A–C si contiene cartografía. | Estado jurídico y efecto operativo; una estrategia no se presenta como zonificación. |
| 4 | División político-administrativa y jurisdicciones | Qué municipio, distrito, provincia, región o autoridad corresponde al AOI. | Leyes/actos de división y cartografía de referencia, incluida la ONE. | A/B según el servicio o publicación disponible. | Fuente, fecha, cobertura y diferencia entre límite administrativo y límite normativo. |
| 5 | Plan municipal de ordenamiento territorial (PMOT) o equivalente | Modelo territorial, clasificación/calificación, unidades, lineamientos, parámetros o programas, según el instrumento. | Ayuntamiento competente, con las validaciones que correspondan. | A–D; planos y anexos pueden tener distinta calidad. | Documento consolidado, acto de adopción, vigencia y cartografía aplicable. |
| 6 | Ordenanzas, reglamentos y planes locales complementarios | Desarrollo local: zonificación, espacio público, urbanización, gestión o procedimientos. | Concejo/ayuntamiento u órgano local competente. | A–D. | Texto/acto, jurisdicción, versión y plano/leyenda si fija efectos espaciales. |
| 7 | Instrumentos sectoriales | Protección ambiental, riesgo, patrimonio, agua, movilidad, vivienda/edificación, turismo, infraestructura y servicios. | Autoridad sectorial competente. | Desde A hasta E; depende de la figura. | Norma/acto sectorial, condición de activación y fuente geográfica diferenciada. |
| 8 | Declaratorias, delimitaciones y regímenes especiales | Área protegida, monumento/sitio, franja, servidumbre, derecho de vía, cuenca u otro ámbito específico. | Entidad competente según materia. | Idealmente A; no presumirlo. | Acto de declaratoria + delimitación oficial o calidad A–E explícita. |
| 9 | Planes, carteras y proyectos de inversión | Obras, programas y proyectos públicos o privados que pueden crear coordinación, oportunidad o afectación futura. | Entidad ejecutora, ayuntamiento, ministerio o promotor. | A–E; un anuncio puede no tener polígono. | Estado del proyecto, fuente, responsable, horizonte y certeza espacial. |
| 10 | Actos y permisos de caso | Licencia, autorización ambiental, no objeción, certificación, aprobación o condición individual. | Autoridad autorizadora. | Predio, trazado o huella; no siempre pública. | Acto individual y expediente; nunca se infiere por cercanía a una capa. |
| 11 | Catastro, mensura y registro inmobiliario | Identidad y situación jurídica del inmueble; no su uso permitido. | Registro Inmobiliario, Registro de Títulos, Catastro y mensura competente. | Geometría registral/catastral con restricciones de acceso posibles. | Certificación/planos oficiales y fecha de consulta. |
| 12 | Estudios técnicos y evidencia derivada | Base para diagnóstico o solicitud: geotecnia, hidrología, movilidad, ambiente, patrimonio, riesgo, etc. | Profesional habilitado, entidad técnica o autoridad revisora. | A–E según insumo y método. | Autor, fecha, método, alcance y relación con el proceso; no convertirlo en norma. |
| 13 | Participación, acuerdos y evidencia territorial local | Intereses, conflictos, observaciones y compromisos de implementación. | Comunidades, sociedad civil, sector productivo, academia y autoridad convocante. | B–E; puede no ser cartografiable. | Procedencia, fecha, representatividad y límite de interpretación. |

### Regla editorial esencial

Las capas 1–3 explican el marco; las 5–8 pueden condicionar un área; las 9–12
definen gestión o evidencia de caso; la 13 mejora legitimidad y diagnóstico.
Ninguna sustituye por sí sola a las otras.

---

## 4. Mapa de actores por rol

Los actores están agrupados por función práctica para la investigación. Los
nombres de unidades, requisitos, jurisdicciones y vínculos se verifican para
cada caso; por eso un actor puede estar **activo**, **condicionado** o solo
**informativo** en un AOI.

| Grupo | Actor o red a mapear | Rol posible en planificación / desarrollo | Cuándo se activa | Evidencia inicial a buscar |
|---|---|---|---|---|
| Marco jurídico | Congreso, Poder Ejecutivo, Consultoría Jurídica y Gaceta/publicación oficial | Dictan/publican el marco jurídico y actos reglamentarios. | Siempre, para comprobar la fuente primaria de cualquier regla. | Ley, decreto o reglamento con identificador, versión y vigencia. |
| Rectoría territorial | MEPyD y su sistema territorial/regional aplicable | Coordina y desarrolla el marco nacional de ordenamiento; interviene en las verificaciones técnicas que la regulación establezca. | PMOT, instrumentos territoriales, coordinación multinivel o dato nacional. | Ley 368-22, reglamento, guía/procedimiento, validación o fuente SNIT cuando exista. |
| Gobierno local | Ayuntamiento, concejo municipal, unidades de planeamiento y distritos municipales | Formula/gestiona instrumentos locales, ordenanzas, información y trámites dentro de su competencia. | Siempre que el AOI esté en el municipio. | PMOT, ordenanzas, planos, acto de adopción, consulta/certificación y publicación municipal. |
| Ambiente | Ministerio de Medio Ambiente y sus dependencias | Evaluación/autorización ambiental, conservación y datos/figuras ambientales. | Si hay proyecto, condicionante o figura ambiental relevante. | Requisito del trámite, acto, términos de referencia, capa/servicio y fecha. |
| Riesgo | CNE, Defensa Civil, estructuras de prevención/mitigación/respuesta y autoridades locales | Coordinación de gestión del riesgo y evidencia para prevención o respuesta. | Amenaza, exposición, infraestructura crítica o planeación de emergencia. | Plan/acto de riesgo, mapa, metodología, comité competente y cobertura. |
| Edificación | MIVED y profesionales/entidades habilitadas | Normativa sectorial, licencias y requisitos técnicos de edificación. | Cuando la consulta pasa de suelo a proyecto constructivo. | Requisitos vigentes, modalidad de licencia, planos/estudios y habilitaciones. |
| Movilidad e infraestructura | MOPC, INTRANT y titular de la infraestructura | Red vial, accesos, movilidad e impactos sobre infraestructuras de su competencia. | Acceso, derecho de vía, conexión, intervención o generación relevante de viajes. | Titularidad/afectación, requerimiento de estudio, diseño y autorización aplicable. |
| Agua, saneamiento y drenaje | INDRHI, INAPA, prestador/local competente y gestor de cuenca según el caso | Disponibilidad, obras hidráulicas, gestión de cauce, agua potable, saneamiento y drenaje. | Cuerpos de agua, captación, descarga, drenaje o demanda de servicio. | Fuente competente, disponibilidad, permiso/condición, plano/estudio y delimitación. |
| Patrimonio | Ministerio de Cultura / Dirección Nacional de Patrimonio Monumental y autoridad local pertinente | Inventario, protección, autorización/supervisión de intervenciones patrimoniales. | Inmueble, sitio, centro histórico o entorno con declaración/valor patrimonial. | Declaratoria, inventario, plan regulador, perímetro, condición y trámite. |
| Turismo | Ministerio de Turismo y entidades ejecutoras pertinentes | Planes, proyectos y coordinación sectorial turística. | Proyecto o área con componente turístico, litoral o infraestructura asociada. | Instrumento/proyecto, área, estado, relación con permisos y autoridad responsable. |
| Suelo y tenencia | Registro Inmobiliario, Registro de Títulos, Catastro Nacional y mensura competente | Identidad, derecho, cargas, plano y evidencia catastral/registral. | Cuando se analiza un inmueble identificable o se prepara trámite. | Certificado/estado jurídico, plano y fecha; no inferir dominio desde una capa. |
| Información territorial | ONE, productores sectoriales y servicios geoespaciales oficiales | División territorial, estadísticas, cartografía y metadatos de referencia. | Siempre, para localizar jurisdicciones y evaluar calidad de fuentes. | Dataset/atlas, fecha, escala, cobertura, CRS, licencia y método. |
| Comunidad y sector no estatal | Juntas, propietarios, promotores, prestadores, academia, cámaras, ONG y organizaciones territoriales | Conocimiento local, impactos, intereses, ejecución y monitoreo; no autoridad normativa. | Participación, conflicto, operación de servicios, proyecto o validación social. | Acta, fuente, fecha, representación, interés y relación con el AOI. |

### Relaciones que sí debe guardar el sistema

En vez de una línea ambigua entre dos nodos, cada conexión tendrá un verbo:

`emite` · `adopta` · `valida/revisa` · `implementa` · `autoriza` · `controla` ·
`produce datos` · `consulta/participa` · `ejecuta/financia` · `es afectado por`.

La conexión además indica si es **nuclear** (se revisa siempre), **condicionada**
(se activa por localización/tipología) o **informativa** (aporta contexto, sin
decidir aplicabilidad). Esto evita convertir el mapa en una falsa ventanilla
única.

---

## 5. Secuencia de investigación reutilizable

No se parte de una lista de documentos al azar ni de una capa encontrada en la
web. Se abre un expediente de investigación en este orden:

1. **Ubicar.** Definir AOI, fecha de corte, municipio/distrito, jurisdicciones y
   tipo de consulta.
2. **Encontrar el marco.** Registrar leyes, reglamentos e instrumentos de
   planificación que pueden aplicar, sin aún concluir que lo hacen.
3. **Comprobar estado jurídico.** Diferenciar diagnóstico, borrador, propuesta,
   instrumento adoptado, acto individual y fuente histórica.
4. **Mapear roles.** Asignar a cada instrumento el emisor, adoptante/validador,
   aplicador, autorizador, productor de datos y participantes relevantes.
5. **Localizar.** Buscar primero geometría oficial; si hay PDF o texto, usar los
   niveles A–E de evidencia espacial en vez de simular precisión.
6. **Activar sectores por condición.** Ambiente, riesgo, agua, patrimonio,
   movilidad, turismo y tenencia entran por una evidencia de lugar o de
   tipología, no solo porque el actor exista.
7. **Convertir a gestión.** Cada vacío termina en una acción concreta: obtener
   acto, pedir certificación, validar cartografía, consultar actor o encargar
   estudio.

## 6. Ficha mínima de un actor y de una relación

### Actor

| Campo | Ejemplo de contenido |
|---|---|
| Identidad | Nombre oficial, sigla, tipo de organización y escala. |
| Rol | Planifica, autoriza, produce datos, ejecuta, participa, etc. |
| Competencia | Descripción breve con enlace a fuente primaria/institucional. |
| Activación | Siempre, por ubicación, por tipo de proyecto, por trámite o por riesgo. |
| Instrumentos vinculados | Ley, PMOT, plan sectorial, permiso, servicio o dataset. |
| Evidencia y fecha | URL, versión, fecha de consulta, vigencia y nivel de confianza. |
| Límite | Lo que el actor no decide o lo que debe verificarse localmente. |

### Relación actor–instrumento

| Campo | Ejemplo de contenido |
|---|---|
| Verbo | `adopta`, `autoriza`, `produce datos`, etc. |
| Objeto | Documento, disposición, proceso, proyecto o ámbito espacial. |
| Alcance | Nacional, municipal, sectorial, caso concreto. |
| Condición | Localización, tipología, umbral, vigencia, solicitud o ninguna. |
| Fuente | Artículo, página, URL o requisito institucional. |
| Estado | Verificado, pendiente de fuente primaria, pendiente municipal o no aplicable. |

## 7. Fuentes de partida verificadas

- [Ley 368-22 de Ordenamiento Territorial, Uso de Suelo y Asentamientos Humanos](https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3400549&managementType=1)
- [Reglamento de aplicación de la Ley 368-22](https://mepyd.gob.do/publicacion/reglamento-de-aplicacion-ley-no-368-22-de-ordenamiento-territorial)
- [Ley 176-07 del Distrito Nacional y los Municipios](https://consultoria.gov.do/Consulta/Home/FileManagement?documentId=3345180&managementType=1)
- [Autorizaciones ambientales](https://ambiente.gob.do/autorizaciones-ambientales/servicios/autorizaciones-ambientales/)
- [Mapas de áreas protegidas](https://ambiente.gob.do/informacion-ambiental/areas-protegidas/mapas/)
- [Defensa Civil: gestión de riesgo](https://defensacivil.gob.do/transparencia/index.php/organigrama/organigrama-dinamico)
- [INDRHI: documentos y atlas de recursos hídricos](https://indrhi.gob.do/documentos/)
- [INTRANT: certificación para estudios de impacto de tráfico](https://intrant.gob.do/servicios/certificacion-para-realizar-estudios-de-impacto-de-trafico-a-empresas-e-ingenieros-individuales/)
- [Dirección Nacional de Patrimonio Monumental: funciones](https://www.cultura.gob.do/transparencia/phocadownload/Organigrama2021/new/DIRECCIN_NACIONALDE_PATRIOMONIO_MONUMENTAL.pdf)
- [Registro Inmobiliario: Registro de Títulos](https://ri.gob.do/?page_id=301)
- [ONE: División Territorial 2020](https://www.one.gob.do/publicaciones/2021/division-territorial-2020/)

Estas fuentes sustentan el punto de partida institucional. Para cualquier
resultado espacial o requisito concreto se debe conservar la fuente específica
y actualizada del instrumento o trámite, no solo este mapa.

## 8. Criterio de completitud para la primera versión

El mapa estará suficientemente maduro para implementar datos cuando cada
instrumento prioritario del piloto tenga, como mínimo:

- un tipo y una jerarquía/función claros;
- emisor y actor competente diferenciados cuando no sean el mismo;
- estado jurídico, versión y fuente primaria o vacío explícito;
- ámbito espacial con nivel A–E o constancia de que no es espacializable;
- condición de activación y proceso asociado;
- próxima acción verificable.

El objetivo no es enumerar todas las instituciones dominicanas. Es poder
explicar, para cada hallazgo de Tierra Base, de dónde viene, quién decide, dónde
podría aplicar, qué falta por confirmar y cuál es el siguiente paso responsable.
