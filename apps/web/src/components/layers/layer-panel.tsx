import { useMemo, useState, type ReactNode } from 'react';

import { LayerRow, type LayerRuntime } from './layer-row';

import type { LayerDef, LayerRole, ThemeId } from '~/layers/types';

import { AccordionSection } from '~/components/ui/accordion';
import { CountBadge } from '~/components/ui/badge';
import { SearchIcon } from '~/components/ui/icons';
import { Input } from '~/components/ui/input';
import { buildLayerTree, LAYER_REGISTRY } from '~/layers/registry';
import { isPinnedContext, MAX_VISIBLE_DATA_LAYERS, countVisibleDataLayers } from '~/layers/vistas';

/**
 * La inundación costera no se puede dibujar con la fila genérica: necesita
 * un selector de escenario y su resultado (§4, UC-24). `CoastalControl`
 * reemplaza su fila y la ruta lo inyecta acá.
 */
export const COASTAL_LAYER_ID = 'aqueduct';
export const COASTAL_GROUP = 'Riesgo costero';

export type LayerPanelProps = {
  theme: ThemeId;
  visible: readonly string[];
  opacity: Readonly<Record<string, number>>;
  runtime: Readonly<Record<string, LayerRuntime>>;
  hasAoi: boolean;
  inRd: boolean;
  touch: boolean;
  onToggle: (layerId: string, next: boolean) => void;
  onOpacityChange: (layerId: string, value: number) => void;
  onRemove: (layerId: string) => void;
  onDownloadLayer: (layerId: string) => void;
  onRetryLayer: (layerId: string) => void;
  coastalControl?: ReactNode;
};

const ROLE_HEADERS: Record<LayerRole, string> = {
  medicion: 'Mediciones (generan datos en el reporte)',
  contexto: 'Contexto (solo visualización)',
};

const DEFAULT_RUNTIME: LayerRuntime = { status: 'ok' };

function matches(layer: LayerDef, query: string): boolean {
  if (query.length === 0) return true;
  const needle = query.toLowerCase();
  return (
    layer.label.toLowerCase().includes(needle) ||
    layer.group.toLowerCase().includes(needle) ||
    (layer.subgroup?.toLowerCase().includes(needle) ?? false)
  );
}

/**
 * Panel CAPAS (§4). Se construye ENTERO desde el registro: agregar la capa 40
 * es una fila de datos, no un componente nuevo (§11).
 */
export function LayerPanel(props: LayerPanelProps) {
  const {
    theme,
    visible,
    opacity,
    runtime,
    hasAoi,
    inRd,
    touch,
    onToggle,
    onOpacityChange,
    onRemove,
    onDownloadLayer,
    onRetryLayer,
    coastalControl,
  } = props;

  const [query, setQuery] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const available = useMemo(
    () =>
      LAYER_REGISTRY.filter((layer) => (layer.requiresRd === true ? inRd : true)).filter((layer) =>
        matches(layer, query),
      ),
    [inRd, query],
  );

  const tree = useMemo(() => buildLayerTree(available), [available]);
  const visibleSet = useMemo(() => new Set(visible), [visible]);
  const dataLayerCount = countVisibleDataLayers(visible);
  const capReached = dataLayerCount >= MAX_VISIBLE_DATA_LAYERS;

  const isOpen = (key: string, fallback: boolean) => collapsed[key] ?? fallback;
  const toggleOpen = (key: string, fallback: boolean) => {
    setCollapsed((current) => ({ ...current, [key]: !(current[key] ?? fallback) }));
  };

  const renderRows = (layers: LayerDef[]) => {
    const groups: LayerRole[] = ['medicion', 'contexto'];

    return groups.map((role) => {
      const rows = layers.filter((layer) => layer.role === role && layer.id !== COASTAL_LAYER_ID);
      if (rows.length === 0) return null;

      return (
        <div key={role}>
          {/* §4.4 — el split medición/contexto se ROTULA en el panel: dejarlo
              sólo en la documentación es el error clásico de GFW. */}
          <h4 className="bg-surface-2 text-11 text-fg-subtle flex h-6 items-center px-3 font-semibold tracking-wide uppercase">
            {ROLE_HEADERS[role]}
          </h4>
          {rows.map((layer) => {
            const checked = visibleSet.has(layer.id);
            return (
              <LayerRow
                key={layer.id}
                layer={layer}
                checked={checked}
                opacity={opacity[layer.id] ?? layer.defaultOpacity}
                runtime={runtime[layer.id] ?? DEFAULT_RUNTIME}
                pinned={checked && isPinnedContext(layer.id, theme)}
                canDownload={hasAoi}
                touch={touch}
                onToggle={(next) => {
                  onToggle(layer.id, next);
                }}
                onOpacityChange={(value) => {
                  onOpacityChange(layer.id, value);
                }}
                onRemove={() => {
                  onRemove(layer.id);
                }}
                onDownload={() => {
                  onDownloadLayer(layer.id);
                }}
                onRetry={() => {
                  onRetryLayer(layer.id);
                }}
              />
            );
          })}
        </div>
      );
    });
  };

  const activeCount = (layers: LayerDef[]) =>
    layers.filter((layer) => visibleSet.has(layer.id) && layer.alwaysOn !== true).length;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="shrink-0 p-3">
        <Input
          type="search"
          value={query}
          aria-label="Buscar capa"
          placeholder="Buscar capa…"
          leadingIcon={<SearchIcon size={14} />}
          className="h-9"
          onChange={(event) => {
            setQuery(event.target.value);
          }}
        />
        {capReached ? (
          <p className="text-11 text-warning mt-2">
            Tope de {MAX_VISIBLE_DATA_LAYERS} capas de datos visibles alcanzado. Apagá una para
            prender otra.
          </p>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tree.length === 0 ? (
          <p className="text-12 text-fg-muted p-4">Ninguna capa coincide con «{query}».</p>
        ) : null}

        {tree.map((group) => {
          const groupLayers = [...group.layers, ...group.subgroups.flatMap((sub) => sub.layers)];
          const openByDefault = query.length > 0 || activeCount(groupLayers) > 0;

          return (
            <AccordionSection
              key={group.name}
              title={group.name}
              open={isOpen(group.name, openByDefault)}
              onToggle={() => {
                toggleOpen(group.name, openByDefault);
              }}
              trailing={
                <CountBadge
                  count={activeCount(groupLayers)}
                  label={`capas activas en ${group.name}`}
                />
              }
            >
              {renderRows(group.layers)}
              {group.name === COASTAL_GROUP ? coastalControl : null}

              {group.subgroups.map((sub) => {
                const subKey = `${group.name}/${sub.name}`;
                const subOpen = query.length > 0 || activeCount(sub.layers) > 0;
                return (
                  <AccordionSection
                    key={subKey}
                    level={1}
                    title={sub.name}
                    open={isOpen(subKey, subOpen)}
                    onToggle={() => {
                      toggleOpen(subKey, subOpen);
                    }}
                    trailing={
                      <CountBadge
                        count={activeCount(sub.layers)}
                        label={`capas activas en ${sub.name}`}
                      />
                    }
                  >
                    {renderRows(sub.layers)}
                  </AccordionSection>
                );
              })}
            </AccordionSection>
          );
        })}
      </div>
    </div>
  );
}
