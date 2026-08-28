# DESIGN BRIEF — territorio-base, nueva UI web (TanStack Start)

**Version:** 1.0 · Scope: full front-end IA + component specs, buildable without further guessing. UI copy in Spanish (RD audience, mixed GIS fluency); code identifiers in English.

Grounded in the existing Python engine at `/Users/juanlopez/Code/territorio-base/src/territorio_base/` — the metric names, class bins, layer groups and source list below are the ones the engine actually emits today (`analysis/topography.py`, `analysis/vegetation.py`, `sources/osm.py`, `sources/protected_areas.py`, `sources/mepyd_rd.py`, `sources/aqueduct.py`).

---

## 0. Design principles (non-negotiable, resolve every later argument)

1. **The map is the page, not a widget on the page.** Every route except `/reporte/:id` renders the map full-bleed; panels dock over/beside it, never above it in the scroll flow.
2. **One panel slot for browsing, one for inspecting.** Left = "what am I looking at / what did I get" (always present). Right = "what is this thing I just clicked" (hidden until selection). Never a third competing panel.
3. **AOI is a first-class persistent object**, drawn/uploaded once, surviving theme switches, layer toggles, pans, and reloads (it lives in the URL).
4. **A layer is a data record, not code.** Adding the 40th layer must be a JSON entry in a registry + a color, never a new component.
5. **Nothing is computed silently and nothing fails silently.** Every layer has an explicit `pending | ok | empty | error | skipped` state that is visible in the same row where the layer lives.

---

## 1. Information architecture

### 1.1 Routes (TanStack Start file routes)

```
/                                  → Mapa (the app). No AOI yet: empty-state coach.
/?aoi=<id>&theme=<t>&layers=<csv>&op=<csv>&sel=<layerId:featureId>&bbox=<..>
/reporte/$analysisId               → Story-map report (SSR, shareable, printable)
/reporte/$analysisId/imprimir      → Print-preview render (static map PNGs, no live GL)
/descargas/$jobId                  → Async export job status + download (deep-linkable)
/fuentes                           → Static "Fuentes y metodología" table (also embedded at report end)
```

All map state is URL state (TanStack Router search params, zod-validated). Rule: **if a colleague pastes the URL, they see the same map.** `aoi` is a server-side id (AOI geometry is not in the querystring — a 400-vertex KML would blow the URL); `layers` is a csv of layer ids; `op` a parallel csv of `id:opacity` only for non-default opacities.

### 1.2 Domain entities (TS contracts the whole UI is built on)

```ts
type ThemeId = 'topografia' | 'vegetacion' | 'hidrologia' | 'areas-protegidas' | 'riesgo-rd';

type LayerKind = 'raster-continuous' | 'raster-categorical' | 'vector-line' | 'vector-polygon' | 'vector-point';

type LayerDef = {
  id: string;                    // 'dem', 'slope', 'ndvi', 'worldcover', 'osm-hydro', 'wdpa', 'mepyd:amenazas/deslizamiento'
  label: string;                 // UI Spanish label
  group: string;                 // 'Topografía' | 'Vegetación' | 'Hidrología' | 'Áreas protegidas' | MEPyD group name
  themes: ThemeId[];             // which views turn it on by default
  kind: LayerKind;
  role: 'medicion' | 'contexto'; // GFW's research vs AOI-layer split — MADE VISIBLE (see §4.4)
  defaultOn: boolean;
  defaultOpacity: number;        // 0..1
  legend: LegendSpec;            // ramp stops or class swatches
  source: SourceRef;             // name, url, vintage, resolution, license, citation
  popup?: PopupConfig;           // §5.2 — required for every vector layer
  exports: ExportFormat[];       // ['geotiff'] | ['shp','geojson'] — drives §7 dynamic format list
  metrics?: MetricCardId[];      // which report cards this layer feeds
};
```

The registry (`packages/layers/registry.ts`) is the single source of truth for: legend panel, map style layers, click handlers, report card ordering, export menu, and the sources table. **Nothing about a layer is hardcoded anywhere else.**

### 1.3 Layer catalog as it stands today (seed the registry with these)

