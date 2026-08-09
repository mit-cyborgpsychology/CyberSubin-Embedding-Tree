#!/usr/bin/env python3
"""Validate generated motion archives and web-facing embedding metadata."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    payload = json.loads((ROOT / "public/data/embedding.json").read_text(encoding="utf-8"))
    movements = payload["movements"]
    assert len(movements) == 59
    assert [movement["id"] for movement in movements] == list(range(1, 60))
    assert all(len(movement["embedding"]) == 16 for movement in movements)
    assert all(0 <= movement["map"][axis] <= 1 for movement in movements for axis in ("x", "y"))
    assert payload["quality_summary"] == {"verified": 57, "warning": 2}
    tree = payload["lineage_tree"]
    assert len(tree["nodes"]) == 117
    assert len(tree["leaf_order"]) == 59
    assert sorted(tree["leaf_order"]) == list(range(1, 60))
    by_id = {node["id"]: node for node in tree["nodes"]}
    assert tree["root"] in by_id
    assert by_id[tree["root"]]["count"] == 59
    assert all(node["medoid"] in node["members"] for node in tree["nodes"])
    for node in tree["nodes"]:
        if node["type"] == "movement":
            assert node["movement_id"] in node["members"]
            continue
        assert node["left"] in by_id and node["right"] in by_id
        assert by_id[node["left"]]["parent"] == node["id"]
        assert by_id[node["right"]]["parent"] == node["id"]
        assert sorted(node["members"]) == sorted(by_id[node["left"]]["members"] + by_id[node["right"]]["members"])

    joint_count = len(payload["joints"])
    for clip_id in range(1, 60):
        path = ROOT / "public/data/timeseries" / f"{clip_id:02d}.npz"
        with np.load(path) as archive:
            sample_count = len(archive["time_seconds"])
            assert archive["local_translation"].shape == (sample_count, joint_count, 3)
            assert archive["local_rotation_xyzw"].shape == (sample_count, joint_count, 4)
            assert archive["world_position"].shape == (sample_count, joint_count, 3)
            assert np.isfinite(archive["world_position"]).all()
            norms = np.linalg.norm(archive["local_rotation_xyzw"], axis=-1)
            assert np.max(np.abs(norms - 1.0)) < 1e-4
    print("Validated 59 embeddings and 59 skeletal time-series archives.")


if __name__ == "__main__":
    main()
