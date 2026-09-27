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
  | 'tenencia';

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
] as const;

export function regulatoryActorById(id: string): RegulatoryActor | undefined {
  return RD_REGULATORY_ACTORS.find((actor) => actor.id === id);
}