| group | layers | kind | exports |
|---|---|---|---|
| Topografía | Elevación (DEM GLO-30, 30 m), Pendiente %, Clases de pendiente (Plano 0-5 / Suave 5-15 / Moderado 15-30 / Fuerte >30), Orientación | raster-continuous / categorical | geotiff |
| Vegetación | NDVI mediana 180 d, Clases de densidad NDVI (4 clases), Cobertura ESA WorldCover 2021 | raster-continuous / categorical | geotiff |
| Hidrología | OSM `waterway`, `natural=water`, `natural=wetland` (buffer 500 m) | vector-line / polygon | shp, geojson |
| Áreas protegidas | WDPA (UNEP-WCMC) | vector-polygon | shp, geojson |
| Riesgo costero | WRI Aqueduct Floods v2 (escenario × período de retorno, ~927 m) | raster-continuous | geotiff |
| Contexto RD (MEPyD) | 7 grupos, ~35 capas: División Político-Administrativa, Amenaza sísmica (censal), Amenazas, Agua, Infraestructuras y edificaciones, Vías, Áreas protegidas (MEPyD) | vector-* | shp, geojson |

The MEPyD tree must keep the exact group names and order already used in `sources/mepyd_rd.py::LAYERS` — recognizability with the *Explorador de Riesgo 2.1* is a deliberate asset.

---

## 2. Screen layout — desktop (≥1280 px)

```
┌───────────────────────────────────────────────────────────────────────────────────┐
│ TOPBAR  h=48px  [logo/name] [Vista: Topografía|Vegetación|Hidrología|Prot.|RD] ... │ ← theme segmented control, centered
│                                              [AOI: 128,4 ha ▾] [Reporte] [Exportar]│
├──────────────┬────────────────────────────────────────────────────┬───────────────┤
│ LEFT PANEL   │                                          [TOOLBAR] │ INSPECTOR     │
│ w=360px      │                  MAP (fills)                       │ w=380px       │
│ fixed        │                                             40x40  │ hidden until  │
│ full-height  │                                             stack  │ selection     │
│              │                                             ▲ top- │               │
│ tabs:        │                                             right  │               │
│ CAPAS |      │                                             16px   │               │
│ ANÁLISIS     │                                             inset  │               │
│              │                                                    │               │
│ [scroll]     │  ┌──────────────┐                                  │               │
│              │  │ scale + attrib│  bottom-left, 12px inset        │               │
│ ───────────  │  └──────────────┘        [minimapa/leyenda compacta]│              │
│ bottom bar   │                                                    │               │
│ h=40px       │                                                    │               │
└──────────────┴────────────────────────────────────────────────────┴───────────────┘
```

**Regions and exact sizes**

| Region | Size | Behavior |
|---|---|---|
| Topbar | h 48px, fixed | Left: wordmark (max 160px). Center: theme segmented control (5 items, 32px tall, 12px label). Right: AOI chip (shows `128,4 ha` + caret → menu: Ver límites, Reemplazar, Descargar AOI, Borrar), `Reporte` (secondary btn), `Exportar` (primary btn). Both right buttons disabled with tooltip "Dibujá o subí un AOI primero" until an AOI exists. |
| Left panel | w 360px fixed, full height minus topbar | Two text tabs with underline indicator (`CAPAS` / `ANÁLISIS`), h 44px. Body scrolls. Bottom bar h 40px pinned, dark (`--surface-inverse`), holds the one supplemental toggle: **"Ver huellas de escenas Sentinel-2 usadas"** (checkbox + label). Collapsible to a 48px icon rail via a chevron button on its right edge. |
| Map | flex-fill | MapLibre GL. Padding-aware `fitBounds` so the AOI never lands under a panel: `padding: {left: 360+24, right: inspectorOpen?380+24:24, top: 48+24, bottom: 24}`. |
| Map toolbar | vertical stack, top-right, 16px inset, buttons 40×40, 8px gap, rounded 8px, white/`--surface` with 1px border | Order (steal Copernicus): ① Dibujar AOI ② Subir AOI ③ Medir ④ Comparar (split/opacidad) ⑤ Basemap switcher ⑥ Ubicación/zoom-a-AOI. Each has an *icon + tooltip*, and the first two also carry a visible 11px label under the icon (mixed-GIS-fluency audience → don't ship icon-only for the primary action). |
| Inspector | w 380px, right, slides in 180ms ease-out | Hidden by default; opens on feature click or on a legend row's "ver datos" action. Persists through pan/zoom. Has an explicit ✕ close, top-right, 32×32. |
| Bottom-left cluster | 12px inset | Scale bar, attribution line ("© OpenStreetMap · Copernicus · ESA · UNEP-WCMC · MEPyD"), and a 28px-tall "Leyenda compacta" pill that expands the active-layer legend over the map for users who collapsed the left panel. |

**Never both panels at max on <1440px:** at 1280–1439 with the inspector open, the left panel auto-collapses to the 48px icon rail (remembering that it was auto-collapsed, and restoring on inspector close).

---

## 3. Theme / view system ("VISTAS")

Themes are **layer presets + map framing + inspector defaults**, not separate pages. Switching a theme:

1. Turns off every `medicion` layer not in the new theme, turns on that theme's defaults (max **4 visible data layers at once** — Esri's own docs warn stories/maps bog down past ~5; enforce it).
2. Leaves `contexto` layers the user manually enabled **on** (a user who turned on "Vías" wants it everywhere) — mark them with a small pin glyph so it's clear why they survived.
3. Swaps the basemap: `topografia` → terrain/hillshade; `vegetacion` → satellite; `hidrologia` / `areas-protegidas` / `riesgo-rd` → light vector basemap.
4. Re-orders the ANÁLISIS tab's result cards so the current theme's cards come first (never hides the others).
5. Animates the map only if the AOI is off-screen (no gratuitous flyTo).

