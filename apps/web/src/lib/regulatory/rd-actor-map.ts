/**
 * Mapa institucional inicial para la investigación normativa en República
 * Dominicana. Es un registro curado, no un motor de permisos: cada entrada
 * conserva el enlace oficial que sostiene la síntesis y explicita aquello que
 * todavía requiere contraste con el ayuntamiento concreto.
 *
 * El siguiente paso será mover este catálogo a una fuente editorial
 * versionada; mientras tanto, mantenerlo pequeño y verificable es preferible
 * a presentar una lista extensa de instituciones sin evidencia.
 */

export type RegulatoryActorCategory =
  | 'marco jurídico'
  | 'ordenamiento'
  | 'gestión local'
  | 'edificación'
  | 'ambiental'
  | 'infraestructura'
  | 'tenencia'
  | 'riesgo'
  | 'agua y saneamiento'
  | 'patrimonio y turismo'
  | 'datos territoriales'
  | 'participación';

export type RegulatorySource = {
  label: string;
  url: string;
};

export type RegulatoryActor = {
  id: string;
  name: string;
  shortName: string;
  category: RegulatoryActorCategory;
  scope: string;
  mandate: string;
  planningRole: string;
  roles: readonly string[];
  activation: string;
  documentsToVerify: readonly string[];
  relatedActorIds: readonly string[];
  evidenceStatus: 'Fuente oficial verificada' | 'Requiere verificación municipal';
  evidenceNote: string;
  sources: readonly RegulatorySource[];
};

