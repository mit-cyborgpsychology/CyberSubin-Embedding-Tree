#!/usr/bin/env python3
"""Export one extracted dance archive to a long-form CSV file."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

import numpy as np


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("clip", type=int, choices=range(1, 60), metavar="CLIP_ID")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    source = args.root / "public" / "data" / "timeseries" / f"{args.clip:02d}.npz"
    output = args.output or source.with_suffix(".csv")
    data = np.load(source)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
                "time_seconds",
                "joint",
                "body_group",
                "local_tx",
                "local_ty",
                "local_tz",
                "local_qx",
                "local_qy",
                "local_qz",
                "local_qw",
                "world_x",
                "world_y",
                "world_z",
                "velocity_x",
                "velocity_y",
                "velocity_z",
                "angular_speed_rad_s",
            ]
        )
        for t, time_value in enumerate(data["time_seconds"]):
            for j, joint in enumerate(data["joint_names"]):
                writer.writerow(
                    [
                        float(time_value),
                        str(joint),
                        str(data["joint_groups"][j]),
                        *map(float, data["local_translation"][t, j]),
                        *map(float, data["local_rotation_xyzw"][t, j]),
                        *map(float, data["world_position"][t, j]),
                        *map(float, data["linear_velocity"][t, j]),
                        float(data["angular_speed"][t, j]),
                    ]
                )
    print(output)


if __name__ == "__main__":
    main()

