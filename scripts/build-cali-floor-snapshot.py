#!/usr/bin/env python3
"""Build the compact Cali floor lookup from the official January 2024 FileGDB.

Requires pyogrio, numpy and pyproj. The source archive is published at:
https://www.cali.gov.co/hacienda/publicaciones/147969/geoportal-catastral/
"""

from __future__ import annotations

import argparse
import struct
from pathlib import Path

import numpy as np
import pyogrio

HEADER = struct.Struct(">8sHI")
RECORD = struct.Struct(">QfB")
FIELDS = ["SECTOR", "COMUNA", "BARRIO", "MANZANA", "TERRENO", "NPISOS", "SHAPE_Area"]
LAYER = "CONSTRUCCION_U_2024"


def terrain_key(parts: tuple[object, ...]) -> int | None:
    if any(part is None or str(part).strip() == "" for part in parts):
        return None
    value = "".join(str(part).strip() for part in parts)
    return int(value) if value.isdigit() else None


def build(source: Path, target: Path) -> int:
    feature_count = pyogrio.read_info(source, layer=LAYER)["features"]
    records: list[tuple[int, float, int]] = []
    for start in range(0, feature_count, 50_000):
        frame = pyogrio.read_dataframe(
            source,
            layer=LAYER,
            columns=FIELDS,
            skip_features=start,
            max_features=min(50_000, feature_count - start),
            read_geometry=False,
        )
        for row in frame.itertuples(index=False):
            floors = row.NPISOS
            area = row.SHAPE_Area
            key = terrain_key((row.SECTOR, row.COMUNA, row.BARRIO, row.MANZANA, row.TERRENO))
            if (
                key is None
                or floors is None
                or area is None
                or not np.isfinite(floors)
                or not np.isfinite(area)
                or floors <= 0
                or floors > 255
                or area <= 0
            ):
                continue
            records.append((key, float(area), round(floors)))

    records.sort()
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("wb") as output:
        output.write(HEADER.pack(b"TBFLOOR1", 2024, len(records)))
        for record in records:
            output.write(RECORD.pack(*record))
    return len(records)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path, help="CATASTRAL_BDG_2024.gdb")
    parser.add_argument("target", type=Path, help="cali-floors-2024.bin")
    args = parser.parse_args()
    count = build(args.source, args.target)
    print(f"wrote {count} records to {args.target}")


if __name__ == "__main__":
    main()