Theme defaults:

| Vista | layers on | basemap | inspector default tab |
|---|---|---|---|
| Topografía | Clases de pendiente (0.7), Elevación (0.5, off by default), AOI | terrain | Atributos |
| Vegetación | Clases de densidad NDVI (0.75), WorldCover (off), AOI | satélite | Atributos |
| Hidrología | OSM hidrología (1.0), MEPyD Agua ▸ Ríos y arroyos (0.8), AOI | claro | Atributos |
| Áreas protegidas | WDPA (0.45 fill / 1.0 outline), MEPyD Áreas protegidas (0.35), AOI | claro | Atributos |
| Riesgo RD | MEPyD Amenazas ▸ (deslizamiento, inundación, tsunami) at 0.35 fill, AOI | claro | Atributos |

The `Riesgo RD` tab is **hidden entirely** (not disabled) when the AOI is outside `RD_BBOX` — mirror the engine's own `is_in_rd()` and GFW's "don't render empty categories" rule. Show a one-line note in the ANÁLISIS tab instead: *"Contexto RD no aplica: el AOI está fuera de República Dominicana."*

---

## 4. Layer panel spec (`CAPAS` tab)

### 4.1 Structure

```
┌ CAPAS │ ANÁLISIS ─────────────────────────────┐  44px tabs
│ [🔍 Buscar capa…]                    36px     │  filters the whole tree, incl. MEPyD's ~35
├────────────────────────────────────────────────┤
│ ▾ Topografía                            (2)   │  group header, h 44px, badge if count>0
│    ▦ Clases de pendiente        ⓘ ◐ ✕   48px  │
│      [────────●─────] 70%               32px  │  ← inline slider, only when ◐ toggled
│    ▦ Elevación (DEM)            ⓘ ◐ ✕         │
│ ▸ Vegetación                            (1)   │
│ ▸ Hidrología                                  │
│ ▸ Áreas protegidas                      (1)   │
│ ▸ Contexto RD (MEPyD)                   (3)   │  ← nested second-level groups inside
├────────────────────────────────────────────────┤
│ ☐ Ver huellas de escenas Sentinel-2      40px │  pinned dark bar
└────────────────────────────────────────────────┘
```

### 4.2 Group header
h 44px · chevron 16px · label 13px/600 · **count badge**: 18px pill, `--accent` fill, white 11px numeral, right-aligned, rendered only when >0 active in that group (including collapsed descendants). MEPyD nests one level deeper (group → subgroup → layer), indent 16px per level.

### 4.3 Layer row (48px) — fixed left-to-right order
`⠿ drag handle (16px, z-order)` · `legend swatch (14×14 or 24×8 ramp)` · `checkbox+label (13px, truncate w/ title attr)` · *spacer* · `ⓘ info (28×28)` · `◐ opacity (28×28)` · `✕ remove (28×28, only for user-added/context layers)`.

