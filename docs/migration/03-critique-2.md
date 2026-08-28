## VERIFICATION ENVIRONMENT

All numbers below were produced by running code, not by reading docs. Repo venv (`/Users/juanlopez/Code/territorio-base/.venv`: numpy 2.4.6, pyproj 3.7.2, shapely 2.1.2, rasterio 1.4.4, odc-stac 0.5.3) and Node 24.19 with `@turf/turf@7.4.0`, `proj4@2.21.0`, `@mapbox/shp-write@0.4.3`, `geotiff`, `shapefile`. Live calls to Planetary Computer succeeded, so the STAC-side findings are against real data, not synthetic.

---

# 1. CORRECTNESS HAZARDS

## 1A. The memo's premise is broken: the Python reference implementation is already wrong

The memo's load-bearing claim is *"(A)/(C) = Zero regression. Identical numbers"* and *"deleting the only reference implementation the project will ever have."* I tested the reference implementation. It produces materially wrong numbers today.

### H1 — Sentinel-2 BOA_ADD_OFFSET is not applied → NDVI density classes are wrong by up to 59 percentage points. **SEVERITY: CRITICAL. VERIFIED LIVE.**

`stac.py:96` computes `ndvi = (nir - red) / (nir + red)` on **raw DN**. Sentinel-2 processing baseline ≥ 04.00 carries `BOA_ADD_OFFSET = -1000`; true reflectance is `(DN - 1000)/10000`. A pure scale factor cancels in a normalized ratio — **an additive offset does not.**

I pulled 3 real scenes over an inland DR AOI (all baseline `05.12`, confirmed from `s2:processing_baseline`) and ran the repo's exact masking + median code both ways:

```
raw DN  red median 1434  nir median 4955
NDVI as computed TODAY (no BOA offset): mean 0.516  density classes [1.5, 13.5, 59.6, 25.4]
NDVI with BOA_ADD_OFFSET applied      : mean 0.748  density classes [0.6,  2.2, 12.4, 84.7]
delta per class (pp):                                              [+0.8, +11.2, +47.2, -59.3]
```

The app's flagship vegetation statistic — *"Vegetación muy densa / dosel maduro"* — reports **25.4%** where the correct answer is **84.7%**. Every AOI the app has ever analysed is affected.

This is not fixable by library choice: I checked `items[0].assets["B04"].extra_fields` and Planetary Computer returns **`raster:bands: null`** with no scale/offset in `properties`. odc-stac has nothing to apply, so `pip install odc-stac` does not save you. The fix is one hardcoded subtraction — in either language.

**Consequence for the decision:** "numeric parity against today's Python" is not a safety net, it is a mechanism for laundering a 59 pp error into the rewrite. The memo budgets 2–4 dev-weeks (option B) for parity validation against an oracle that is broken.

### H2 — WorldCover `.max(dim="time")` over categorical class codes mixes 2020 and 2021 epochs. **SEVERITY: HIGH. VERIFIED LIVE.**

`stac.py:118` does `worldcover.max(dim="time")`. I confirmed PC returns **two** items for a DR bbox:

```
ESA_WorldCover_10m_2021_v200_N18W072   2021-01-01
ESA_WorldCover_10m_2020_v100_N18W072   2020-01-01
```

`max` over *class codes* is arithmetically meaningless: Tree cover = 10 is the **lowest** code, so it loses every 2020/2021 disagreement. Measured on a real Santo Domingo AOI:

```
tree cover % via max(dim=time)  [current code]: 6.81
tree cover % via 2021 v200 only [correct]     : 7.33
pixels changed by the max():    0.80%
```

A 7% relative under-report of tree cover here; larger on forested AOIs, where more pixels disagree between epochs. The app also silently reports a **blend of two different years** as one land-cover figure.

### H3 — Slope statistics are computed over an eroded AOI; elevation statistics are not. **SEVERITY: MEDIUM. VERIFIED.**

`.rio.clip()` fills outside-AOI with NaN, then `np.gradient` propagates NaN one pixel inward *and* uses one-sided differences at the array edge. Measured on a 32 ha AOI:

```
valid DEM px 354 | valid SLOPE px 293 -> slope stats use 17.2% fewer pixels
```

So `slope_class_pct` and `elevation_*` in `summarize_topography` have **different denominators over different footprints**, and the mismatch scales with perimeter/area (worst on small or elongated AOIs). Not catastrophic, but it means the two blocks of the report describe different areas.

