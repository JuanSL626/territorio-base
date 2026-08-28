/*
  Sincronizador de capas: estado deseado → mutaciones mínimas sobre el mapa.

  Por qué existe: con ~45 capas en el registro (39 de ellas MEPyD, alguna con
  ~1 600 puntos), reconstruir fuentes y capas en cada render es la diferencia
  entre un mapa fluido y uno que traba el hilo principal cada vez que se
  mueve un slider.

  Este módulo hace UNA cosa: comparar lo deseado contra lo ya montado y aplicar
  sólo la diferencia.
    · Fuente ya montada con los MISMOS datos (identidad de objeto) → no se
      vuelve a llamar `setData`. Por eso `buildVectorData` se memoiza: la
      identidad del `FeatureCollection` es la señal de "cambió de verdad".
    · Cambió sólo la opacidad → `setPaintProperty`, sin tocar la fuente. Es lo
      que hace que arrastrar el slider no reproyecte 1 600 puntos.
    · Capa apagada → se quitan sus capas Y su fuente. Con 39 capas MEPyD,
      dejarlas montadas invisibles cuesta memoria y tiempo de tile por nada.

  Y regresión #6 del inventario: TODO esto es cliente. Prender una capa no
  vuelve al servidor jamás.
*/

import {
  FEATURE_ID_KEY,
  rasterOverlaySpec,
  sortKey,
  sourceIdFor,
  vectorLayerSpecs,
  type StyledLayer,
} from './layer-style';

import type { ImageCoordinates } from './overlays';
import type { FeatureCollection } from '@territorio/geo/geojson';
import type { GeoJSONSource, ImageSource, Map as MapLibreMap } from 'maplibre-gl';
import type { LayerDef } from '~/layers/types';

export type DesiredVectorLayer = {
  kind: 'vector';
  layer: LayerDef;
  registryIndex: number;
  opacity: number;
  /** La IDENTIDAD de este objeto es la señal de cambio. No lo clones. */
  data: FeatureCollection;
};

export type DesiredRasterLayer = {
  kind: 'raster';
  layer: LayerDef;
  registryIndex: number;
  opacity: number;
  url: string;
  /** TL, TR, BR, BL — ver el bloque de regresión #1 en `overlays.ts`. */
  coordinates: ImageCoordinates;
};

export type DesiredLayer = DesiredVectorLayer | DesiredRasterLayer;

type PlacedLayer = { id: string; key: number };

type Mounted = {
  kind: 'vector' | 'raster';
  opacity: number;
  data: FeatureCollection | null;
  url: string | null;
  coordinatesKey: string;
  placed: PlacedLayer[];
};

function coordinatesKeyOf(coordinates: ImageCoordinates): string {
  return coordinates.map((pair) => pair.join(',')).join(';');
}

function specsFor(item: DesiredLayer): StyledLayer[] {
  return item.kind === 'vector'
    ? vectorLayerSpecs(item.layer, item.opacity)
    : [rasterOverlaySpec(item.layer.id, item.opacity)];
}

export class LayerSyncer {
  private readonly map: MapLibreMap;
  private mounted = new Map<string, Mounted>();
  private highlight: { layerId: string; featureId: string; mapLayerIds: string[] } | null = null;

  constructor(map: MapLibreMap) {
    this.map = map;
  }

  /**
   * Olvida todo lo montado SIN tocar el mapa.
   *
   * Se llama después de `setStyle` (cambio de mapa base), que borra el estilo
   * entero del lado de MapLibre: si no se olvidara, el siguiente `sync` creería
   * que las capas siguen ahí y no volvería a agregarlas. Es el bug clásico del
   * cambio de basemap, y por eso el reset es explícito y no un efecto de borde.
   */
  forget(): void {
    this.mounted = new Map();
    this.highlight = null;
  }

  interactiveLayerIds(): string[] {
    const ids: string[] = [];
    for (const entry of this.mounted.values()) {
      if (entry.kind !== 'vector') continue;
      for (const placed of entry.placed) ids.push(placed.id);
    }
    return ids;
  }

  /**
   * `mapLayerId` → id de capa del REGISTRO.
   *
   * La identidad de capa es ESTRUCTURAL (§12.6): sale de la tabla que armó
   * este mismo objeto al montar la capa, nunca de adivinar mirando el feature.
   */
  registryLayerOf(mapLayerId: string): string | undefined {
    for (const [layerId, entry] of this.mounted) {
      if (entry.placed.some((placed) => placed.id === mapLayerId)) return layerId;
    }
    return undefined;
  }

  hasLayer(layerId: string): boolean {
    return this.mounted.has(layerId);
  }

  sync(desired: readonly DesiredLayer[]): void {
    const wanted = new Set(desired.map((item) => item.layer.id));

    for (const [layerId, entry] of [...this.mounted]) {
      if (!wanted.has(layerId)) this.unmount(layerId, entry);
    }

    for (const item of desired) {
      if (this.mounted.has(item.layer.id)) this.update(item);
      else this.mount(item);
    }

    this.raiseHighlight();
  }

