# DECISION MEMO — Geospatial analysis engine for `territorio-base`

**Date:** 2026-08-27 · **Inputs:** five independent capability probes (STAC/mosaicking, raster analysis, vector ops, raster/zip export, engine-level architecture) + direct inspection of the current codebase at `/Users/juanlopez/Code/territorio-base`.

**Recommendation up front: (C) Hybrid — a thin Python FastAPI raster service in the monorepo, with the vector layer, upload parsing, export bundling, and all UI in TypeScript. Confidence: high on "not all-TS" (B is the clearly wrong call), medium-high on the exact seam.**

---

## 0. What we are actually migrating (measured, not assumed)

Before weighing library ecosystems, the size of the thing matters:

| File | Lines | Role |
|---|---|---|
| `/Users/juanlopez/Code/territorio-base/src/territorio_base/sources/stac.py` | 124 | **The entire raster acquisition engine** (DEM, S2 NDVI, WorldCover) |
| `/Users/juanlopez/Code/territorio-base/src/territorio_base/analysis/topography.py` | 54 | slope/aspect via `np.gradient`, slope-class histogram |
| `/Users/juanlopez/Code/territorio-base/src/territorio_base/analysis/vegetation.py` | 64 | NDVI density classes, WorldCover percentages |
| `/Users/juanlopez/Code/territorio-base/src/territorio_base/sources/{osm,mepyd_rd,protected_areas,aqueduct}.py` | 516 | HTTP/JSON fetch + vector math |
| `/Users/juanlopez/Code/territorio-base/src/territorio_base/{aoi,mapview}.py` + `analysis/report.py` | 586 | AOI parsing, Folium map, report |
| `/Users/juanlopez/Code/territorio-base/app.py` | 356 | Streamlit UI + the single GeoTIFF export (`app.py:353`) |

**Two findings that reframe the decision:**

1. **The irreplaceable part is ~250 lines.** The whole reason this is hard is three calls to `odc.stac.load(...)` — six lines each in `stac.py` — plus `.rio.clip()`. Everything else in the Python codebase is either trivially portable (vector math, HTTP) or UI that is being rewritten anyway. Option B does not "port 1,700 lines to TS"; it means **hand-building a warp/mosaic engine to replace 18 lines of `odc.stac.load`**.
2. **Shapefile export does not exist yet.** `grep` for `to_file|pyogrio|ESRI Shapefile` finds no writer — only `raster.rio.to_raster(buf, driver="GTiff")` at `app.py:353`. The zipped-shapefile requirement in the brief is **new feature work in either language**, so it should not be scored as a migration cost against TS. (And on that specific item, TS is verifiably *fine* — see the table.)

One environment fact resolved from the repo: `.devcontainer/devcontainer.json` pins `mcr.microsoft.com/devcontainers/python:1-3.11-bookworm` — **Debian/glibc, not Alpine/musl**. That partially retires the "gdal-async musl prebuilds unverified" blocker flagged in two reports, *if* the deployment container stays in the Debian family. It does not retire it if someone later picks an Alpine base for the Node image. `runtime.txt` (`python-3.11`) shows the app is currently deployed to a Python PaaS — there is today no Node deployment target to protect.

---

## 1. Capability-by-capability