**Latent variant, severity CRITICAL if it ever triggers:** I verified `cop-dem-glo-30` currently arrives with `nodata: None`, so the fill is NaN and `~np.isnan()` catches it. If odc ever assigns nodata **0** (as many DEM products declare), `.rio.clip` fills with 0, `~np.isnan()` filters nothing, and the AOI boundary becomes a cliff to sea level:

```
with nodata=0: max slope 683%  (mean 124.7%) -- not filtered by ~isnan
```

versus ~4% for the same terrain. There is no assertion in the codebase guarding this.

### H4 — SCL class 7 is "unclassified", not "low-probability cloud". **SEVERITY: LOW–MEDIUM.**

`stac.py:92` comments class 7 as *"nubes baja prob."* and includes it as valid. In current Sen2Cor semantics 7 is **UNCLASSIFIED**; the old "cloud low probability" label is legacy. Including it admits genuinely unclassified pixels — including some cloud — into the NDVI composite. Defensible either way, but the comment documents an intent the code does not implement.

### H5 — NDVI density percentages do not necessarily sum to 100. **SEVERITY: LOW.**

`NDVI_DENSITY_CLASSES` spans `[-1.0, 1.0)` with `>= lo & < hi`. Any pixel with NDVI exactly 1.0, or outside [-1,1] (possible with negative surface reflectance after offset correction, or division near zero), is silently dropped from the histogram while remaining in `total_ndvi`. The report shows four percentages that quietly don't add up.

---

## 1B. Hazards specific to an all-JS engine

### H6 — `@mapbox/shp-write` truncates DBF field names to 10 chars with **no collision handling**, and readers silently drop the shadowed column. **SEVERITY: CRITICAL. VERIFIED.**

This is the single worst finding for the TS export path, and it fires on this project's actual naming style (long Spanish field names). Wrote a FeatureCollection with `distancia_al_area_protegida_m = 137.42` and `distancia_al_cuerpo_de_agua_m = 55.1`:

```
DBF field descriptors emitted by shp-write:
  field 'distancia_' type N len 18 dec 3
  field 'distancia_' type N len 18 dec 3     <-- duplicate name
  field 'nombre_del' type C len 254
  ...
Read back with npm `shapefile`:
  {"distancia_":55.1, "nombre_del":"Parque Nacional...", ...}
```

**The 137.42 value is gone.** Eight properties written, seven read back. The surviving `distancia_` column holds the *water* distance under a name that reads as the *protected-area* distance. Silent, plausible-looking, wrong.

GDAL/pyogrio on the identical input:

```
RuntimeWarning: Normalized/laundered field name: 'distancia_al_area_protegida_m' to 'distancia_'
RuntimeWarning: Normalized/laundered field name: 'distancia_al_cuerpo_de_agua_m' to 'distanci_1'
field names: ['distancia_', 'distanci_1', 'nombre_del', 'osm_id', 'geometry']
```

Laundered with collision suffixes **and a loud warning per field**. This directly falsifies the memo's row 12: *"✅ Verified byte-identical round-trip … geometry + attributes."* That round-trip only holds for short ASCII field names. Mitigation is a mandatory explicit field-name map + a duplicate-name assertion before `zip()` — cheap, but nobody writes it unless they know.

### H7 — `@mapbox/shp-write` hardcodes the `.prj` regardless of the geometry's actual CRS. **SEVERITY: HIGH.**

`node_modules/@mapbox/shp-write/src/prj.js` is a single literal string (WGS84 GEOGCS). `zip.js:18` honours `options.prj`, but `write.js:48` uses the module constant unconditionally. Since this pipeline does all its distance/buffer/intersection math **in UTM**, the natural bug is exporting UTM coordinates stamped with a WGS84 `.prj` — a shapefile that opens in QGIS at latitude 2,043,328°. Nothing warns. GDAL derives the `.prj` from the GeoDataFrame's actual CRS and cannot make this mistake.

Secondary: shp-write's `.prj` carries no `AUTHORITY["EPSG","4326"]` node. GDAL matches it fine; some web viewers won't.

### H8 — turf has no polygon-to-polygon / polygon-to-line distance. The obvious port of `nearest_distance_m` over-reports by orders of magnitude. **SEVERITY: HIGH.**

`osm.py:120` and `protected_areas.py:62` use `gs.distance(aoi_utm)` — shapely's exact **point-to-segment** distance, one method call. turf's inventory (verified): `distance, distanceWeight, pointToLineDistance, pointToPolygonDistance, rhumbDistance` — all point-anchored. There is no `distance(geomA, geomB)`.

