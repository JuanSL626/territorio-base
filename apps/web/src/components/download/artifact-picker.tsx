import { useState } from 'react';

import { Badge } from '~/components/ui/badge';
import { Checkbox } from '~/components/ui/checkbox';
import { AlertIcon, ChevronDown, ChevronRight } from '~/components/ui/icons';
import { cn } from '~/lib/cn';
import { groupArtifacts, type ExportArtifactPlan, type ExportPlan } from '~/lib/export-contract';
import { formatBytes } from '~/lib/format';

/*
  La lista de artefactos del §7.2, agrupada como el panel de capas.

  La decisión de diseño que importa está en `ArtifactRow`: una capa que el
  análisis NO produjo se renderiza igual que una que sí, pero gris, sin checkbox
  y CON EL MOTIVO abajo. No se filtra de la lista.

  Filtrarla sería más limpio y sería mentir: el usuario que exporta después de
  que Overpass se cayó tiene que ver «Hidrología (OSM) — el servicio no
  respondió» en la misma lista donde ve todo lo demás, o se lleva un ZIP
  incompleto creyendo que el territorio no tiene ríos.
*/

export type ArtifactPickerProps = {
  plan: ExportPlan;
  selected: ReadonlySet<string>;
  onToggle: (artifactId: string, next: boolean) => void;
  onToggleGroup: (artifactIds: string[], next: boolean) => void;
};

function ArtifactRow({
  artifact,
  checked,
  onToggle,
}: {
  artifact: ExportArtifactPlan;
  checked: boolean;
  onToggle: (next: boolean) => void;
}) {
  const disabled = !artifact.selectable;

  const meta = [
    artifact.formats,
    artifact.featureCount === null
      ? null
      : `${artifact.featureCount.toLocaleString('es-DO')} elementos`,
    artifact.estimatedBytes > 0 ? `~${formatBytes(artifact.estimatedBytes)}` : null,
  ]
    .filter((part): part is string => part !== null)
    .join(' · ');

  return (
    <li
      className={cn(
        'border-border-base/60 flex items-start gap-2 border-b px-3 py-2 last:border-b-0',
        disabled ? 'bg-surface-2/40' : null,
      )}
    >
      <span className="min-w-0 flex-1">
        {artifact.mandatory ? (
          <span className="flex min-w-0 items-start gap-2">
            <span className="text-success mt-px shrink-0">
              <ChevronRight size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-13 text-fg block">{artifact.label}</span>
              <span className="text-11 text-fg-muted mt-0.5 block">{meta}</span>
            </span>
          </span>
        ) : disabled ? (
          <span className="flex min-w-0 items-start gap-2 opacity-70">
            <span className="text-warning mt-px shrink-0">
              <AlertIcon size={14} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="text-13 text-fg-muted block">{artifact.label}</span>
              <span className="text-11 text-fg-muted mt-0.5 block">{artifact.reason}</span>
            </span>
          </span>
        ) : (
          <Checkbox
            label={artifact.label}
            description={meta}
            checked={checked}
            onChange={(event) => {
              onToggle(event.currentTarget.checked);
            }}
          />
        )}
      </span>

      {artifact.mandatory ? (
        <Badge tone="neutral">siempre</Badge>
      ) : disabled ? (
        <Badge tone="warning">no disponible</Badge>
      ) : null}
    </li>
  );
}

function GroupBlock({
  group,
  artifacts,
  selected,
  onToggle,
  onToggleGroup,
}: {
  group: string;
  artifacts: ExportArtifactPlan[];
  selected: ReadonlySet<string>;
  onToggle: (artifactId: string, next: boolean) => void;
  onToggleGroup: (artifactIds: string[], next: boolean) => void;
}) {
  const selectable = artifacts.filter((artifact) => artifact.selectable && !artifact.mandatory);
  const chosen = selectable.filter((artifact) => selected.has(artifact.id));
  // Los grupos grandes (MEPyD son hasta 39 capas) arrancan colapsados.
  const [open, setOpen] = useState(artifacts.length <= 8);

  const allOn = selectable.length > 0 && chosen.length === selectable.length;

  return (
    <section className="rounded-panel border-border-base bg-surface overflow-hidden border">
      <div className="border-border-base bg-surface-2 flex h-9 items-center gap-2 border-b px-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => {
            setOpen((value) => !value);
          }}
          className="text-12 text-fg flex min-w-0 flex-1 items-center gap-1.5 text-left font-semibold"
        >
          <span className="text-fg-muted shrink-0">
            {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </span>
          <span className="truncate">{group}</span>
          <span className="text-11 text-fg-subtle shrink-0 font-normal">
            {chosen.length}/{selectable.length}
          </span>
        </button>

        {selectable.length > 1 ? (
          <button
            type="button"
            onClick={() => {
              onToggleGroup(
                selectable.map((artifact) => artifact.id),
                !allOn,
              );
            }}
            className="text-11 text-accent shrink-0 font-medium underline underline-offset-2"
          >
            {allOn ? 'Ninguna' : 'Todas'}
          </button>
        ) : null}
      </div>

      {open ? (
        <ul className="flex flex-col">
          {artifacts.map((artifact) => (
            <ArtifactRow
              key={artifact.id}
              artifact={artifact}
              checked={selected.has(artifact.id)}
              onToggle={(next) => {
                onToggle(artifact.id, next);
              }}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

export function ArtifactPicker({ plan, selected, onToggle, onToggleGroup }: ArtifactPickerProps) {
  const groups = groupArtifacts(plan.artifacts);

  return (
    <div className="flex flex-col gap-3">
      {groups.map((entry) => (
        <GroupBlock
          key={entry.group}
          group={entry.group}
          artifacts={entry.artifacts}
          selected={selected}
          onToggle={onToggle}
          onToggleGroup={onToggleGroup}
        />
      ))}
    </div>
  );
}