| # | Capability | Python today | Best JS candidate | Verdict |
|---|---|---|---|---|
| 1 | STAC search | `pystac-client` | plain `fetch` POST to `/api/stac/v1/search` | ✅ **Fully replaceable.** Verified live: POST returns a standard FeatureCollection with a `next` link. `pystac-client` is a convenience wrapper over one HTTP call. |
| 2 | PC SAS token signing | `planetary-computer` | `fetch('.../api/sas/v1/sign?href=…')` | ✅ **Fully replaceable.** Verified live 200: `{"msft:expiry":"2026-08-27T20:38:12Z","href":"…&sig=…"}`. ~5 lines. |
| 3 | **Multi-item mosaic → single reprojected/resampled cube** | `odc-stac` (`odc.stac.load`) | **nothing** | ❌ **No equivalent exists.** Must be hand-built on `gdal-async` (~1–2 wk) or from scratch on geotiff.js+geowarp+proj4 (~3–5 wk). *This is the whole decision.* |
| 4 | Remote COG windowed reads | `rasterio` + `/vsicurl/` | `geotiff` (1.07M/wk, v3.0.5, 2026-03-30) | ✅ Strong. HTTP Range reads, WebWorker decode `Pool`. ⚠️ Open issue [#179](https://github.com/geotiffjs/geotiff.js/issues/179): ~1 min for a 64×64 window on a large COG, unresolved, worker pool doesn't help — **never load-tested against actual Planetary Computer COGs by any probe.** |
| 5 | CRS warp / reproject raster grid | `rioxarray` / `rasterio.warp` | `gdal-async` (native GDAL) **or** `geowarp` | ⚠️ **Only via native GDAL.** `geowarp` is 41 stars, last publish 2024-02-25, author's own README calls it "Super Low-Level." No mature pure-JS warp engine exists. |
| 6 | Clip raster to AOI polygon | `.rio.clip()` (one line) | GDAL cutline via `gdal-async`, or hand-rolled point-in-polygon mask | ⚠️ Replaceable with work. No npm equivalent of `rasterio.features.rasterize`. |
| 7 | Temporal median composite across 6 scenes | `xarray` `.median(dim="time", skipna=True)` | **nothing** — hand-written typed-array loop | ⚠️ Trivial to write, easy to get subtly wrong. Note `geoblaze.median` is *zonal*, not temporal — confirmed by reading [its source](https://raw.githubusercontent.com/GeoTIFF/geoblaze/master/src/median/index.js). A team reaching for geoblaze here will ship a wrong number. |
| 8 | Slope/aspect, histograms, percentiles | `numpy` | plain TS loops over `Float32Array` | ✅ Genuinely fine. At 100–500 ha these are 10k–50k px; V8 JITs monomorphic typed-array loops near scalar C. Performance is a non-issue at stated AOI sizes. |
| 9 | UTM zone + point reprojection | `pyproj` | `proj4` (1.34M/wk, 2026-07-27) | ✅ **Fully replaceable, verified by execution.** UTM 1–60 N/S ship built in — no `proj4.defs()` needed; raw WKT `.prj` strings parse directly. |
| 10 | Area / buffer / distance / intersection | `shapely` + `geopandas` | `@turf/turf` 7.4.0 (2026-08-03) | ✅ **Fully replaceable, verified by execution** on a real 469 ha DR AOI: geodesic area within 0.37% of UTM-shoelace; 50 m buffer grew 469→513 ha; intersect returned a correct 117.25 ha overlap. ⚠️ v7 `intersect()` takes a FeatureCollection of 2 — breaking change most tutorials get wrong. |
| 11 | KML / KMZ / GeoJSON upload parsing | `pyogrio` / `geopandas` | `@tmcw/togeojson` + `jszip` + `@xmldom/xmldom` | ✅ **Fully replaceable, verified round-trip** (KMZ built in-memory → unzipped → parsed). |
| 12 | **Shapefile write** (new feature) | `pyogrio` `.to_file()` | `@mapbox/shp-write` 0.4.3 | ✅ **Verified byte-identical round-trip** through the `shapefile` reader: geometry + attributes + valid WGS84 `.prj`; mixed geometries auto-split into separate layers. ⚠️ npm publish is 3 years behind an active GitHub repo (mapbox/shp-write pushed 2026-06-24) — an unreleased 2025-09 **MultiLineString** fix matters because OSM hydrology streams are MultiLineString. Pin to a GitHub commit. |
| 13 | GeoTIFF write | `rioxarray.to_raster` (compressed, GDAL) | `geotiff` `writeArrayBuffer` **or** `gdal-async` | ⚠️ **Pure JS is Beta and uncompressed.** README states it in bold; [issue #472](https://github.com/geotiffjs/geotiff.js/issues/472) (open, no PR as of 2026-03-25) tracks compression; [issue #294](https://github.com/geotiffjs/geotiff.js/issues/294) contains a team abandoning it and shelling out to Python/rasterio (2025-02-21). No COG. |
| 14 | Vector sources (Overpass, WDPA, MEPyD ArcGIS) | `requests` + `geopandas` | `fetch` + `@turf/turf` | ✅ **Fully replaceable.** These are already plain JSON REST calls in `osm.py` / `protected_areas.py` / `mepyd_rd.py`. |
| 15 | ZIP bundling of exports | `zipfile` | `archiver` (40.6M/wk, v8.0.0 2026-05-08) | ✅ Trivially replaceable; streams straight into an SSR response. |

**Score: 8 fully replaceable, 6 replaceable-with-real-work, 1 with no JS equivalent at all — and that one (#3) sits on the critical path of every raster product the app makes.**

---

## 2. The three hardest blockers for the all-JS path

### Blocker 1 — `odc.stac.load` has no JavaScript equivalent, at any maturity level

Three of the five probes searched for this independently and all came back empty. Probe 1's evidence line is blunt: *"WebSearch for 'odc.stac.load equivalent javascript typescript mosaic STAC items' returned no JS/TS library match — only Python alternatives (stackstac) and unrelated tools (titiler)."* Probe 5 lists it as blocker #1; probe 2 reaches the same conclusion from the raster-analysis angle.

What this actually costs: 18 lines of `stac.py` become a hand-written engine that must (a) pick a target grid in the AOI's UTM zone, (b) reproject N source items onto it, (c) resample correctly, (d) propagate nodata, (e) merge across tile boundaries. Item (e) is not hypothetical — Copernicus DEM ships 1°×1° tiles and WorldCover 3°×3° tiles, so any AOI near a tile seam needs real multi-source merge, and **no probe load-tested that case**.

Nobody mainstream does this in JS. Every production server-side raster analysis system the probes found — TiTiler/rio-tiler, Planetary Computer's own API stack, Element84/Development Seed tooling, odc-stac — is Python on GDAL. JS's genuine, well-evidenced lead is *client-side* WebGL rendering of COGs (deck.gl-raster, maplibre-gl-raster), which is a different problem than server-side statistics and export.

### Blocker 2 — Avoiding a native binary is not actually possible, so "all-JS" is a fiction

There is no mature pure-JS warp engine. The honest options are both compromises:

- **`gdal-async`** — a real N-API binding to real GDAL, i.e. the same C++ library rasterio/rioxarray/odc-stac call. Actively maintained ([repo](https://github.com/mmomtchev/node-gdal-async): 160 stars, pushed 2026-08-09, not archived), but small: 14,817 downloads/wk vs geotiff.js's 1,072,420 — **~1.4%** of the traffic, meaning far fewer people have hit and documented the edge cases this project will hit (COG overview selection, nodata through warp, SCL masking semantics). Verified tarball: **47 MB compressed / 215 MB unpacked, 10,155 files.** That rules out edge runtimes and would strain a 250 MB serverless-function limit.
- **`gdal3.js`** — GDAL 3.8.4 as WASM, 42 MB, ~7k downloads/wk, single maintainer, and the maintainer's own 2025-09-09 note says the project is *migrating to a cpp.js architecture*. `/vsicurl/` remote-read support is undocumented and unverified; nobody has benchmarked a 1000×1000 float32 warp.
- **`geowarp`** — the pure-JS fallback: 41 stars, no publish since 2024-02-25, README self-labels "Super Low-Level."

So option B's real shape is: **ship a 215 MB native GDAL addon into Node to avoid shipping Python.** That trade only makes sense if "one language" is worth more than the GDAL ecosystem's maturity — and it swaps a mainstream Python dependency for a niche Node one.

### Blocker 3 — Correctness has no safety net, in a product whose output is a diagnostic

The numbers this app emits (slope-class percentages, NDVI density classes, tree-cover %, distance to protected areas) are the product. Under option B, each of these is recomputed by hand-written code with no library-level ground truth:

- SCL masking, per-scene NDVI, and the per-pixel temporal median must be hand-implemented — flagged as an explicit blocker by probes 1, 2 and 5.
- `geoblaze`/`georaster`, the libraries a developer will find first when searching "raster analysis JavaScript," are **stale (pushed 2024-08-05 and 2023-08-08)** and, worse, do not do the two operations that matter — confirmed by reading geoblaze's [median](https://raw.githubusercontent.com/GeoTIFF/geoblaze/master/src/median/index.js) and [histogram](https://raw.githubusercontent.com/GeoTIFF/geoblaze/master/src/histogram/index.js) source. Reaching for them produces plausible, wrong numbers.
- Validating any of this requires a numeric-parity suite diffing against the current Python pipeline — which means **keeping Python alive through the entire migration anyway**, and then deleting the only reference implementation the project will ever have.

Probe 4 records the endgame others have already reached: a team in [geotiff.js#294](https://github.com/geotiffjs/geotiff.js/issues/294) abandoned JS GeoTIFF writing and shelled out to a Python/rasterio subprocess (2025-02-21).

---

## 3. What a hybrid actually looks like

The seam is not "Python does geo, TS does UI." It is **Python owns the pixel grid; TS owns everything else** — and by the measured line counts, "everything else" is the large majority of the codebase.

**Python service (`apps/geo-api`, FastAPI + uv, ~250–350 lines):**
- STAC search + SAS signing — *keep these in Python even though TS can do them*, because they are 10 lines that are tightly coupled to `odc.stac.load`. Splitting them across a network boundary adds a hop and a serialization format for zero gain.
- `odc.stac.load` mosaic/reproject → UTM grid, `.rio.clip()` to AOI (DEM, S2 B04/B08/SCL, WorldCover, Aqueduct COGs).
- SCL masking, NDVI, temporal median, slope/aspect, class histograms — i.e. today's `stac.py` + `topography.py` + `vegetation.py`, moved essentially verbatim.
- Compressed GeoTIFF write (`.rio.to_raster`), also verbatim.
- **Contract:** `POST /analyze {aoi: GeoJSON}` → `{stats: {...}, rasters: [{name, url|bytes}]}`. Stateless, one endpoint, no ORM, no auth surface beyond an internal token.

**TypeScript (TanStack Start, everything else):**
- All vector sources — Overpass, WDPA, MEPyD ArcGIS, all already plain JSON fetches today.
- All vector math — `@turf/turf` + `proj4`. **This is the probes' one high-confidence, execution-verified result**, and it is where the majority of the current Python line count lives (`osm.py` + `protected_areas.py` + `mepyd_rd.py` = 411 lines).
- AOI upload parsing (KML/KMZ/GeoJSON/SHP) — verified working.
- Shapefile export (`@mapbox/shp-write`, pinned to GitHub) + ZIP bundling (`archiver`) streamed from the SSR route.
- Report rendering, map, entire UI.
- Optionally: read the Python service's GeoTIFFs client-side with `geotiff.js` for map display — that is JS's actual strength.

**Why this seam and not further left:** every capability the probes verified *by running code* (rows 9–12, 14–15) goes to TS; every capability where the verdict rests on "hand-build it" stays in Python. The split follows the evidence, not the language preference.

**Practical note:** two services in one Turborepo is routine — `apps/geo-api` with `uv` + a `turbo` task running `uvicorn`, its own Dockerfile, and the SSR route calling it over HTTP. The devcontainer is already Debian/Python 3.11, so nothing about the current deployment posture has to change on day one.

---

## 4. Recommendation

> **Adopt (C) Hybrid. Confidence: high** that all-TS (B) is the wrong call. **Medium-high** on the precise seam — the seam can move right later (more into Python) at near-zero cost, which is the point of choosing it.

The asymmetry that decides it: moving the vector layer to TS is **verified working today** and buys real ergonomic wins in an SSR app. Moving the raster layer to TS is **unverified, unsupported by any library, and re-derives numbers that are the product.** There is no version of this project where paying 3–5 extra weeks to hand-build a warp engine returns more than `pip install odc-stac`.

C also degrades gracefully: if the TS vector port stalls, you are left with option A (whole engine in a Python service), which still works. B has no such fallback — a wrong temporal median ships silently.

**What would change my mind:**

1. **A hard deployment constraint that forbids Python** (e.g. the only host available is Cloudflare Workers / Vercel Edge). Then note that this *also* kills `gdal-async` (215 MB native addon) — so the answer would not become B, it would become "call an external raster service (TiTiler) or precompute tiles." Confirm the deploy target before anything else.
2. **A `gdal-async` spike that passes numeric parity.** If someone spends one week proving `gdal-async` reproduces today's slope-class %, NDVI density %, and WorldCover % within tolerance *on a real DR AOI spanning a DEM tile seam*, on the actual deploy image — B moves from "don't" to "expensive but defensible." I would still not choose it, but I would stop calling it a blocker.
3. **A maintained JS/WASM `odc-stac` equivalent appearing.** This would collapse blocker 1 entirely. Nothing on the horizon; re-check in 6–12 months.
4. **AOIs growing past ~5,000 ha or concurrency rising.** This *strengthens* C — dask chunking via odc-stac is free in Python and is weeks of streaming design in Node.
5. **A geotiff.js load test showing [#179](https://github.com/geotiffjs/geotiff.js/issues/179)-class slowness against real Planetary Computer COGs.** That would weaken even the client-side-display half of the TS plan and is worth 2 hours to check.

---

## 5. Honest cost and quality delta

Effort figures below are the probes' own estimates, not measured; treat them as **±50%**. They also assume one developer who knows the domain.

| | **(A) Whole engine in a Python FastAPI service** | **(B) All TypeScript/Node** | **(C) Hybrid (recommended)** |
|---|---|---|---|
| **Raster pipeline** | ~0.5 wk (code moves verbatim from `stac.py`/`topography.py`/`vegetation.py`) | **4–8 wk** (1–2 wk on gdal-async *if* it deploys; 3–5 wk pure-JS) | ~0.5 wk (same as A) |
| **Vector layer** | ~0.5 wk (stays in Python) | 1–2 wk (verified primitives) | 1–2 wk |
| **Exports (GeoTIFF + new zipped SHP)** | ~1 wk (rioxarray + pyogrio, both present) | 1–2 wk (shp-write verified; GeoTIFF via gdal-async, or accept uncompressed) | ~1 wk (TIF in Python, SHP+ZIP in TS) |
| **Service plumbing / API contract** | 0.5–1 wk | 0 | 0.5–1 wk |
| **Numeric parity validation** | ~0 (same code, same numbers) | **2–4 wk, ongoing** — no JS ground truth to diff against | ~0.5 wk (raster unchanged; vector spot-checks) |
| **Total** | **2–3 dev-weeks** | **8–16 dev-weeks** | **3.5–5 dev-weeks** |
| **Quality delta vs today** | **Zero regression.** Identical numbers, identical GeoTIFFs. | **Negative and unbounded until proven otherwise.** Every derived statistic is a fresh implementation; uncompressed GeoTIFFs unless you take the 215 MB native dep; no COG. | **Zero regression on raster; small positive on vector** (turf geodesic area is arguably more correct than UTM-projected shoelace — 0.37% delta measured). |
| **Ops cost** | 2 runtimes, 2 images, 1 extra network hop | 1 runtime — but a 215 MB native addon and a niche dependency (1.4% of geotiff.js's traffic) | 2 runtimes, 2 images, 1 extra network hop |
| **Main risk** | Python service becomes a dumping ground and TS never gets the vector work | Silent numeric corruption in a diagnostics product; `geowarp` (2.5 yr stale) or `gdal3.js` (mid-architecture-migration) on the critical path | Seam discipline — resist letting vector logic drift back into Python |

**The uncomfortable number:** option B costs roughly **5–13 extra dev-weeks** to replace **18 lines of `odc.stac.load`**, and the reward is a *worse* dependency posture (niche native GDAL binding instead of mainstream Python GDAL) plus a validation debt that never fully closes.

---

## Caveats on this memo's own evidence

- Raster-side verdicts are **medium confidence** in the source probes. Vector-side verdicts are **high confidence and were verified by running code** against a real DR AOI. Weight them accordingly — that gap is itself the argument for the hybrid seam.
- **Never tested by anyone:** geotiff.js against actual Planetary Computer COGs; gdal-async on this project's real deploy image; multi-tile mosaic merge (DEM tile seams); gdal3.js `/vsicurl/` support; `shpjs` upload ingestion; `@mapbox/shp-write` MultiLineString (relevant — OSM hydrology).
- **Partially resolved here:** the musl/Alpine prebuilt-binary question is moot for the Debian-family container this repo already uses (`.devcontainer/devcontainer.json` → `python:1-3.11-bookworm`), but re-opens if the Node image is Alpine-based.
- Do not build anything on `geoblaze`, `georaster`, `loam`, or `geojson-validation` in any option — all stale to abandoned, and the first two don't do what their names suggest.