A developer porting this reaches for vertex-to-vertex. OSM waterways are frequently digitised with vertices kilometres apart. Measured, with a 2-vertex river passing 50 m from the AOI:

```
naive vertex-to-vertex nearest (m): 3947.7
turf.pointToLineDistance nearest (m): 49.9
ratio: 79.0x over-reported
```

The report would state *"cuerpo de agua más cercano: 3.9 km"* for a river 50 m away. Correct implementation requires decomposing both geometries to segments and doing segment-to-segment distance by hand.

### H9 — `distances == 0` as the intersection test does not survive the port. **SEVERITY: HIGH.**

`osm.py:124`: `intersects = bool((distances == 0).any())`. In shapely, intersecting geometries return **exactly** `0.0`, so this works. Any JS reimplementation computing distance from floating-point segment math returns `1e-13`, never `0`. Verified: for a river that genuinely crosses the AOI, a point-based distance approach returned `559.0 m` and `d === 0` was `false`, while `turf.booleanIntersects` correctly said `true`. `intersects_aoi` silently becomes permanently `false` — and "does a watercourse cross this parcel" is a headline diagnostic.

### H10 — `turf.buffer` is spherical azimuthal-equidistant, not ellipsoidal; buffer radius is non-uniform. **SEVERITY: MEDIUM (numeric), HIGH (semantic).**

Read the source: `defineProjection()` returns `d3.geoAzimuthalEquidistant().rotate([-cx,-cy]).scale(earthRadius)` — a sphere. Measured the true geodesic radius of a nominal 500 m turf buffer with `pyproj.Geod(WGS84)`:

```
turf 500m buffer    -> geodesic radius min 497.710  max 500.728  mean 499.226  (-0.77 m, -0.155%)
shapely UTM 500m    -> geodesic radius min 500.139  max 500.139  mean 500.139  (+0.14 m, uniform)
```

The magnitude is small (sub-metre), but note turf's radius is **not constant** — it varies 3 m by azimuth. Features sitting within ~3 m of a 500 m hydrology setback can flip in or out between implementations, unreproducibly.

The semantic hazards are worse than the numeric one:
- **`turf.buffer` returns `undefined` with no throw** on degenerate input. Verified: negative-radius buffer of a small polygon → `undefined` (source line 66: `if (coordsIsNaN(...)) return void 0;`). A downstream `turf.area(undefined)` crashes or, worse, a guarded path silently yields 0.
- **`turf.buffer` on a FeatureCollection returns a FeatureCollection, not a dissolved union.** Summing `turf.area` over buffered river segments **double-counts overlaps**. `union_all()` in shapely is the missing step and its absence is invisible.

### H11 — Rasterization semantics: pixel-center vs all-touched changes reported area by ~11%. **SEVERITY: HIGH.**

`.rio.clip()` defaults to GDAL's **pixel-center-in-polygon** rule. A hand-rolled JS mask (bounding box, or corner-based point-in-polygon) drifts to all-touched. Measured on a 32 ha AOI over a synthetic 2-class raster:

```
pixel-center (GDAL default): 354 px, class1 51.13%
all_touched=True           : 394 px, class1 50.25%
pixel-count delta: +11.3%  |  class% delta: -0.88 pp
polygon area 31.75 ha vs 31.86 ha (center) / 35.46 ha (all_touched)
```

There is no npm equivalent of `rasterio.features.rasterize`, so this is hand-written in option B. Beyond the rule itself, GDAL has specific scanline tie-breaking on exact boundaries, and interior-ring (hole) handling via even-odd crossing counts. A naive ray-cast that doesn't handle holes turns a doughnut AOI into a disc.

### H12 — GeoTIFF export: the failure mode is silence, not an error. **SEVERITY: MEDIUM. Memo is partly wrong here (see §3).**

`geotiff.js` `writeArrayBuffer` **does** produce correct georeferencing when you hand it the right keys. Verified round-trip through rasterio:

```
geotiff.js output -> crs: EPSG:32619 | nodata: nan | dtype: float32 | transform: |30,0,400000 | 0,-30,2043000|
nan count: 439 of 3072   (preserved)
```

But omitting the metadata succeeds equally quietly:

```
writeArrayBuffer(a, {height:48, width:64})  ->  wrote nogeo.tif with NO error
rasterio: crs: None, transform: |1,0,0 | 0,1,0|
```