- **ⓘ** opens a **popover** (not a modal), 300px wide, anchored right: source name (linked), vintage/version, native resolution, license, one-sentence method, and a footer button **"Descargar esta capa recortada al AOI"** (steals GFW's legend-info→download route, so layer-level download never requires clicking features one by one).
- **◐** toggles an inline slider row *below* the layer row (h 32px, full width, numeric % readout at right). Value persists in URL `op=`.
- **Threshold sub-controls** (analogous to GFW's canopy-density control) live as an indented sub-row: slope class cut-offs and NDVI class cut-offs are editable there, defaulting to the engine's bins. Changing them re-renders the classified raster client-side from the continuous GeoTIFF/PNG the server already produced — no re-analysis.
- **Disabled/greyed state:** a layer whose data doesn't exist yet for this AOI renders greyed with an inline reason chip ("sin AOI" / "sin escenas S2" / "servicio caído — reintentar"), never as a live-looking checkbox. Steal ArcGIS's grey-out-when-not-applicable affordance.

### 4.4 Make the medición/contexto split visible
GFW's biggest documented UX sin is that this split exists only in help docs. Here it must be labeled in the panel: a 24px sub-header inside each group reading **"Mediciones (generan datos en el reporte)"** vs **"Contexto (solo visualización)"**, with `medicion` rows carrying a tiny bar-chart glyph after the label. Toggling a `medicion` layer on/off while an analysis exists adds/removes its card in the ANÁLISIS tab in real time.

---

## 5. Feature inspector spec

### 5.1 Interaction
- Bind **per-layer** handlers at style-load: `map.on('click', layerId, handler)` + `mouseenter/mouseleave` for the pointer cursor. Layer identity is then structural — never inferred post-hoc from a global hit-test. (`queryRenderedFeatures` is used only for the *overlap* case, below.)
- **Overlapping features:** if a single click hits >1 interactive layer, the inspector opens with a 32px-tall stacked "resultados" list at the top: `Ríos y arroyos · 1`, `Área protegida · 2` — clicking one drills into it, a back-chevron returns. Never guess a winner.
- Selected feature gets a highlight paint layer (`--accent`, 3px outline / 30% fill), and `sel=` goes in the URL so a selection is shareable.

### 5.2 Popup/field config — required per layer, versioned in the repo
```ts
type PopupConfig = {
  title: string;                       // template: "{name}" | "Río {name}" | fallback "Sin nombre"
  subtitle?: string;                   // "{waterway} · OSM {osm_id}"
  fields: Array<{ key: string; alias: string; format?: 'number'|'area-ha'|'distance-m'|'date'|'text'; decimals?: number; }>;
  derived?: Array<{ alias: string; compute: (f, aoiCtx) => string }>;  // e.g. "Distancia al AOI: 213 m"
  hiddenByDefault: true;               // opt-in visibility: unlisted fields are NEVER shown
};
```
Opt-in, aliased fields only. A raw `IUCN_CAT`, `desig_eng`, or `waterway=stream` must never reach the screen — this is the single most repeated failure in ArcGIS Online deployments. Ship configs for: OSM hydrology (`name → Nombre`, `kind → Tipo` mapped to *Curso de agua / Cuerpo de agua / Humedal*, derived `distance_m → Distancia al AOI`), WDPA (`name → Nombre`, `desig → Designación`, `iucn_cat → Categoría UICN` expanded to its full label, `status → Estado`, derived `overlap_ha`, `overlap_pct_of_aoi`), and one per MEPyD layer.

### 5.3 Panel anatomy (380px)
```
[✕]                                     32px header row
Río Yaque del Norte                     18px/600 title, wraps to 2 lines
Curso de agua · OSM way/24193           12px muted subtitle
─────────────────────────────────────
Atributos │ Fuente                      tabs, 36px
Nombre              Río Yaque del Norte  ← 2-col rows, 32px, label 12px muted / value 13px
Tipo                Curso de agua
Distancia al AOI    0 m (intersecta)
Longitud dentro AOI 412 m
─────────────────────────────────────
[Zoom a la geometría]    [Descargar]     44px action row, pinned bottom
Capa: Hidrología (OSM) — 47 elementos ›  ← link opens the TABLE view
```
**Table view** (steal Felt): the feature-count link opens a bottom-docked table, h 40% of viewport (drag to 90%), columns = the same aliased fields, with a header stats row per column (min/max/media/nulos/únicos) computed once at layer load. Row click = select + highlight; double-click = zoom. Escape hatch for "the AOI intersects 47 rivers" — nobody should click 47 polygons.

---

## 6. Story-map report spec (`/reporte/$analysisId`)

### 6.1 Shape
A sidecar: **sticky map on one side, scrolling narrative on the other.** Desktop: narrative column 42% (min 420px, max 620px, 32px padding), map panel 58% with `position: sticky; top: 0; height: 100vh`. Toggle button on the narrative's outer edge flips it left↔right. Scroll-triggering via **scrollama** (`offset: 0.55`, `threshold: 4`, IntersectionObserver-based — not a scroll-polling library).

### 6.2 Section order and content
1. **Portada** — AOI name, area in ha, centroid coords, municipality/province (from MEPyD DPA layer), date of analysis, a static AOI map, and a 5-line **Resumen ejecutivo**: one number per theme (rango de elevación, pendiente media %, clase NDVI dominante, cobertura dominante %, distancia al agua más cercana, % de solape con área protegida).
2. **Topografía** — elevation min/max/mean/range, slope mean/max, slope-class bar chart (4 bins).
3. **Vegetación** — NDVI mean/median/p90, 4-class density bars, WorldCover breakdown, `% cobertura arbórea`.
4. **Hidrología** — features found, intersects yes/no, nearest distance, top-N table by distance.
5. **Áreas protegidas** — areas found, overlap ha, overlap % of AOI, nearest distance, per-area table.
6. **Riesgo costero (Aqueduct)** — only if requested; states scenario + return period explicitly in the heading.
7. **Contexto RD (MEPyD)** — only if `is_in_rd()`; grouped findings per MEPyD group.
8. **Fuentes y metodología** — the fixed-shape table (§6.5).

**A section with no usable data is not rendered as an empty section** — it is either omitted (with a line in the Resumen: *"Vegetación: sin datos — no se encontraron escenas Sentinel-2 con <30% de nubes en los últimos 180 días"*) or rendered as an explicit `no-data` block with the reason and a "Reintentar / ampliar ventana a 365 días" button. Never a blank chart.

### 6.3 Map choreography
Each section is a `.step`; `onStepEnter` sets a declarative map state `{ layers: string[], opacity: Record<string,number>, bounds, highlight? }` and diffs against current — no imperative pile-up. Max 4 visible layers per step. `onStepExit` with `direction: 'up'` restores the previous step's state.

Inline **acciones de mapa** inside the prose: text buttons styled as underlined accent links, e.g. *"ver pendientes >30%"*, *"ver solape con Sibarí"*, *"ver el cauce más cercano"*. Click sets a named map state; second click reverts. Each one is a `<button>` with an `aria-label` describing the resulting view.

### 6.4 Card anatomy (used identically for every metric card)
```
┌──────────────────────────────────────────────┐
│ Clases de pendiente          ⓘ  ⤢  ⤓        │  h 40 header; icons 28px: info / ver en mapa / descargar
│ ████████████ Plano (0-5%)            42,1 %  │  horizontal bars, 28px rows, value right-aligned
│ ██████ Suave (5-15%)                 31,4 %  │
│ ███ Moderado (15-30%)                18,0 %  │
│ █ Fuerte (>30%)                       8,5 %  │
│ Pendiente media 9,7 % · máx. 46,2 %          │  12px footnote
└──────────────────────────────────────────────┘
```
- **ⓘ** popover: source, vintage, resolution, and the *calculation sentence* (e.g. *"Pendiente %: gradiente de elevación sobre Copernicus DEM GLO-30 (30 m) reproyectado a UTM, `sqrt(dz/dx² + dz/dy²)·100`, clasificado en 4 clases."*).
- **⤢** "ver en mapa" → sets the sticky map to that card's layer + extent.
- **⤓** downloads exactly that layer's clipped artifact.
- **Every chart ships a text equivalent** in a visually-hidden span AND as the 12px footnote line — required alt-text as a normal authoring field, not an accessibility afterthought. It doubles as the sentence used in the Markdown/PDF export.

### 6.5 Citations
Two layers, both mandatory: (a) the per-card ⓘ popover; (b) a **persistent, always-visible** `Fuentes y metodología` table as the last section — a report used for due diligence cannot have click-to-reveal-only attribution. Fixed columns: `Dataset (link) | Cita | Resolución espacial | Vigencia/versión | Cobertura | Licencia`. One row per dataset **actually used in this run** (skipped services are listed in a separate "No disponibles en esta corrida" note with the failure reason).

### 6.6 Print / PDF
Do **not** print the live page. `/reporte/$id/imprimir` renders the same content with every map replaced by a pre-baked static PNG (server-rendered or `map.getCanvas().toDataURL()` captured at analysis time, one per section, 1600×1000 @2x), plus a `@media print` stylesheet: page-break-inside avoid on cards, `print-color-adjust: exact`, sources table forced onto its own page. Esri's own product still ships blank grey map boxes past 16 live maps per print pass — designing around it is not optional.

---

## 7. Download / export flow

### 7.1 Async by construction
A 6-scene Sentinel-2 10 m composite plus DEM/WorldCover clips is a minutes-long job. `Exportar` creates a job, returns a `jobId`, and the UI moves to a non-blocking state:

- Topbar `Exportar` becomes a progress chip: `Exportando… 3/7` with a caret to a dropdown listing per-artifact status. Clicking opens `/descargas/$jobId`.
- Job survives navigation and reload; on completion a toast + the chip turns into `Descargar (18,4 MB)`.
- Per-artifact rows can fail independently: `NDVI · error (STAC timeout) [Reintentar]` while the rest of the bundle stays downloadable.

### 7.2 The modal (three tabs, ~520px wide)
| Tab | Contents |
|---|---|
| **Rápido** | PNG/JPG snapshot of the current map. Toggles: incluir leyenda, incluir escala, incluir límite del AOI, **recortar al AOI (default ON)**. Live thumbnail preview pinned above the button. |
| **Datos** (the real deliverable) | Checkbox list generated **from what the analysis actually produced** — never a static format list. Rasters (GeoTIFF): DEM, Pendiente, Clases de pendiente, NDVI, Clases NDVI, WorldCover, Aqueduct. Vectores (Shapefile + GeoJSON): hidrología OSM, WDPA, cada capa MEPyD con resultados, AOI. Plus: `resolución` select (nativa / 10 m / 30 m), `CRS` select (EPSG:4326 / UTM local — pre-filled with the AOI's UTM zone), and a `resumen tabular` checkbox (CSV + GPKG). Failed/skipped layers appear greyed with their reason and no checkbox. |
| **Impresión** | The report PDF: page size, orientation, DPI, include/exclude sections. Generated from the `/imprimir` route. |

Below the tabs, always visible: an **atribución/licencias** block listing each selected dataset's license line, and the note *"Se incluye `LEEME.txt` con fuentes, licencias y citas dentro del ZIP."* This is Protected Planet's licensing gate, softened to a disclosure (no radio-button wall) — but the license text ships **inside** the bundle, always.

### 7.3 Bundle contents (fixed shape)
```
territorio-base_<aoi-slug>_<YYYY-MM-DD>.zip
├── LEEME.txt                     fuentes, licencias, citas, versión del motor, parámetros
├── resumen.csv                   una fila por indicador: tema, indicador, valor, unidad, fuente
├── resumen.gpkg                  AOI geometry + todos los indicadores como atributos
├── reporte.pdf / reporte.md
├── raster/  dem.tif, pendiente.tif, pendiente_clases.tif, ndvi.tif, ndvi_clases.tif, worldcover.tif
└── vector/  aoi.*, hidrologia_osm.*, wdpa.*, mepyd_<grupo>_<capa>.*   (shp sidecars + .geojson)
```
Cache the bundle keyed by `aoi_hash + layer_versions + params` — repeat downloads of the same AOI must not recompute.

### 7.4 AOI size guard (before any job starts)
On AOI finalize, compute area in ha and vertex count client-side. Thresholds: **≤500 ha** → proceed silently. **500–2 000 ha** → inline warning in the ANÁLISIS tab: *"AOI grande (1 240 ha). El análisis Sentinel-2 a 10 m puede tardar ~4 min."* with an "Analizar igual" / "Bajar NDVI a 20 m" choice. **>2 000 ha** → block the S2 workload by default, offer 20 m or split-AOI, explain why *before* the click, never as a post-hoc timeout. Upload dropzone states its limits inline (`máx. 10 MB · KML, KMZ, GeoJSON, SHP zipeado · un solo polígono`), not in a help page.

---

## 8. States (every one of these is a designed screen, not a spinner)

| State | Where | Spec |
|---|---|---|
| **No AOI (first run)** | ANÁLISIS tab | Two stacked option cards, 72px tall, icon + one-line label: **"Dibujar en el mapa"** / **"Subir un archivo"**. The second becomes a dashed dropzone on hover/drag with format+size limits printed. No dataset picker, no submit button — analysis fires the moment the polygon closes. |
| **Drawing** | Map | Crosshair cursor, vertices as 8px circles, first vertex pulsing to signal "clic aquí para cerrar", live area readout in ha following the cursor, Esc = cancel, Backspace = undo last vertex. |
| **Analyzing** | ANÁLISIS tab | One skeleton card per expected theme with its label and a determinate step line: `Topografía · buscando DEM… → recortando… → listo ✓`. Overall elapsed timer. Cards resolve independently — a slow S2 never blocks the topography card from rendering. Cancel button. |
| **Partial success** | ANÁLISIS + report | Succeeded cards render normally; failed ones render as a `no-data` card with the failure reason in plain Spanish, the service name, and `[Reintentar]`. The engine already isolates external-service failures — the UI must show that isolation, not a global error. |
| **Empty result** | Any card | `Sin resultados` state with the reason and a widen-the-search action (e.g. hydrology buffer 500 m → 1 000 m; S2 window 180 d → 365 d). |
| **Layer load error** | Layer row | Inline chip in the row itself: `error · reintentar`, plus the layer greyed. No toast-only errors — the error lives where the layer lives. |
| **Offline / service down** | Topbar | A 28px amber strip under the topbar naming the specific service (`Overpass no responde — reintentando (2/5)`), dismissible, auto-clearing on recovery. |

---

## 9. Responsive behavior

| Breakpoint | Layout |
|---|---|
| **≥1440** | Full three-region: left 360 + map + inspector 380, all simultaneous. |
| **1280–1439** | Same, but opening the inspector auto-collapses the left panel to a 48px icon rail (restores on close). |
| **1024–1279** | Left panel becomes an **overlay drawer** (360px, translucent scrim only over the map's left 360px, map stays interactive). Inspector overlays right at 340px. Only one open at a time; opening one closes the other. Map toolbar unchanged. |
| **768–1023 (tablet)** | Topbar theme control collapses to a `Vista: Topografía ▾` dropdown. Left panel = full-height drawer from the left, 85vw max 380px, with scrim. Inspector = same drawer from the right. Report sidecar **stacks**: sticky map on top at 45vh, narrative scrolls beneath it. |
| **<768 (mobile)** | Map is full-screen. Bottom tab bar (h 56px): `Capas · Análisis · Mapa · Reporte`. Panels become **non-modal bottom sheets** — grab handle + an explicit ✕ in the same top row (never swipe-only), default snap 45vh, drag to 92vh, background map stays pannable, **never stacked** (a sheet replaces the current sheet, it does not spawn one). Feature inspector = the same sheet with the short attribute list; the table view opens as a full page, not a nested sheet. Map toolbar collapses to two FABs: `Dibujar AOI` (primary, 56px, bottom-right above the tab bar) and a `⋯` that expands the rest vertically. Report drops the sticky map to a per-section inline static image with a "ver en mapa" button. |

Touch targets ≥44px everywhere below 1024. Opacity sliders get a numeric stepper on touch (drag precision is poor on a 4px track).

---

## 10. Visual system (enough to start)

- **Grid:** 8px base; 4px allowed inside rows. Panel padding 16px; card padding 16px; section gap 24px.
- **Type:** Inter (or system stack). 18/600 section titles · 15/600 card titles · 13/400 body & layer labels · 12/400 muted metadata · 11/500 badges & footnotes. Numbers tabular-lining, Spanish decimal comma and thousands space (`1 240,5 ha`).
- **Color:** neutral panel chrome (the *data* carries the color). `--accent` a single brand hue used for AOI outline, active tab, badges, primary buttons. Per-theme ramps come from the registry, not from the chrome. Slope ramp: `#f7f7f7→#d9a441→#b5502f`. NDVI density: `#bfae96, #fee08b, #66bd63, #1a9850` (already in the engine). WorldCover: the official ESA class colors. Never reuse the accent hue for a data class.
- **Dark mode:** define the full light palette on `:root`, redefine tokens under `@media (prefers-color-scheme: dark)` and `[data-theme="dark"]`. The map basemap style swaps with it.
- **Elevation:** panels flat with 1px borders; only popovers/sheets/modals get shadow. Radius 8px panels/cards, 6px buttons, 4px chips.

---

## 11. Scalability rule (how the 40th layer gets added)

Adding a layer must be exactly this checklist, with **zero component changes**:
1. Add a `LayerDef` entry to the registry (id, label, group, themes, kind, role, legend, source w/ license, exports).
2. Add a `PopupConfig` (aliases) if it is vector — the build fails CI if a vector layer has none.
3. Add a fetch adapter in the engine keyed by the same id.
4. Optionally add `metrics: [...]` to have it produce report cards.

CI checks to enforce it: every `LayerDef` has a `source.license`; every vector layer has a `popup.fields` with ≥1 alias; no layer id appears in more than one theme's `defaultOn` set beyond the 4-layer cap; every `MetricCardId` referenced exists.

---

## 12. Highest-leverage patterns to steal (with source URLs)

1. **Two-tab single left panel — LEGEND / ANALYSIS sharing one slot** → `Capas` / `Análisis`. Keeps the map the largest element at all times, no second sidebar. — https://globalnaturewatch.org/map/ · https://www.globalnaturewatch.org/help/map/guides/analyze-data-map
2. **Count badge on collapsed layer groups** — the only affordable way to make a ~40-layer MEPyD tree navigable. — https://www.globalnaturewatch.org/help/map/guides/adjust-map-data-settings
3. **Fixed per-row control order (handle · swatch · name · ⓘ · opacity · ✕) with inline opacity slider and indented sub-controls** — every layer-specific control lives in exactly one predictable place. — https://www.globalnaturewatch.org/help/map/guides/adjust-map-data-settings
4. **Two-card AOI entry point (draw / upload) that fires the analysis on polygon completion, no submit button** — removes an entire config step. — https://www.globalnaturewatch.org/help/map/guides/analyze-data-map
5. **AOI tool in a persistent top-right map toolbar, independent of the sidebar; AOI persists across layers/views** — the AOI is a first-class object, not a per-layer input. — https://documentation.dataspace.copernicus.eu/Applications/Browser.html · https://www.sentinel-hub.com/explore/eobrowser/user-guide/
6. **Per-layer `map.on('click', layerId, …)` binding instead of a global hit-test** — layer identity is structural, killing a whole class of "which layer was that?" bugs. — https://maplibre.org/maplibre-gl-js/docs/examples/show-polygon-information-on-click/
7. **Docked, persistent detail panel instead of a floating popup; feature-count link opens a full table with per-column stats** — survives pan/zoom, has room for actions, and handles "47 intersecting rivers". — https://help.felt.com/getting-started/tour-the-interface · https://help.felt.com/layers/table-view
8. **Configured field aliases + opt-in field visibility (+ derived/computed fields)** — never show `IUCN_CAT` or `waterway=stream` to a user. — https://doc.arcgis.com/en/arcgis-online/create-maps/configure-pop-ups.htm
9. **Sidecar: sticky map + scrolling narrative, one authored map state per section, plus inline map-action links** — implemented with scrollama + `position: sticky`, no Esri runtime. — https://doc.esri.com/en/arcgis-storymaps/latest/author-and-share/add-sidecars.html · https://github.com/russellsamora/scrollama
10. **Per-card ⓘ (source/method/vintage) + a persistent global sources table** — two citation layers, because click-to-reveal-only attribution fails a report meant to stand alone. — https://www.globalforestwatch.org/help/map/guides/custom-area-forest-statistics-dashboard · https://www.esri.com/arcgis-blog/products/story-maps/sharing-collaboration/citations
11. **Fixed-shape methodology table (dataset · cita · resolución · vigencia · cobertura) + one plain-language calculation sentence per metric.** — https://gfr.wri.org/data-methods
12. **Only render sections/tabs that actually have data** — no empty charts, ever. — https://www.globalforestwatch.org/help/map/guides/custom-area-forest-statistics-dashboard
13. **Download menu generated from what the backend actually produced, not a static format list.** — https://doc.arcgis.com/en/hub/content/data-download-settings.htm
14. **Async job / basket model for heavy retrieval, not a synchronous spinner.** — USGS EarthExplorer Bulk Download Application pattern
15. **Explicit size ceiling with a concrete alternative, checked before the job starts.** — https://www.openstreetmap.org/export
16. **Cached, pre-generated export bundles keyed by AOI+layer version, regenerated on demand.** — https://www.esri.com/arcgis-blog/products/arcgis-hub/data-management/downloads-guide-for-arcgis-hub-and-arcgis-enterprise-sites
17. **Non-modal bottom sheets with a real ✕, never stacked, short content only.** — https://www.nngroup.com/articles/bottom-sheet/
18. **Static pre-baked map images for PDF, never printing the live GL page.** — https://doc.esri.com/en/arcgis-storymaps/latest/share-and-collaborate/print.html

## 13. Explicit antipatterns to avoid (each observed in a shipped product)

- Burying hard limits (file size, AOI size) in help copy instead of the dropzone/UI itself.
- Icon-only primary controls — this audience gets icon + short label for draw, upload, opacity, info, remove.
- Leaving the medición/contexto layer distinction undocumented in-app (GFW's mistake).
- Floating click-anchored popups as the primary inspector.
- A global click handler that infers the source layer after the fact.
- Offering an export format the backend can't produce for that AOI.
- Redistributing WDPA/MEPyD/Copernicus data with no license text in the bundle.
- Kicking off the S2 composite synchronously behind an indeterminate spinner with no size check.
- Swipe-only or stacked mobile sheets.
- Alt-text/chart text-equivalents treated as an optional field.
- More than ~4–5 simultaneously visible data layers on the map or in any report step.