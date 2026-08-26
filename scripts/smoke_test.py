"""Prueba manual end-to-end del pipeline contra un polígono real. No forma parte de la app."""

import sys
import time

from territorio_base.aoi import load_aoi_from_file
from territorio_base.analysis.report import run_analysis, to_markdown


def main() -> None:
    path = sys.argv[1] if len(sys.argv) > 1 else "/Users/juanlopez/Documents/PK/Untitled.geojsonl"
    aoi = load_aoi_from_file(path)
    print(f"AOI cargada: {aoi.area_ha:.1f} ha, EPSG:{aoi.utm_epsg}, bbox={aoi.bbox}")

    def progress(msg: str) -> None:
        print(f"[{time.strftime('%H:%M:%S')}] {msg}")

    results = run_analysis(aoi, progress=progress)
    print("\n" + to_markdown(results))


if __name__ == "__main__":
    main()