No exception, no warning — an unreferenced TIFF that looks fine until someone drags it into QGIS. Real remaining gaps are **compression and tiling** (`compress: None, tiled: False`), not CRS. And a wrong `ProjectedCSTypeGeoKey` (e.g. UTM 19N vs 20N — DR straddles the 72°W boundary) fails silently too.

### H13 — Temporal median semantics. **SEVERITY: MEDIUM.**

`ndvi.median(dim="time", skipna=True)` over 6 scenes. Three traps for a hand-written loop:
- **Even counts average the two middle values.** After SCL masking, per-pixel valid counts vary from 0 to 6 across the AOI. Any pixel with an even count gets a value that exists on **no single date**. A "sort and take `arr[n>>1]`" port produces a different raster.
- **Pixels with 1 valid observation get "median" = that observation**, with zero outlier rejection. Neither implementation is wrong, but a port must replicate it or the composite differs.
- **All-NaN pixels.** numpy `nanmedian`-style behaviour returns NaN; a JS reducer over an empty array returns `NaN`, `0`, or `-Infinity` depending on how it's written. `0` silently lands in the "sin vegetación" bin.

The memo's note that `geoblaze.median` is zonal, not temporal, is correct and I'd rank it as the most likely single mistake a developer makes on this path.

### H14 — Float precision. **SEVERITY: LOW.**

`topography.py:19` casts to `float64` before `np.gradient`. JS `Float32Array` arithmetic promotes to double automatically, so slope math is fine. The real precision hazard is **accumulator drift in histogram/percentile loops over 10⁴–10⁵ elements**, which is negligible at these sizes, and **`osm_id` written as DBF `N(18,3)`** by shp-write and read back as a JS double — fine for way IDs (~10¹⁰) but OSM node IDs are approaching 2⁵³ and DBF numeric round-trips through text.

### H15 — proj4js vs PROJ: **no hazard found. VERIFIED CLEAN.**

I want to be explicit that this one is fine, because it's where people expect trouble:

```
WGS84 -> EPSG:32619, four DR points:
  pyproj 400757.1099 2043328.9544 | proj4js 400757.1099 2043328.9544 | delta 0.00e+00 m
  pyproj 238257.9385 2202359.9131 | proj4js 238257.9385 2202359.9131 | delta 5.82e-11 m
  pyproj 574021.3392 2012454.2279 | proj4js 574021.3392 2012454.2279 | delta 4.66e-10 m
```

Sub-nanometre. Raw ESRI WKT `.prj` strings parse directly (`PROJCS["WGS_1984_UTM_Zone_19N",...,DATUM["D_WGS_1984",...]]` round-tripped to 6 decimal places). NAD27 UTM 19N → WGS84 also matched pyproj to 0.0 m.

**The caveat the memo doesn't state:** proj4js has no grid-shift file support. WGS84↔UTM is a pure map projection with no datum change, which is why it's exact. The moment a user uploads a shapefile in a datum needing a NTv2/NADCON grid — or MEPyD publishes in a local DR datum — proj4js will silently fall back to a 3-parameter or null transform and be metres off with no error. Today all sources are EPSG:4326 (`f=geojson`, `outSR=4326` in both `protected_areas.py:34` and `mepyd_rd.py:113`), so this is a *future* hazard on the upload path only.

### H16 — MultiPolygon / holes: better than expected. **VERIFIED.**

shp-write handled a polygon with an interior ring correctly (`rings: 2` on read-back) and auto-split mixed geometries into `POLYGON.shp` / `POLYLINE.shp`. GDAL preserved the hole too. No finding — but note shapefile has **no MultiPolygon/Polygon distinction**, so a MultiPolygon AOI and a Polygon-with-holes AOI are indistinguishable on re-import in either language. `aoi.py:48` does `union_all()` on multi-feature uploads, which can legitimately produce a MultiPolygon; `aoi.py:53` then takes `geometry.centroid` to pick the UTM zone, and a MultiPolygon centroid can fall **outside all parts** — and for a DR AOI near 72°W, that picks the wrong UTM zone. Latent in Python today, and identical in TS.

---

# 2. OPERATIONAL REALITIES

## Measured, not estimated

```
Python import of the full odc.stac stack:  1.54 s wall  (rasterio+rioxarray+numpy alone: 0.83 s)
Node baseline process start:               0.04 s
STAC search (live):                        0.41 s
odc.stac.load 6 scenes x 3 bands + SCL mask + NDVI + temporal median,
  ~742 ha AOI (279 x 266 px @ 10 m), including all COG range reads:  2.27 s
```