  private mount(item: DesiredLayer): void {
    const sourceId = sourceIdFor(item.layer.id);

    if (this.map.getSource(sourceId) === undefined) {
      if (item.kind === 'vector') {
        this.map.addSource(sourceId, {
          type: 'geojson',
          data: item.data,
          // Sube el id sintético a `feature.id`: sin esto no hay
          // `setFeatureState` y por lo tanto no hay resaltado de hover.
          promoteId: FEATURE_ID_KEY,
        });
      } else {
        this.map.addSource(sourceId, {
          type: 'image',
          url: item.url,
          // Las esquinas llegan verificadas desde el servicio y se pasan TAL
          // CUAL. Regresión #1: acá no se voltea nada. Ver `overlays.ts`.
          coordinates: item.coordinates,
        });
      }
    }

    const alwaysOn = item.layer.alwaysOn === true;
    const placed: PlacedLayer[] = [];

    for (const styled of specsFor(item)) {
      const key = sortKey(styled.role, item.registryIndex, alwaysOn);
      if (this.map.getLayer(styled.id) === undefined) {
        this.map.addLayer(styled.spec, this.beforeIdFor(key));
      }
      placed.push({ id: styled.id, key });
    }

    this.mounted.set(item.layer.id, {
      kind: item.kind,
      opacity: item.opacity,
      data: item.kind === 'vector' ? item.data : null,
      url: item.kind === 'raster' ? item.url : null,
      coordinatesKey: item.kind === 'raster' ? coordinatesKeyOf(item.coordinates) : '',
      placed,
    });
  }

  /**
   * Id de la capa ya montada que va INMEDIATAMENTE arriba de `key`.
   * `undefined` = va al tope. El orden lo define `sortKey` (ver `layer-style.ts`).
   */
  private beforeIdFor(key: number): string | undefined {
    let bestId: string | undefined;
    let bestKey = Number.POSITIVE_INFINITY;

    for (const entry of this.mounted.values()) {
      for (const placed of entry.placed) {
        if (placed.key > key && placed.key < bestKey) {
          bestKey = placed.key;
          bestId = placed.id;
        }
      }
    }

    return bestId;
  }

  private update(item: DesiredLayer): void {
    const entry = this.mounted.get(item.layer.id);
    if (entry === undefined) return;
    const sourceId = sourceIdFor(item.layer.id);

    if (item.kind === 'vector') {
      if (entry.data !== item.data) {
        const source = this.map.getSource<GeoJSONSource>(sourceId);
        if (source !== undefined) void source.setData(item.data);
        entry.data = item.data;
      }
    } else {
      const coordinatesKey = coordinatesKeyOf(item.coordinates);
      if (entry.url !== item.url || entry.coordinatesKey !== coordinatesKey) {
        const source = this.map.getSource<ImageSource>(sourceId);
        source?.updateImage({ url: item.url, coordinates: item.coordinates });
        entry.url = item.url;
        entry.coordinatesKey = coordinatesKey;
      }
    }

    if (entry.opacity !== item.opacity) {
      this.applyOpacity(item, entry.placed);
      entry.opacity = item.opacity;
    }
  }

  /**
   * Reaplica sólo las propiedades de pintura que dependen de la opacidad.
   *
   * Se reconstruyen los specs para no duplicar acá la aritmética del relleno
   * (`opacidad × fillFactor`, regresión #4): esa cuenta vive en UN solo lugar,
   * `layer-style.ts`, y este módulo la lee.
   */
  private applyOpacity(item: DesiredLayer, placed: readonly PlacedLayer[]): void {
    const known = new Set(placed.map((entry) => entry.id));

    for (const styled of specsFor(item)) {
      if (!known.has(styled.id) || this.map.getLayer(styled.id) === undefined) continue;

      switch (styled.role) {
        case 'fill':
          this.map.setPaintProperty(styled.id, 'fill-opacity', styled.spec.paint?.['fill-opacity']);
          break;
        case 'outline':
        case 'line':
          this.map.setPaintProperty(styled.id, 'line-opacity', styled.spec.paint?.['line-opacity']);
          break;
        case 'point':
          this.map.setPaintProperty(
            styled.id,
            'circle-opacity',
            styled.spec.paint?.['circle-opacity'],
          );
          this.map.setPaintProperty(
            styled.id,
            'circle-stroke-opacity',
            styled.spec.paint?.['circle-stroke-opacity'],
          );
          break;
        case 'raster':
          this.map.setPaintProperty(
            styled.id,
            'raster-opacity',
            styled.spec.paint?.['raster-opacity'],
          );
          break;
      }
    }
  }

  private unmount(layerId: string, entry: Mounted): void {
    for (const placed of entry.placed) {
      if (this.map.getLayer(placed.id) !== undefined) this.map.removeLayer(placed.id);
    }
    if (this.highlight?.layerId === layerId) this.clearHighlight();
    const sourceId = sourceIdFor(layerId);
    if (this.map.getSource(sourceId) !== undefined) this.map.removeSource(sourceId);
    this.mounted.delete(layerId);
  }

  setHighlight(specs: readonly StyledLayer[], layerId: string, featureId: string): void {
    if (this.highlight?.layerId === layerId && this.highlight.featureId === featureId) return;
    this.clearHighlight();
    if (!this.mounted.has(layerId)) return;

    const mapLayerIds: string[] = [];
    for (const styled of specs) {
      if (this.map.getLayer(styled.id) === undefined) this.map.addLayer(styled.spec);
      mapLayerIds.push(styled.id);
    }
    this.highlight = { layerId, featureId, mapLayerIds };
  }

  clearHighlight(): void {
    const current = this.highlight;
    if (current === null) return;
    for (const id of current.mapLayerIds) {
      if (this.map.getLayer(id) !== undefined) this.map.removeLayer(id);
    }
    this.highlight = null;
  }

  /** El resaltado tiene que quedar arriba de cualquier capa agregada después. */
  private raiseHighlight(): void {
    const current = this.highlight;
    if (current === null) return;
    for (const id of current.mapLayerIds) {
      if (this.map.getLayer(id) !== undefined) this.map.moveLayer(id);
    }
  }
}
