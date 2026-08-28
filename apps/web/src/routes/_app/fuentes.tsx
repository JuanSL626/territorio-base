import { createFileRoute, Link } from '@tanstack/react-router';

import { DATASET_CITATIONS } from '@territorio/geo/export/sources';

import type { SourceRef } from '~/layers/types';

import { Badge, type BadgeTone } from '~/components/ui/badge';
import { AlertIcon, ExternalIcon, InfoIcon } from '~/components/ui/icons';
import { LAYER_REGISTRY } from '~/layers/registry';

/**
 * `/fuentes` — el catálogo de fuentes de la plataforma.
 *
 * Por qué esta página es un entregable y no un pie de página: un análisis
 * territorial se usa para decidir dónde se construye, dónde no y con qué
 * cuidados. Nadie puede sostener esa decisión frente a un tercero si no puede
 * decir de dónde salió cada número: qué dataset, de qué año, a qué resolución,
 * con qué licencia y con qué límites conocidos.
 *
 * Por eso acá está todo, en la misma página, sin acordeones que escondan la
 * mitad: la ficha completa de cada fuente, el método en castellano llano, la
 * cita lista para copiar, y —lo que casi nunca se publica— **los límites y las
 * decisiones de exclusión**: qué mirror devuelve 200 con datos incompletos, qué
 * URL murió, qué proveedor se descartó y por qué.
 *
 * La tabla sale entera del registro de capas (§1.2 y §11): agregar la capa 40
 * la agrega acá sin tocar este archivo.
 */
export const Route = createFileRoute('/_app/fuentes')({
  head: () => ({
    meta: [
      { title: 'Fuentes y metodología · Territorio Base' },
      {
        name: 'description',
        content:
          'Catálogo completo de las fuentes de datos de Territorio Base: dataset, proveedor, endpoint, resolución, vigencia, licencia, método y límites conocidos.',
      },
    ],
  }),
  component: FuentesPage,
});

type SourceEntry = {
  source: SourceRef;
  layers: string[];
  /** Endpoint textual del inventario §5, cuando la fuente tiene ficha de cita. */
  endpoint: string | null;
  citationId: string | null;
};

/**
 * Una fila por DATASET, no por capa: la pendiente y el DEM comparten fuente, y
 * las 39 capas del MEPyD comparten una sola.
 */
function sourceEntries(): SourceEntry[] {
  const byName = new Map<string, SourceEntry>();

  for (const layer of LAYER_REGISTRY) {
    const key = layer.source.name;
    const existing = byName.get(key);
    if (existing !== undefined) {
      existing.layers.push(layer.label);
      continue;
    }
    const citation = matchCitation(layer.source);
    byName.set(key, {
      source: layer.source,
      layers: [layer.label],
      endpoint: citation?.endpoint ?? null,
      citationId: citation?.id ?? null,
    });
  }

  return [...byName.values()];
}

/*
  El puente entre el registro de capas (que vive en la app, con paletas y
  popups) y `DATASET_CITATIONS` (que vive en `@territorio/geo` porque es lo que
  viaja adentro del ZIP). Se emparejan por proveedor y palabra clave en vez de
  por un id compartido porque ninguno de los dos catálogos es dueño del otro; el
  día que haya un id común, esto se borra.
*/
const CITATION_HINTS: readonly { id: string; needle: string }[] = [
  { id: 'dem', needle: 'copernicus dem' },
  { id: 'ndvi', needle: 'sentinel-2' },
  { id: 'worldcover', needle: 'worldcover' },
  { id: 'hidrologia', needle: 'openstreetmap' },
  { id: 'wdpa', needle: 'wdpa' },
  { id: 'aqueduct', needle: 'aqueduct' },
  { id: 'mepyd', needle: 'gestión del riesgo' },
  { id: 'mepyd', needle: 'grd' },
];

function matchCitation(source: SourceRef): { id: string; endpoint: string } | null {
  const haystack = source.name.toLowerCase();
  for (const hint of CITATION_HINTS) {
    if (!haystack.includes(hint.needle)) continue;
    const citation = DATASET_CITATIONS.find((entry) => entry.id === hint.id);
    if (citation !== undefined) return { id: citation.id, endpoint: citation.endpoint };
  }
  return null;
}

/** Tono de la pastilla de licencia: verde = abierta, ámbar = con condiciones. */
function licenseTone(license: string): BadgeTone {
  const text = license.toLowerCase();
  if (text.includes('no comercial') || text.includes('propiedad del usuario')) return 'warning';
  if (text.includes('cc by') || text.includes('odbl') || text.includes('libre')) return 'success';
  if (text.includes('sin registro') || text.includes('públicos')) return 'success';
  return 'neutral';
}

