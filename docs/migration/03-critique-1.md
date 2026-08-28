I ran the experiments. Here is the adversarial case, with receipts.

---

# (1) STEELMAN FOR ALL-TYPESCRIPT

The memo's decisive framing — *"option B costs 5–13 extra dev-weeks to replace 18 lines of `odc.stac.load`"* — rests on a false dichotomy: **either JS hand-builds a warp engine, or Python does it.** There are two other paths, both of which I executed end-to-end today, and neither is priced anywhere in the memo.

## Path A: The mosaic engine already exists, hosted, first-party, free

The memo's Blocker 1 says `odc.stac.load` has "no JavaScript equivalent, at any maturity level." True and irrelevant — **Microsoft already runs it as an API against the exact data this app uses.**

```
POST /api/data/v1/mosaic/register   {collections, bbox, datetime, cql2 eo:cloud_cover<30}
  -> {"id": "30efd7fea87b7020132feb43dd613a70"}
GET  /api/data/v1/mosaic/tiles/{id}/14/4987/7314.tif
     ?collection=sentinel-2-l2a
     &expression=(B08-B04)/(B08+B04)
     &asset_as_band=true
     &pixel_selection=median
  -> HTTP 200, 1,049,719 bytes, 256x256 float GeoTIFF, 0.7s
```

Decoded with geotiff.js: **NDVI −0.154 … 0.657, mean 0.206, median 0.180.** That is workload #2 — cloud-filtered STAC search, multi-item mosaic, cross-asset band math, and **temporal median across scenes** — as one HTTP GET. `pixel_selection` is an enum: `first, highest, lowest, mean, median, stdev, count`. There is also `algorithm: hillshade|contours|terrainrgb`.

Same story for the rest:

| Workload | Call | Result |
|---|---|---|
| #1 DEM stats + histogram | `POST /cog/statistics` + AOI GeoJSON | min/max/mean/median/std/**percentile_2/98**/valid_percent + 10-bin histogram, **2.4s** |
| #1 DEM GeoTIFF export | `POST /cog/feature.tif?dst_crs=EPSG:32619` | 71×74 float32, clipped **and reprojected to UTM 19N**, 2.5s |
| #3 WorldCover % | `POST /cog/statistics?categorical=true` | Built-up 78.45%, Tree cover 16.25%, Grassland 4.90%… **1.3s** |

The clip-to-polygon, the reprojection, the resampling, the nodata propagation, the tile-seam merge — all of it is the service's problem. **This is zero raster code in any language.**

## Path B: If you want it in-process, gdal-async is not the monster the memo describes

I installed it and ran the complete pipeline:

```
1) /vsicurl open (remote COG, no download)      369ms   3600x3600 EPSG:4326
2) suggestedWarpOutput -> target grid             8ms   3545x3713 @ 30.05m
3) reprojectImage: warp + clip to UTM 19N 30m   558ms   73x73, COMPRESS=DEFLATE TILED=YES
4) elevation 90.9..277.8m mean 162.1 ; slope mean 12.44deg max 33.70deg
5) compressed COG out: 19,830 bytes
TOTAL                                            991ms
```

That is steps (a)–(e) of the memo's "what this actually costs" list — target grid selection, reprojection, resampling, nodata, remote windowed read — **in under a second, in Node, with a compressed COG on the way out.** `suggestedWarpOutput` *is* the "pick a target grid in the AOI's UTM zone" step the memo says must be hand-written.

## The parity oracle the memo says doesn't exist

Blocker 3's core claim is that JS numbers have "no library-level ground truth" and validating them means "keeping Python alive through the entire migration anyway, and then deleting the only reference implementation." I ran gdal-async against titiler (rio-tiler → **rasterio**, the memo's own reference stack) on the identical AOI:

```
                gdal-async (Node)      titiler / rasterio (Python)
 min            167.60214              167.60214233398438      <- identical
 max            195.45195              195.45195007324220      <- identical
 valid_pixels   5329 (73x73)           5329.0                  <- identical
 mean           181.60388              181.61108398437500      <- 0.004%
 median         181.31444              181.32980346679688      <- 0.009%
```

Min and max match to five decimals; the pixel count matches exactly. The mean/median deltas are fully explained by titiler masking to the polygon (`count: 5184`) while my window is the bbox (5329) — not numerical error. The ground truth is a free hosted HTTP endpoint that **outlives your migration and costs nothing to keep**. You do not delete your reference implementation; you never had to host it.

## The vector side is stronger than the memo's own recommendation