export const RD_REGULATORY_ACTORS: readonly RegulatoryActor[] = [
  {
    id: 'marco-legal',
    name: 'Marco jurídico y publicaciones oficiales',
    shortName: 'Marco legal',
    category: 'marco jurídico',
    scope: 'Nacional',
    mandate:
      'Constituye la base consultable de leyes, decretos y reglamentos que sostienen el ordenamiento y los procedimientos sectoriales.',
    planningRole:
      'Permite verificar la versión, vigencia y fuente primaria de una regla antes de convertirla en una conclusión dentro de la plataforma.',
    roles: ['publica marco jurídico', 'sostiene evidencia primaria'],
    activation: 'Nuclear: se consulta para verificar toda regla relevante.',
    documentsToVerify: [
      'Ley 368-22 y su reglamento de aplicación.',
      'Ley 176-07 del Distrito Nacional y los Municipios.',
      'Ley 160-21 de Vivienda, Hábitat y Edificaciones.',
      'Ley 64-00 de Medio Ambiente y sus disposiciones aplicables.',
    ],
    relatedActorIds: ['mepyd', 'ayuntamientos', 'mived', 'medio-ambiente'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'No emite la decisión de prefactibilidad de un proyecto; es la capa de evidencia jurídica que Tierra Base debe enlazar y versionar.',
    sources: [
      {
        label: 'Consultoría Jurídica: Ley 368-22',
        url: 'https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3400549&managementType=1',
      },
      {
        label: 'Consultoría Jurídica: Ley 176-07',
        url: 'https://consultoria.gov.do/Consulta/Home/FileManagement?documentId=3345180&managementType=1',
      },
    ],
  },
  {
    id: 'mepyd',
    name: 'Ministerio de Economía, Planificación y Desarrollo',
    shortName: 'MEPyD',
    category: 'ordenamiento',
    scope: 'Nacional y articulación territorial',
    mandate:
      'Publica el reglamento de aplicación de la Ley 368-22, que desarrolla los instrumentos y criterios de ordenamiento territorial y uso de suelo.',
    planningRole:
      'Aporta el marco nacional para interpretar planes territoriales y su coordinación con instrumentos de los gobiernos locales.',
    roles: ['planifica', 'coordina', 'revisa/valida cuando corresponda'],
    activation: 'Nuclear para instrumentos de ordenamiento; el alcance concreto requiere fuente vigente.',
    documentsToVerify: [
      'Reglamento de aplicación de la Ley 368-22.',
      'Instrumento territorial aplicable a la jurisdicción del AOI.',
      'Cartografía o metadatos publicados por el Sistema Nacional de Información Territorial, cuando estén disponibles.',
    ],
    relatedActorIds: ['marco-legal', 'ayuntamientos', 'medio-ambiente', 'mived'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'El marco nacional no reemplaza la ordenanza, el plan o la validación de zonificación del municipio donde se encuentra el proyecto.',
    sources: [
      {
        label: 'MEPyD: Reglamento de aplicación de la Ley 368-22',
        url: 'https://mepyd.gob.do/publicacion/reglamento-de-aplicacion-ley-no-368-22-de-ordenamiento-territorial',
      },
      {
        label: 'MEPyD: guía sobre Ley 368-22',
        url: 'https://mepyd.gob.do/las-145-preguntas-de-ley-ordenamiento-territorial',
      },
    ],
  },
  {
    id: 'ayuntamientos',
    name: 'Ayuntamiento y gobierno local competente',
    shortName: 'Ayuntamiento',
    category: 'gestión local',
    scope: 'Municipal',
    mandate:
      'Ejerce sus atribuciones dentro del territorio municipal; la Ley 176-07 reconoce que los ayuntamientos pueden determinar límites de áreas urbanas y otras divisiones administrativas mediante ordenanza.',
    planningRole:
      'Es el punto de contraste imprescindible para zonificación, plan municipal, ordenanzas, compatibilidad de uso y trámites locales.',
    roles: ['planifica', 'adopta/aplica según instrumento', 'gestiona localmente'],
    activation: 'Nuclear para todo AOI localizado dentro del municipio.',
    documentsToVerify: [
      'Plan de ordenamiento territorial o instrumento equivalente vigente.',
      'Ordenanza y plano de zonificación vigente.',
      'Certificación o consulta municipal de uso de suelo, si el municipio la expide.',
      'Requisitos locales de urbanización, acceso, drenaje y espacio público.',
    ],
    relatedActorIds: ['mepyd', 'mived', 'medio-ambiente', 'mopc', 'registro-inmobiliario'],
    evidenceStatus: 'Requiere verificación municipal',
    evidenceNote:
      'La existencia, nombre, formato, vigencia y disponibilidad pública de los instrumentos cambia por municipio; Tierra Base no debe inferirlos desde una categoría nacional.',
    sources: [
      {
        label: 'Ley 176-07: territorio y atribuciones municipales',
        url: 'https://consultoria.gov.do/Consulta/Home/FileManagement?documentId=3345180&managementType=1',
      },
    ],
  },
  {
    id: 'mived',
    name: 'Ministerio de Vivienda y Edificaciones',
    shortName: 'MIVED',
    category: 'edificación',
    scope: 'Nacional',
    mandate:
      'Es la entidad rectora y reguladora del sector vivienda, hábitat y edificaciones; su catálogo público incluye licencia de construcción y habilitación de profesionales y estudios técnicos.',
    planningRole:
      'Conecta la propuesta urbana con normas, licencias y evidencias técnicas de la edificación: planos, estructura, geotecnia y profesionales habilitados.',
    roles: ['regula sectorialmente', 'autoriza', 'verifica requisitos técnicos'],
    activation: 'Condicionada: cuando la consulta pasa a un proyecto de edificación.',
    documentsToVerify: [
      'Requisitos vigentes de licencia de construcción para la tipología del proyecto.',
      'Planos, memorias y estudios técnicos exigibles.',
      'Estudio geotécnico y evaluación estructural cuando correspondan.',
      'Habilitación de profesionales, laboratorios y supervisores aplicables.',
    ],
    relatedActorIds: ['marco-legal', 'mepyd', 'ayuntamientos', 'medio-ambiente', 'mopc'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'La página inicial identifica la competencia y servicios; el expediente real debe contrastarse contra el requisito vigente y la modalidad concreta de licencia.',
    sources: [
      {
        label: 'MAP: atribuciones y servicios de MIVED',
        url: 'https://map.gob.do/COEDOM/Home/Details/181?Ruta=1',
      },
      {
        label: 'MIVED: habilitaciones y requisitos técnicos',
        url: 'https://mived.gob.do/listados-de-habilitaciones-profesionales-actualizacion/',
      },
    ],
  },
  {
    id: 'medio-ambiente',
    name: 'Ministerio de Medio Ambiente y Recursos Naturales',
    shortName: 'Medio Ambiente',
    category: 'ambiental',
    scope: 'Nacional',
    mandate:
      'Gestiona la evaluación ambiental y las autorizaciones de proyectos, obras y actividades mediante categorías e instrumentos definidos en el marco ambiental.',
    planningRole:
      'Convierte hallazgos territoriales de Tierra Base en una ruta de evaluación: restricciones ambientales, categoría preliminar, estudios, términos de referencia y autorización.',
    roles: ['autoriza', 'protege/controla', 'produce datos sectoriales'],
    activation: 'Condicionada por proyecto, localización o figura ambiental relevante.',
    documentsToVerify: [
      'Título o acreditación de derecho sobre el inmueble.',
      'Plano o mensura catastral y coordenadas UTM/WGS84 o KMZ.',
      'Memoria descriptiva, mapa de localización y plano de conjunto.',
      'Términos de referencia, DIA o EsIA según la categoría que determine la autoridad.',
    ],
    relatedActorIds: ['marco-legal', 'mepyd', 'ayuntamientos', 'mived', 'mopc'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'La categoría y el instrumento ambiental final los determina la autoridad; la aplicación solo puede anticipar documentos potenciales y evidencia territorial relevante.',
    sources: [
      {
        label: 'Autorizaciones ambientales: requisitos y procedimiento',
        url: 'https://ambiente.gob.do/autorizaciones-ambientales/servicios/autorizaciones-ambientales/',
      },
      {
        label: 'Términos de referencia y categorías ambientales',
        url: 'https://serviciosdigitales.ambiente.gob.do/tdr/',
      },
    ],
  },
  {
    id: 'mopc',
    name: 'Ministerio de Obras Públicas y Comunicaciones',
    shortName: 'MOPC',
    category: 'infraestructura',
    scope: 'Nacional y red pública',
    mandate:
      'Conserva competencias sobre obras públicas y de comunicación vial, entre ellas carreteras, puentes, avenidas y otras infraestructuras de conectividad.',
    planningRole:
      'Debe entrar al análisis cuando el proyecto depende de acceso a infraestructura vial pública, colinda con ella o propone una conexión que pueda afectarla.',
    roles: ['ejecuta infraestructura', 'coordina intervenciones sobre red pública'],
    activation: 'Condicionada por acceso, derecho de vía, conexión o intervención vial.',
    documentsToVerify: [
      'Afectación o derecho de vía de infraestructura pública próxima.',
      'Condiciones para acceso, conexión o intervención sobre la red vial.',
      'Estudios de movilidad o ingeniería requeridos por la intervención concreta.',
    ],
    relatedActorIds: ['ayuntamientos', 'mived', 'medio-ambiente'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'No toda parcela requiere una gestión ante MOPC; debe activarse por relación verificable con infraestructura bajo su competencia.',
    sources: [
      {
        label: 'MAP: competencias de Obras Públicas y Comunicaciones',
        url: 'https://map.gob.do/COEDOM/Home/Details/119?Ruta=2',
      },
    ],
  },
  {
    id: 'registro-inmobiliario',
    name: 'Registro Inmobiliario y Registro de Títulos',
    shortName: 'Registro inmobiliario',
    category: 'tenencia',
    scope: 'Nacional, con competencia registral territorial',
    mandate:
      'Expide certificados de título y certificaciones sobre el estado jurídico, cargas, gravámenes y demás asientos registrales del inmueble.',
    planningRole:
      'No decide el uso de suelo, pero establece la evidencia de tenencia y afectaciones registrales que debe acompañar la prefactibilidad y varios procedimientos.',
    roles: ['registra', 'certifica situación jurídica'],
    activation: 'Condicionada: cuando se identifica un inmueble o se prepara un trámite.',
    documentsToVerify: [
      'Certificación del estado jurídico del inmueble.',
      'Certificado de título o constancia anotada.',
      'Certificación de cargas y gravámenes, cuando corresponda.',
      'Plano y designación catastral asociados al inmueble.',
    ],
    relatedActorIds: ['ayuntamientos', 'mived', 'medio-ambiente'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'La geometría mostrada por un usuario nunca sustituye una certificación registral o una mensura aprobada.',
    sources: [
      {
        label: 'Registro Inmobiliario: Registro de Títulos',
        url: 'https://ri.gob.do/?page_id=301',
      },
      {
        label: 'Certificación del estado jurídico del inmueble',
        url: 'https://ri.gob.do/wp-content/uploads/Tramites/DNRT/CERTIFICACION_DEL_ESTADO_JURIDICO_DEL_INMUEBLE.pdf',
      },
    ],
  },
  {
    id: 'riesgo',
    name: 'Gestión del riesgo: CNE, Defensa Civil y estructuras territoriales',
    shortName: 'Riesgo',
    category: 'riesgo',
    scope: 'Nacional, regional, provincial y municipal según mecanismo',
    mandate:
      'Articula prevención, mitigación, preparación y respuesta ante riesgos y desastres mediante estructuras de coordinación y planificación en distintas escalas.',
    planningRole:
      'Aporta evidencia sobre amenaza, exposición y capacidades de respuesta, y activa la necesidad de verificar planes, comités o medidas de gestión del riesgo.',
    roles: ['coordina', 'previene/mitiga', 'aporta información de riesgo'],
    activation:
      'Condicionada por amenaza, exposición, infraestructura crítica o requerimientos de planeación de emergencia.',
    documentsToVerify: [
      'Plan, metodología o capa de riesgo con entidad productora, fecha y cobertura.',
      'Mecanismo de coordinación territorial o comité aplicable.',
      'Medidas de prevención, mitigación o respuesta que correspondan al proyecto.',
    ],
    relatedActorIds: ['mepyd', 'ayuntamientos', 'medio-ambiente', 'mopc'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'Una capa de amenaza no determina por sí sola la admisibilidad de un proyecto; su escala, fecha, método y actor competente deben permanecer visibles.',
    sources: [
      {
        label: 'Defensa Civil: gestión de riesgos y estructura institucional',
        url: 'https://defensacivil.gob.do/transparencia/index.php/organigrama/organigrama-dinamico',
      },
      {
        label: 'Defensa Civil: comités de prevención, mitigación y respuesta',
        url: 'https://defensacivil.gob.do/index.php/component/zoo/item/defensa-civil-juramenta-comites-de-prevencion-mitigacion-y-respuesta-de-la-provincia-pedernales',
      },
    ],
  },
  {
    id: 'agua-saneamiento',
    name: 'Agua, saneamiento y recursos hídricos',
    shortName: 'Agua y saneamiento',
    category: 'agua y saneamiento',
    scope: 'Nacional y prestadores/gestores territoriales competentes',
    mandate:
      'Agrupa las entidades que producen información y gestionan recursos, obras o servicios de agua, drenaje y saneamiento según su competencia territorial y material.',
    planningRole:
      'Permite investigar disponibilidad, relación con cauces, obras hidráulicas, demanda de servicios y condiciones que deban validarse para un desarrollo.',
    roles: ['planifica/gestiona recursos hídricos', 'opera o coordina servicios', 'produce datos sectoriales'],
    activation:
      'Condicionada por cuerpos de agua, captación, descarga, drenaje, obras hidráulicas o demanda de servicios.',
    documentsToVerify: [
      'Fuente y condición de disponibilidad o conexión del servicio competente.',
      'Plano, estudio o condición para intervención en cauce, drenaje u obra hidráulica.',
      'Cartografía hídrica con fecha, cobertura y productor identificado.',
    ],
    relatedActorIds: ['medio-ambiente', 'riesgo', 'ayuntamientos', 'mived'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'La institución competente y el requisito específico pueden variar por servicio, cuenca y municipio; no se debe convertir una referencia hidrológica en permiso automático.',
    sources: [
      {
        label: 'INDRHI: documentos y atlas de recursos hídricos',
        url: 'https://indrhi.gob.do/documentos/',
      },
      {
        label: 'INDRHI: preguntas frecuentes y funciones sobre recursos hídricos',
        url: 'https://beta.indrhi.gob.do/preguntas-frecuentes/',
      },
    ],
  },
  {
    id: 'movilidad',
    name: 'Instituto Nacional de Tránsito y Transporte Terrestre',
    shortName: 'INTRANT',
    category: 'infraestructura',
    scope: 'Nacional y movilidad terrestre',
    mandate:
      'Interviene en la gestión de movilidad y publica requisitos para la certificación de quienes realizan estudios de impacto de tráfico.',
    planningRole:
      'Aporta el componente de movilidad cuando la magnitud, accesos o estacionamientos de un desarrollo requieren revisar impactos de tránsito u otras condiciones sectoriales.',
    roles: ['regula movilidad', 'certifica estudios/profesionales', 'revisa impactos cuando aplique'],
    activation:
      'Condicionada por tipología, intensidad de viajes, estacionamientos, acceso o exigencia sectorial verificable.',
    documentsToVerify: [
      'Requisito vigente de revisión o estudio de impacto de tráfico.',
      'Estudio preparado por entidad o profesional habilitado cuando corresponda.',
      'Relación con acceso, red vial y actor titular de la infraestructura.',
    ],
    relatedActorIds: ['mopc', 'ayuntamientos', 'mived', 'medio-ambiente'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'Los umbrales y requisitos deben verificarse en el documento vigente y para la tipología concreta; Tierra Base no clasifica proyectos automáticamente.',
    sources: [
      {
        label: 'INTRANT: certificación para estudios de impacto de tráfico',
        url: 'https://intrant.gob.do/servicios/certificacion-para-realizar-estudios-de-impacto-de-trafico-a-empresas-e-ingenieros-individuales/',
      },
      {
        label: 'INTRANT: requerimientos para evaluaciones de impacto de tráfico',
        url: 'https://intrant.gob.do/movilidad/index.php/estudios/impacto-de-trafico/item/download/13_e72c806e07c6ee9073e80ce56cfca0f1',
      },
    ],
  },
  {
    id: 'patrimonio',
    name: 'Patrimonio cultural y monumental',
    shortName: 'Patrimonio',
    category: 'patrimonio y turismo',
    scope: 'Nacional, con relaciones locales y territoriales específicas',
    mandate:
      'La Dirección Nacional de Patrimonio Monumental formula estudios y planes de protección, y autoriza, inspecciona y supervisa intervenciones en bienes declarados dentro de su ámbito.',
    planningRole:
      'Conecta inmuebles, sitios, centros históricos o entornos de valor cultural con sus declaratorias, perímetros, planes reguladores y rutas de consulta.',
    roles: ['protege/controla', 'autoriza/supervisa intervenciones', 'produce inventario/planes'],
    activation:
      'Condicionada por declaración, inventario, perímetro, centro histórico o valor patrimonial que deba confirmarse.',
    documentsToVerify: [
      'Declaratoria, inventario o plan regulador aplicable.',
      'Delimitación o descripción del bien, sitio o entorno y calidad espacial.',
      'Trámite, no objeción o autorización para la intervención propuesta.',
    ],
    relatedActorIds: ['ayuntamientos', 'mived', 'medio-ambiente', 'mepyd'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'La sola proximidad a un elemento cultural no determina el régimen aplicable: deben verificarse la declaratoria, el ámbito y la autoridad que conoce la intervención.',
    sources: [
      {
        label: 'Dirección Nacional de Patrimonio Monumental: facultades y funciones',
        url: 'https://www.cultura.gob.do/transparencia/phocadownload/Organigrama2021/new/DIRECCIN_NACIONALDE_PATRIOMONIO_MONUMENTAL.pdf',
      },
      {
        label: 'Ministerio de Cultura: preguntas frecuentes sobre patrimonio monumental',
        url: 'https://cultura.gob.do/faqs/',
      },
    ],
  },
  {
    id: 'turismo',
    name: 'Turismo y proyectos sectoriales',
    shortName: 'Turismo',
    category: 'patrimonio y turismo',
    scope: 'Nacional y territorial según proyecto',
    mandate:
      'Representa la capa sectorial que debe investigarse cuando un área o desarrollo está vinculado a actividad, infraestructura, programa o inversión turística.',
    planningRole:
      'Ayuda a separar instrumentos o proyectos turísticos formalmente identificados de anuncios, expectativas de mercado o usos genéricos del suelo.',
    roles: ['planifica/promueve sectorialmente', 'coordina proyectos', 'aporta contexto de desarrollo'],
    activation:
      'Condicionada por un instrumento, proyecto o gestión turística identificable en el AOI o su área de influencia.',
    documentsToVerify: [
      'Instrumento o proyecto turístico con entidad responsable y estado verificable.',
      'Área, cronograma, fuente de financiación y relación con el municipio.',
      'Permisos sectoriales o intersectoriales que el proyecto realmente requiera.',
    ],
    relatedActorIds: ['ayuntamientos', 'medio-ambiente', 'mopc', 'patrimonio'],
    evidenceStatus: 'Requiere verificación municipal',
    evidenceNote:
      'Turismo no es una zonificación automática ni un permiso. Su relevancia debe derivarse de una fuente de proyecto o instrumento, no de la vocación percibida de un lugar.',
    sources: [
      {
        label: 'Ministerio de Turismo',
        url: 'https://mitur.gob.do/',
      },
    ],
  },
  {
    id: 'one',
    name: 'Oficina Nacional de Estadística y productores de datos territoriales',
    shortName: 'Datos territoriales',
    category: 'datos territoriales',
    scope: 'Nacional; datos de referencia para múltiples escalas',
    mandate:
      'Produce y publica información estadística y cartográfica de referencia, incluida documentación sobre división territorial y sus delimitaciones.',
    planningRole:
      'Ofrece el punto de partida para ubicar jurisdicciones y evaluar la procedencia, fecha y escala de cartografía administrativa o estadística.',
    roles: ['produce datos', 'documenta división territorial', 'aporta metadatos de referencia'],
    activation: 'Nuclear: cada AOI necesita una referencia territorial y metadatos explícitos.',
    documentsToVerify: [
      'Fuente de límite administrativo y fecha de corte.',
      'Formato, escala, cobertura, sistema de referencia y método de producción.',
      'Diferencia entre límite administrativo, urbano, catastral y normativo.',
    ],
    relatedActorIds: ['mepyd', 'ayuntamientos', 'registro-inmobiliario', 'medio-ambiente'],
    evidenceStatus: 'Fuente oficial verificada',
    evidenceNote:
      'Un límite de referencia estadística no sustituye un plano normativo, una mensura ni un acto de delimitación aplicable a un trámite.',
    sources: [
      {
        label: 'ONE: División Territorial 2020',
        url: 'https://www.one.gob.do/publicaciones/2021/division-territorial-2020/',
      },
    ],
  },
  {
    id: 'participacion',
    name: 'Comunidad, sector productivo, academia y sociedad civil',
    shortName: 'Participación',
    category: 'participación',
    scope: 'Territorial y temática',
    mandate:
      'Reúne actores no estatales que aportan conocimiento local, intereses, impactos, capacidad de ejecución o seguimiento, sin sustituir atribuciones de autoridad pública.',
    planningRole:
      'Conserva observaciones, conflictos, acuerdos y vacíos detectados durante la planificación y la prefactibilidad con fuente y representatividad explícitas.',
    roles: ['participa/consulta', 'aporta evidencia local', 'ejecuta o es afectado'],
    activation: 'Transversal: se registra cuando haya proceso participativo, interés territorial o evidencia aportada.',
    documentsToVerify: [
      'Acta, consulta, observación o fuente de participación con fecha y convocatoria.',
      'Actor, interés, territorio de referencia y posible conflicto u oportunidad.',
      'Límite de interpretación: evidencia participativa no equivale a norma o permiso.',
    ],
    relatedActorIds: ['ayuntamientos', 'mepyd', 'medio-ambiente', 'riesgo', 'turismo'],
    evidenceStatus: 'Requiere verificación municipal',
    evidenceNote:
      'La participación debe ser visible como evidencia territorial y de gobernanza, pero nunca presentarse como sustituto de una competencia, un plano oficial o una autorización.',
    sources: [
      {
        label: 'Ley 368-22: participación de actores territoriales',
        url: 'https://www.consultoria.gov.do/Consulta/Home/FileManagement?documentId=3400549&managementType=1',
      },
    ],
  },
] as const;

export function regulatoryActorById(id: string): RegulatoryActor | undefined {
  return RD_REGULATORY_ACTORS.find((actor) => actor.id === id);
}