/** Etiqueta corta para la pastilla; el texto completo va debajo igual. */
function licenseLabel(license: string): string {
  const text = license.toLowerCase();
  if (text.includes('cc by 4.0')) return 'CC BY 4.0';
  if (text.includes('odbl')) return 'ODbL 1.0';
  if (text.includes('no comercial')) return 'Uso con condiciones';
  if (text.includes('propiedad del usuario')) return 'Tuyo';
  return 'Abierta';
}

function anchorId(name: string): string {
  return `fuente-${name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')}`;
}

/*
  Decisiones de exclusión del inventario §5. Se publican por la misma razón por
  la que se tomaron: un fallback que responde 200 con datos incompletos es peor
  que no tener fallback, y quien audite estos resultados tiene derecho a saber
  qué se probó y se descartó.
*/
const EXCLUSIONS: readonly { title: string; body: string }[] = [
  {
    title: 'Mirror de Overpass `overpass.osm.ch` — excluido a propósito',
    body: 'Responde 200 OK y devuelve 0 resultados en todo el Caribe: sirve un extracto regional que no incluye la zona. Un fallback que falla en silencio con datos incompletos es peor que no tener fallback, así que se sacó de la cascada. Los 5 mirrors que quedan son de dos proveedores genuinamente independientes, porque en producción los tres del clúster principal fallaron juntos.',
  },
  {
    title: 'URL muerta de Aqueduct: `wri-projects.s3.amazonaws.com/AqueductFloodTool`',
    body: 'Es la ruta que aparece en la documentación vieja y en la mayoría de los tutoriales. Ya no responde. La que se usa es `aqueduct.wridata.org/AqueductFloods20/`, leída por ventana con `/vsicurl/` para no bajar el GeoTIFF global entero.',
  },
  {
    title: 'Climate Central descartado como fuente de inundación costera',
    body: 'Su modelo de elevación es propietario y no publica una API abierta, así que un resultado suyo no sería reproducible ni auditable por quien reciba el reporte. Se prefirió WRI Aqueduct, que es CC-BY y documenta su metodología.',
  },
  {
    title: 'Protected Planet API vs. el FeatureServer de UNEP-WCMC',
    body: 'La API oficial de Protected Planet exige token. Se usa el FeatureServer público de UNEP-WCMC, que sirve la misma base (WDPA) sin registro. La obligación de citar a UNEP-WCMC se mantiene igual, y por eso viaja en el `FUENTES.txt` de cada descarga.',
  },
  {
    title: 'Paginación de los servicios MEPyD',
    body: 'Los FeatureServer de ArcGIS truncan en `maxRecordCount` y avisan con `exceededTransferLimit`. Se pagina por `resultOffset` hasta 10 páginas: sin eso, las capas densas se truncaban en silencio. Una capa cuyo servicio no responde se omite del resultado y queda anotada como faltante, nunca desaparece sin dejar rastro.',
  },
];