The memo routes Shapefile export to `@mapbox/shp-write` (47.9K/wk) with a warning to **pin to a GitHub commit** because npm is 3 years stale and an unreleased MultiLineString fix matters for OSM hydrology. Skip all of that. `@duckdb/node-api` (**1,304,025 downloads/wk**) loads a `spatial` extension that is GDAL + GEOS + PROJ:

```sql
COPY hydro TO '/tmp/shpout' (FORMAT GDAL, DRIVER 'ESRI Shapefile', SRS 'EPSG:4326');
-- writes .shp .shx .dbf .prj ; MULTILINESTRING round-trips through ST_Read intact
-- 34 writable OGR drivers incl. ESRI Shapefile, GPKG, FlatGeobuf, KML, GeoJSON
ST_Transform / ST_Area / ST_Area_Spheroid / ST_Buffer / ST_Intersection / ST_Distance
```

Real GDAL OGR, mainstream package, no GitHub pin, no MultiLineString gamble.

## geotiff.js issue #179 does not reproduce

The memo flags it as an unresolved risk "never load-tested against actual Planetary Computer COGs by any probe," citing ~1 minute for a 64×64 window. I tested it:

```
open + header parse   497ms   3600x3600, 4 overview levels
window  64x64         694ms / 635ms / 480ms
window 1024x1024      435ms          <- larger window, FASTER
AOI-realistic 40x40   500ms   elev 1387.7..2021.3 mean 1638.9
```

Sub-second, and the *larger* read was faster. Whatever #179 describes, it is not what these COGs do.

## Why this is better than the hybrid, not just equal

The memo's option C accepts **two runtimes, two images, one extra network hop** and a standing "seam discipline" risk. Path A has *one* runtime and the *same* network hop — except the service on the other end is operated by Microsoft with an SLA, not by you at 2am. The memo charges option C's network hop as free and option B's as fatal.

---

# (2) MEMO CLAIMS THAT ARE WRONG OR OVERSTATED

**1. "215 MB unpacked" is the wrong number, and the right number is 56 MB.**
Actual install: **268 MB / 10,156 files** — the memo *understated* it. But 218 MB of that is `deps/` (C++ source for fallback-to-build). Pruning to `lib/` + `deps/libgdal/gdal/data` (52 KB) + `deps/libproj/proj/data` (8.9 MB) + `cacert.pem` (184 KB) yields **56 MB, fully functional**: GDAL 3.12.3, 139 drivers, COG + GTiff + ESRI Shapefile all present, and the 991ms pipeline above runs on the pruned tree. The memo's "rules out edge runtimes and would strain a 250 MB serverless-function limit" is wrong by a factor of ~4.5. (A Docker `COPY --from` or `.dockerignore` does this in two lines.)

**2. "Pure JS GeoTIFF write is Beta and uncompressed. No COG." — the premise is that JS has only geotiff.js.**
gdal-async wrote `COMPRESS=DEFLATE TILED=YES` above. gdal3.js reports **128 raster drivers including `COG` and `GTiff`**. The memo's own recommended path is *worse* on this axis than it realizes: titiler's `/cog/feature.tif` returned `compression=none`.

**3. Blocker 3's "no ground truth to diff against" is backwards.** Refuted by the parity table: identical min/max/pixel-count against rasterio, obtained over HTTP for free. The claim that validation forces you to "keep Python alive through the entire migration and then delete the only reference implementation" is the single weakest argument in the memo — the oracle is hosted, permanent, and free.

**4. geotiff.js #179 presented as a live risk.** Not reproducible; 435–694ms.

**5. "Every production server-side raster analysis system is Python on GDAL."** True of the *implementations* and irrelevant to the *interface*. TiTiler and the PC data API are consumed over HTTP by any language. By this reasoning you would rewrite the app in C because Postgres is written in C.

**6. `pixel_selection=median` is never mentioned.** The memo asserts the temporal median is "hand-written typed-array loop… trivial to write, easy to get subtly wrong," and warns a developer reaching for `geoblaze.median` (zonal, not temporal) "will ship a wrong number." That warning is correct and also moot — the correct temporal median is a URL query parameter.

**7. DuckDB-WASM / DuckDB-node spatial appears nowhere in a 15-row capability table**, despite being 1.3M downloads/wk and covering rows 6, 9, 10, 11, 12, 14 with real GDAL/GEOS/PROJ.