**The brief's pixel-count premise is wrong by 100x.** It states *"at 10m over ~100 ha this is roughly 1000x1000 px per band per scene."* 100 ha = 1 km² = **100×100 px** at 10 m. 1000×1000 px at 10 m is 10,000 ha. My live 742 ha load returned 279×266. Even 5,000 ha is ~707×707 px ≈ 2 MB of float32. This matters in three places:
- It strengthens the memo's row 8 (JS typed-array loops are fine) far beyond what the memo claims.
- It **kills the memo's "what would change my mind" item 4** — dask chunking is irrelevant at 2 MB arrays. That item argues *for* C on a false premise.
- It makes the whole performance axis a non-issue in both languages. This is a correctness decision, not a performance one.

## Where the memo is too pessimistic about Python ops

**Image size — the memo's own recommendation costs what it criticises.** Measured `du` of the repo's site-packages: `rasterio 62 MB, pyproj 18, numpy 26, xarray 12, dask 9, rioxarray 1, odc 2` ≈ **130 MB** for a raster-only service (the hybrid explicitly moves `pyogrio 75 MB`, `pandas 49 MB`, `geopandas 3 MB` to TS). On `python:3.11-slim` (~45 MB) that's a **~180–220 MB image**. The memo spends a full paragraph condemning `gdal-async` at "**215 MB unpacked**." Those are the same number. The real argument against gdal-async is 1.4% ecosystem share and thin edge-case coverage — which the memo also makes, correctly. It should drop the size argument; it boomerangs.

**Cold start.** 1.54 s of imports. On a long-lived container this is startup-only and invisible. It only matters on scale-to-zero (Cloud Run `min-instances=0`, Render free tier), where it adds ~2 s to the first request — against a raster pipeline that already takes 2.3 s of network-bound COG reads.

**The "1 extra network hop" the memo lists as a standing cost of A and C is noise.** A loopback JSON POST is sub-millisecond against a 2.3 s workload — under 0.05%. Listing it in the ops row alongside real costs overweights it.

**uv + turbo + Compose DX is genuinely unremarkable.** `uv sync` on this lockfile is wheels-only (no compilation) — seconds warm, ~10–20 s cold. `apps/geo-api/package.json` with `{"scripts":{"dev":"uv run uvicorn app:api --reload --port 8787"}}` makes it a first-class `turbo run dev` target with cache keys on `uv.lock`. Compose `develop.watch` handles hot reload. The devcontainer is already `python:1-3.11-bookworm`, so glibc prebuilds are available for everything. The memo is right that this is routine; it just doesn't say so with enough confidence to offset the "2 runtimes" framing.

## Where the memo is too optimistic about ops

**"There is today no Node deployment target to protect" cuts the other way too.** `runtime.txt` = `python-3.11` and the devcontainer auto-runs `streamlit run app.py`. There is today no *Node* target **and** the current Python target is a Streamlit PaaS, not a FastAPI service. Option A/C's "Python service plumbing" is not 0.5–1 wk of moving code — it's a new Dockerfile, a new deploy target, a new health check, an internal auth token, timeout/retry semantics for a 2–60 s synchronous endpoint, and a decision about how multi-MB GeoTIFFs cross the boundary. The `{name, url|bytes}` in the memo's contract is hand-waving over the one real design question: base64 in JSON triples the payload; a URL requires object storage that doesn't exist yet.

**Two runtimes means two dependency-update treadmills, two CVE surfaces, and two sets of CI images** — and this repo has no tests at all, so there's nothing to catch a drift across the seam.

---

# 3. WHERE THE MEMO IS WRONG — IN BOTH DIRECTIONS

## Wrong against TypeScript (memo too harsh)

1. **Row 13, GeoTIFF write.** *"Pure JS is Beta and uncompressed … No COG."* Half right. I verified geotiff.js writes **correct CRS, correct affine transform, and a correct nodata tag**, read back cleanly by rasterio. And critically — the current Python export at `app.py:353` is `raster.rio.to_raster(buf, driver="GTiff")` with no `compress=`. I ran it: `crs EPSG:32619, nodata None, compress None, tiled False`. **The Python export today is uncompressed AND has no nodata tag**, so the clipped GeoTIFFs open in QGIS with the outside-AOI NaN region rendered as data. geotiff.js's output was *better* than the incumbent. The memo's phrase *"Compressed GeoTIFF write (`.rio.to_raster`), also verbatim"* in §3 is factually false about this codebase, and the §5 quality row *"uncompressed GeoTIFFs unless you take the 215 MB native dep"* is a penalty applied to B for a defect A and C share.