function FuentesPage() {
  const entries = sourceEntries();

  return (
    <main className="mx-auto min-h-dvh w-full max-w-4xl p-6">
      <Link to="/" className="text-12 text-accent font-medium underline underline-offset-2">
        ← Volver al mapa
      </Link>

      <header className="mt-3">
        <h1 className="text-18 text-fg font-semibold">Fuentes y metodología</h1>
        <p className="text-13 text-fg-muted mt-2 max-w-2xl">
          Todos los datos que puede usar un análisis, con su cita completa, su resolución nativa, su
          vigencia, su licencia y —sobre todo— sus límites conocidos. Nada de esto está escondido
          detrás de un click: un resultado territorial que no se puede rastrear hasta su fuente no
          sirve para sostener una decisión.
        </p>
        <p className="text-12 text-fg-muted mt-2 max-w-2xl">
          Cada descarga lleva esta misma información adentro del ZIP, en{' '}
          <code className="tabular">FUENTES.txt</code>, con la fecha exacta en que se consultó cada
          servicio.
        </p>
      </header>

      <nav aria-label="Índice de fuentes" className="mt-5 flex flex-wrap gap-2">
        {entries.map((entry) => (
          <a
            key={entry.source.name}
            href={`#${anchorId(entry.source.name)}`}
            className="rounded-chip border-border-base text-11 text-fg-muted hover:text-fg hover:border-border-strong border px-2 py-1"
          >
            {entry.source.name}
          </a>
        ))}
      </nav>

      <section className="mt-6 flex flex-col gap-4">
        {entries.map((entry) => (
          <SourceCard key={entry.source.name} entry={entry} />
        ))}
      </section>

      <section className="mt-8">
        <h2 className="text-15 text-fg font-semibold">Límites y decisiones de exclusión</h2>
        <p className="text-12 text-fg-muted mt-1 max-w-2xl">
          Lo que se probó y se descartó, y por qué. Está publicado porque el criterio que llevó a
          descartarlo es el mismo que hace confiable lo que sí quedó.
        </p>
        <ul className="mt-3 flex flex-col gap-3">
          {EXCLUSIONS.map((item) => (
            <li
              key={item.title}
              className="rounded-panel border-border-base bg-surface-2 border p-3"
            >
              <div className="flex items-start gap-2">
                <span className="text-warning mt-0.5 shrink-0">
                  <AlertIcon size={14} />
                </span>
                <div className="min-w-0">
                  <p className="text-12 text-fg font-semibold">{item.title}</p>
                  <p className="text-12 text-fg-muted mt-1">{item.body}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-15 text-fg font-semibold">Cómo citar</h2>
        <p className="text-12 text-fg-muted mt-1 max-w-2xl">
          Citá cada dataset por su nombre oficial y su proveedor —los de la ficha de arriba—
          agregando la fecha en que corriste el análisis. Territorio Base es la herramienta que armó
          el recorte y calculó los indicadores, no la fuente del dato: citarla a ella en lugar del
          dataset le saca al lector la posibilidad de ir a verificar.
        </p>
        <p className="text-12 text-fg-muted mt-2 max-w-2xl">
          Este material es un análisis territorial preliminar de gabinete. No reemplaza
          levantamientos de campo, estudios de detalle ni consultas a los organismos competentes.
        </p>
      </section>
    </main>
  );
}

function SourceCard({ entry }: { entry: SourceEntry }) {
  const { source } = entry;

  return (
    <article
      id={anchorId(source.name)}
      className="rounded-panel border-border-base bg-surface scroll-mt-4 border p-4"
    >
      <header className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="text-15 text-fg font-semibold">
            {source.url === '' ? (
              source.name
            ) : (
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-accent inline-flex items-center gap-1 underline underline-offset-2"
              >
                {source.name}
                <ExternalIcon size={13} />
              </a>
            )}
          </h2>
          <p className="text-12 text-fg-muted mt-0.5">{source.provider}</p>
        </div>
        <Badge tone={licenseTone(source.license)}>{licenseLabel(source.license)}</Badge>
      </header>

      <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
        <Field label="Resolución espacial" value={source.resolution} />
        <Field label="Vigencia / versión" value={source.vintage} />
        <Field label="Cobertura" value={source.coverage} />
        <Field label="Capas que la usan" value={String(entry.layers.length)} />
      </dl>

      {entry.endpoint !== null ? (
        <p className="text-11 text-fg-muted bg-surface-2 rounded-chip mt-3 overflow-x-auto px-2 py-1.5">
          <span className="text-fg-subtle font-semibold">Endpoint: </span>
          <code className="tabular">{entry.endpoint}</code>
        </p>
      ) : null}

      <div className="mt-3">
        <p className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">Método</p>
        <p className="text-12 text-fg-muted mt-1">{source.method}</p>
      </div>

      <div className="mt-3">
        <p className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">Licencia</p>
        <p className="text-12 text-fg-muted mt-1">{source.license}</p>
      </div>

      <div className="mt-3">
        <p className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">Cita</p>
        <p className="text-12 text-fg mt-1 italic">{source.citation}</p>
      </div>

      {source.caveat != null ? (
        <div className="rounded-panel border-warning/40 bg-warning-soft text-warning mt-3 border p-2.5">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 shrink-0">
              <InfoIcon size={14} />
            </span>
            <p className="text-12">
              <span className="font-semibold">Límite conocido: </span>
              {source.caveat}
            </p>
          </div>
        </div>
      ) : null}

      <details className="mt-3">
        <summary className="text-11 text-fg-muted hover:text-fg cursor-pointer">
          Ver las {entry.layers.length} capa(s) que salen de esta fuente
        </summary>
        <ul className="mt-1.5 flex flex-wrap gap-1.5">
          {entry.layers.map((label) => (
            <li
              key={label}
              className="rounded-chip bg-surface-3 text-11 text-fg-muted px-1.5 py-0.5"
            >
              {label}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-11 text-fg-subtle font-semibold tracking-wide uppercase">{label}</dt>
      <dd className="text-12 text-fg mt-0.5">{value}</dd>
    </div>
  );
}