**8. Asymmetric risk accounting.** Every JS unknown is priced as a blocker; every Python assumption is priced at zero. "Code moves verbatim" (~0.5 wk) ignores that `odc-stac`, `rioxarray`, `pystac-client` and `planetary-computer` are themselves small-maintainer packages, and that `planetary-computer`'s SAS signing is a hard dependency on the same Microsoft service Path A uses — the memo trusts that service implicitly for auth while refusing to trust it for compute.

---

# (3) WHAT I CONCEDE

**The memo is right about these, and I verified two of them the hard way:**

**1. The axis-order footgun is real, and I walked straight into it.** My first DuckDB run returned **188.02 ha**; `ST_Area_Spheroid` returned **167.06 ha**; the correct answer is **466.27 ha** (hand-check: 468.88). The fix is `always_xy:=true`. Nothing errored. Three plausible, silently wrong numbers in a diagnostics product — exactly Blocker 3's thesis, demonstrated live. (In fairness this footgun is not JS-specific; `pyproj`'s `always_xy` is the same trap.)

**2. gdal3.js is not ready.** It initializes in Node in 209ms and reports 128 raster + 53 vector drivers, but I could not open a single file across four approaches — `File` object (hard process crash), path string, `{name, arrayBuffer}` shim, and WASM MEMFS (`ErrnoError: FS error`). The path option also mis-joins absolute paths. The memo's caution here is vindicated; do not put gdal3.js on the critical path.

**3. `gdal-async` is genuinely niche — the memo's number is exact.** I measured **14,817 downloads/wk**, precisely as stated, versus geotiff.js's 1,072,420. Fewer people have hit the edge cases you will hit.

**4. Prebuilds are narrower than "Debian is fine" implies.** v3.12.3 ships 16 assets: linux-x64 for ABI 115/127/137/141, darwin x64/arm64, win32-x64. There is **no linux-arm64 and no musl build**. Graviton or Alpine means compiling GDAL from source — which is exactly what that 218 MB `deps/` tree is for, so my pruning trick and the ARM deploy story are mutually exclusive. The memo's Alpine caveat stands, and I would add ARM64 to it.

**5. Path A's median is not your current median.** `pixel_selection=median` composites across *items*; today's `vegetation.py` masks by SCL class *then* takes the median. Different estimator, different number. Migrating to Path A is a deliberate numeric change requiring re-validation — not a free port. Adjacent: I did not test AOIs spanning DEM/WorldCover tile seams, which remains untested by anyone including me.

**6. Turf/proj4 are fine, and the memo already said so.** No dispute on rows 9–11, 14–15.

**7. Honest framing:** Path A is arguably "someone else's Python service" rather than a Python-free architecture. The distinction that matters is operational, not ideological — **you write, deploy, version, and page for zero Python**, and there is no second image or second runtime in your repo. If that distinction doesn't matter to the team, the memo's option C is a reasonable choice and I would not fight it.

---

**Bottom line:** the memo's recommendation is defensible, but its confidence is not. "High confidence that all-TS is the wrong call" is not supported by evidence that the hardest blocker dissolves into a query parameter, that the native option ships in 56 MB and matches rasterio to five decimals, and that the parity oracle it says doesn't exist answered in 2.4 seconds. Before committing to a second runtime, the two-hour version of this is worth running: **`/mosaic/register` + `pixel_selection=median` against a real DR AOI, diffed against the current `vegetation.py` output.**

Test scripts (all runnable):
- `/private/tmp/claude-501/-Users-juanlopez-Code-territorio-base/be00b26b-d3f8-4b47-9c6d-4efdc4168d24/scratchpad/gtest/pipe.cjs` — full remote warp/clip/COG/slope pipeline
- `/private/tmp/claude-501/-Users-juanlopez-Code-territorio-base/be00b26b-d3f8-4b47-9c6d-4efdc4168d24/scratchpad/gtest/parity.cjs` — gdal-async vs rasterio parity
- `/private/tmp/claude-501/-Users-juanlopez-Code-territorio-base/be00b26b-d3f8-4b47-9c6d-4efdc4168d24/scratchpad/jstest/t2.mjs` — geotiff.js COG benchmark
- `/private/tmp/claude-501/-Users-juanlopez-Code-territorio-base/be00b26b-d3f8-4b47-9c6d-4efdc4168d24/scratchpad/jstest/duck2.mjs` — DuckDB axis-order footgun
- `/private/tmp/claude-501/-Users-juanlopez-Code-territorio-base/be00b26b-d3f8-4b47-9c6d-4efdc4168d24/scratchpad/jstest/shp.mjs` — Shapefile write round-trip