/*
  PLACEHOLDER — el cuerpo del story-map (§6) lo construye la fase siguiente:
  sidecar con mapa sticky + narrativa scrolleable, scrollama con
  `offset: 0.55` / `threshold: 4`, un estado de mapa declarativo por sección,
  y las tarjetas de métrica con su ⓘ / ⤢ / ⤓.

  El shell ya renderiza el marco, el encabezado y la tabla de fuentes; lo que
  falta es el contenido de las secciones.
*/

export type ReportSectionId =
  | 'portada'
  | 'topografia'
  | 'vegetacion'
  | 'hidrologia'
  | 'areas-protegidas'
  | 'riesgo-costero'
  | 'contexto-rd'
  | 'fuentes';

export type ReportBodyProps = {
  analysisId: string;
  /** La variante de impresión reemplaza cada mapa vivo por un PNG pre-horneado (§6.6). */
  print?: boolean;
};

export function ReportBody({ analysisId, print = false }: ReportBodyProps) {
  return (
    <div className="rounded-panel border-border-strong bg-surface border border-dashed p-6">
      <p className="text-13 text-fg font-semibold">Cuerpo del reporte pendiente</p>
      <p className="text-12 text-fg-muted mt-1">
        Análisis <span className="tabular">{analysisId}</span>
        {print ? ' · render de impresión' : ''}. Las secciones del §6.2 se montan en la fase de
        features.
      </p>
    </div>
  );
}