2. **The 215 MB gdal-async argument.** As above — the recommended Python raster service is ~180–220 MB. The size complaint is not a differentiator.

3. **"What would change my mind" item 4 (AOIs > 5,000 ha → dask)** rests on the 100x pixel-count error. At 5,000 ha the arrays are ~2 MB. This item should be struck.

4. **The 0.37% turf-vs-UTM area delta is reported as "small positive."** I reproduced it exactly (422.19 ha geodesic vs 420.63 ha UTM shoelace on a DR polygon). But framing it as a quality *improvement* misses that it is a **user-visible change to the single headline number** — the same parcel silently gains 1.7 ha across the migration, with no migration note, in a document a client may already hold. That's a credibility event regardless of which figure is more defensible.

## Wrong in favour of the recommendation (memo too soft)

5. **The central claim — "zero regression, identical numbers" — is the memo's biggest error.** It treats bit-parity with Python as equivalent to correctness. H1 (59 pp NDVI error), H2 (WorldCover epoch mixing), H3 (slope/elevation denominator mismatch) are all present in the code the memo proposes to move *verbatim*. Option C as written **carries all three forward unexamined and unfixed**, and its 0.5-week raster estimate assumes nobody looks.

6. **Row 12 — "✅ Verified byte-identical round-trip" for shp-write — is falsified** by this project's own Spanish field names (H6). The probe that verified it evidently used short ASCII names. The memo's only caveat is the MultiLineString publish lag; the actual blocker is silent column loss on truncation collision.

7. **Blocker 1 is overstated in scope.** For 100–500 ha AOIs, "multi-item mosaic across tile seams" mostly doesn't happen. Copernicus DEM ships 1°×1° tiles: a 2 km AOI crosses a seam ~1.8% of the time per axis. My live DEM query returned **1 item**. WorldCover ships 3° tiles — rarer still. The genuinely multi-item case is Sentinel-2, where the 6 items stack along **time**, not space, and for a small AOI are usually the same MGRS tile — i.e. the hard part odc does here is grid alignment and time stacking, not spatial merge. The one real spatial case is an AOI straddling 72°W where S2 items arrive in two different UTM zones and genuinely need warping. That's a narrower blocker than the memo's framing implies, and it's the one worth naming precisely.

8. **The memo never touches `.rio.clip` rasterization semantics** — the single highest-frequency silent divergence on the vector→raster seam (H11, ~11% area drift). It also never touches DBF field-name laundering, the hardcoded `.prj`, or turf's missing geometry-to-geometry distance. These are the three highest-severity TS hazards and none appear.

9. **The memo's own seam contradicts its evidence.** It says *"every capability the probes verified by running code goes to TS."* Row 12 (shapefile write) was "verified by running code" and I've now shown that verification was incomplete in a way that silently corrupts exported attributes (H6). The seam should not be drawn from probe verification status; it should be drawn from **where a wrong answer is detectable**. Raster statistics are undetectably wrong (H1 sat in production unnoticed). Shapefile columns are detectably wrong (someone opens the file). That's a better rule and it happens to land in roughly the same place.

## The recommendation I'd actually make

The hybrid seam is right, for a reason the memo doesn't give: **not because Python is the correct reference, but because the raster path is where errors are undetectable, so it should sit where the ecosystem has the most eyes.** Adopt C, but rewrite the plan:

- **Fix H1 and H2 before writing a single line of the port.** They are ~5 lines each. Doing this after the migration makes it impossible to tell a port bug from a legacy bug — the debuggability question the user asked, answered concretely.
- **Replace "numeric parity with today's Python" with a real acceptance suite**: 3–5 fixed DR AOIs (one flat/urban, one Cordillera Central, one crossing 72°W, one on a DEM tile seam, one MultiPolygon with a hole) checked into the repo with expected outputs and *documented tolerances*. This is the only thing that gives the numbers scientific credibility, and it is worth building whichever option wins — right now there are **zero tests in this repo**, so today's pipeline has no credibility to lose.
- **On the TS side, three mandatory guards**: an explicit `{longName -> dbfName}` map with a duplicate-name assertion before `shpwrite.zip`; a `.prj` written from the actual CRS (or an assertion that coordinates are in degrees); and segment-to-segment distance with `booleanIntersects` for the intersects flag, never `=== 0`.
- **Drop the image-size argument from the memo entirely** — it applies equally to the recommendation.