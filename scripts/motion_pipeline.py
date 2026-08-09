#!/usr/bin/env python3
"""Extract GLB skeletal animation time series and build dance embeddings.

The extractor intentionally implements the small GLB subset used by this
collection directly: float animation accessors, LINEAR/STEP interpolation,
and TRS node transforms. Draco is used only for the meshes, so no mesh decoder
is required to recover the skeleton motion.
"""

from __future__ import annotations

import argparse
import json
import math
import re
import struct
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np


COMPONENT_DTYPES = {
    5120: np.dtype("<i1"),
    5121: np.dtype("<u1"),
    5122: np.dtype("<i2"),
    5123: np.dtype("<u2"),
    5125: np.dtype("<u4"),
    5126: np.dtype("<f4"),
}
TYPE_WIDTHS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}
ENTRY_RE = re.compile(
    r"\{\s*thai:\s*(?P<tq>['\"])(?P<thai>.*?)(?P=tq)\s*,"
    r"\s*english:\s*(?P<eq>['\"])(?P<english>.*?)(?P=eq)\s*,"
    r"\s*pronounce:\s*(?P<pq>['\"])(?P<pronounce>.*?)(?P=pq)\s*\}",
    re.DOTALL,
)


@dataclass
class Motion:
    clip_id: int
    source_file: str
    animation_name: str
    selection: str
    quality: str
    issues: list[str]
    time: np.ndarray
    joint_names: list[str]
    joint_groups: list[str]
    local_translation: np.ndarray
    local_rotation: np.ndarray
    world_position: np.ndarray
    linear_velocity: np.ndarray
    angular_speed: np.ndarray


def load_glb(path: Path) -> tuple[dict[str, Any], bytes]:
    payload = path.read_bytes()
    if len(payload) < 20:
        raise ValueError(f"{path.name}: not a valid GLB")
    magic, version, length = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2 or length != len(payload):
        raise ValueError(f"{path.name}: unsupported or malformed GLB header")

    document: dict[str, Any] | None = None
    binary = b""
    offset = 12
    while offset < length:
        chunk_length, chunk_type = struct.unpack_from("<I4s", payload, offset)
        offset += 8
        chunk = payload[offset : offset + chunk_length]
        offset += chunk_length
        if chunk_type == b"JSON":
            document = json.loads(chunk.rstrip(b" \t\r\n\0"))
        elif chunk_type == b"BIN\0":
            binary = chunk
    if document is None:
        raise ValueError(f"{path.name}: missing JSON chunk")
    return document, binary


def accessor_array(document: dict[str, Any], binary: bytes, index: int) -> np.ndarray:
    accessor = document["accessors"][index]
    if "sparse" in accessor:
        raise ValueError("Sparse animation accessors are not supported")
    view = document["bufferViews"][accessor["bufferView"]]
    dtype = COMPONENT_DTYPES[accessor["componentType"]]
    width = TYPE_WIDTHS[accessor["type"]]
    count = accessor["count"]
    item_size = dtype.itemsize * width
    stride = view.get("byteStride", item_size)
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)

    if stride == item_size:
        values = np.frombuffer(binary, dtype=dtype, count=count * width, offset=start)
        return values.reshape(count, width).copy()

    values = np.empty((count, width), dtype=dtype)
    for row in range(count):
        values[row] = np.frombuffer(
            binary,
            dtype=dtype,
            count=width,
            offset=start + row * stride,
        )
    return values


def normalize_quaternions(values: np.ndarray) -> np.ndarray:
    values = values.astype(np.float64, copy=True)
    norms = np.linalg.norm(values, axis=-1, keepdims=True)
    values /= np.maximum(norms, 1e-12)
    for i in range(1, len(values)):
        if np.dot(values[i - 1], values[i]) < 0:
            values[i] *= -1
    return values


def interpolate_vectors(
    key_times: np.ndarray,
    values: np.ndarray,
    sample_times: np.ndarray,
    interpolation: str,
) -> np.ndarray:
    key_times = key_times[:, 0].astype(np.float64)
    values = values.astype(np.float64)
    if len(key_times) == 1:
        return np.repeat(values, len(sample_times), axis=0)
    if interpolation == "STEP":
        indices = np.searchsorted(key_times, sample_times, side="right") - 1
        return values[np.clip(indices, 0, len(key_times) - 1)]
    if interpolation == "CUBICSPLINE":
        # GLTF stores in-tangent, value, out-tangent triplets. Linear sampling
        # of the values is a stable fallback for analysis of this collection.
        values = values.reshape(len(key_times), 3, -1)[:, 1, :]
    result = np.empty((len(sample_times), values.shape[1]), dtype=np.float64)
    for channel in range(values.shape[1]):
        result[:, channel] = np.interp(sample_times, key_times, values[:, channel])
    return result


def interpolate_quaternions(
    key_times: np.ndarray,
    values: np.ndarray,
    sample_times: np.ndarray,
    interpolation: str,
) -> np.ndarray:
    key_times = key_times[:, 0].astype(np.float64)
    if interpolation == "CUBICSPLINE":
        values = values.reshape(len(key_times), 3, 4)[:, 1, :]
    values = normalize_quaternions(values)
    if len(key_times) == 1:
        return np.repeat(values, len(sample_times), axis=0)
    if interpolation == "STEP":
        indices = np.searchsorted(key_times, sample_times, side="right") - 1
        return values[np.clip(indices, 0, len(key_times) - 1)]

    hi = np.searchsorted(key_times, sample_times, side="right")
    hi = np.clip(hi, 1, len(key_times) - 1)
    lo = hi - 1
    span = np.maximum(key_times[hi] - key_times[lo], 1e-12)
    alpha = ((sample_times - key_times[lo]) / span)[:, None]
    q0 = values[lo]
    q1 = values[hi].copy()
    dots = np.sum(q0 * q1, axis=1, keepdims=True)
    q1[dots[:, 0] < 0] *= -1
    dots = np.clip(np.abs(dots), 0.0, 1.0)
    theta = np.arccos(dots)
    sin_theta = np.sin(theta)
    near = sin_theta[:, 0] < 1e-7
    result = np.empty_like(q0)
    result[near] = (1 - alpha[near]) * q0[near] + alpha[near] * q1[near]
    far = ~near
    if np.any(far):
        a = np.sin((1 - alpha[far]) * theta[far]) / sin_theta[far]
        b = np.sin(alpha[far] * theta[far]) / sin_theta[far]
        result[far] = a * q0[far] + b * q1[far]
    result /= np.maximum(np.linalg.norm(result, axis=1, keepdims=True), 1e-12)
    return result


def quaternion_matrices(quaternions: np.ndarray) -> np.ndarray:
    q = quaternions / np.maximum(
        np.linalg.norm(quaternions, axis=-1, keepdims=True), 1e-12
    )
    x, y, z, w = np.moveaxis(q, -1, 0)
    result = np.empty(q.shape[:-1] + (3, 3), dtype=np.float64)
    result[..., 0, 0] = 1 - 2 * (y * y + z * z)
    result[..., 0, 1] = 2 * (x * y - z * w)
    result[..., 0, 2] = 2 * (x * z + y * w)
    result[..., 1, 0] = 2 * (x * y + z * w)
    result[..., 1, 1] = 1 - 2 * (x * x + z * z)
    result[..., 1, 2] = 2 * (y * z - x * w)
    result[..., 2, 0] = 2 * (x * z - y * w)
    result[..., 2, 1] = 2 * (y * z + x * w)
    result[..., 2, 2] = 1 - 2 * (x * x + y * y)
    return result


def choose_animation(document: dict[str, Any], clip_id: int) -> tuple[int, str, str, list[str]]:
    names = [animation.get("name", f"animation-{i}") for i, animation in enumerate(document["animations"])]
    exact = [i for i, name in enumerate(names) if re.fullmatch(rf"no0*{clip_id}_Tas", name, re.I)]
    if exact:
        issues: list[str] = []
        if len(names) > 1:
            issues.append(f"Source contains {len(names)} animations; selected exact match {names[exact[-1]]}.")
        return exact[-1], names[exact[-1]], "exact-name", issues
    if len(names) == 1:
        return 0, names[0], "single-fallback", [
            f"Expected animation no{clip_id}_Tas, but source contains {names[0]}."
        ]
    return len(names) - 1, names[-1], "last-fallback", [
        f"Expected animation no{clip_id}_Tas; source has no match. Selected {names[-1]} from {len(names)} animations."
    ]


def joint_group(name: str) -> str:
    lower = name.lower()
    if lower.startswith("left"):
        return "left-leg" if any(token in lower for token in ("foot", "leg")) else "left-arm"
    if lower.startswith("right"):
        return "right-leg" if any(token in lower for token in ("foot", "leg")) else "right-arm"
    if "head" in lower or "neck" in lower:
        return "head"
    return "torso"


def extract_motion(path: Path, clip_id: int, sample_rate: float) -> Motion:
    document, binary = load_glb(path)
    animation_index, animation_name, selection, issues = choose_animation(document, clip_id)
    animation = document["animations"][animation_index]
    skin = document["skins"][0]
    joint_nodes = list(skin["joints"])
    joint_lookup = {node_index: i for i, node_index in enumerate(joint_nodes)}
    joint_names = [document["nodes"][i].get("name", f"node-{i}") for i in joint_nodes]
    groups = [joint_group(name) for name in joint_names]

    starts: list[float] = []
    ends: list[float] = []
    for sampler in animation["samplers"]:
        key_times = accessor_array(document, binary, sampler["input"])
        starts.append(float(key_times[0, 0]))
        ends.append(float(key_times[-1, 0]))
    start = min(starts)
    end = max(ends)
    count = max(2, int(round((end - start) * sample_rate)) + 1)
    sample_times = np.linspace(start, end, count, dtype=np.float64)

    joint_count = len(joint_nodes)
    local_t = np.zeros((count, joint_count, 3), dtype=np.float64)
    local_q = np.zeros((count, joint_count, 4), dtype=np.float64)
    local_q[..., 3] = 1.0
    local_s = np.ones((count, joint_count, 3), dtype=np.float64)
    for j, node_index in enumerate(joint_nodes):
        node = document["nodes"][node_index]
        local_t[:, j] = np.asarray(node.get("translation", [0, 0, 0]), dtype=np.float64)
        local_q[:, j] = np.asarray(node.get("rotation", [0, 0, 0, 1]), dtype=np.float64)
        local_s[:, j] = np.asarray(node.get("scale", [1, 1, 1]), dtype=np.float64)

    for channel in animation["channels"]:
        node_index = channel["target"]["node"]
        if node_index not in joint_lookup:
            continue
        j = joint_lookup[node_index]
        path_name = channel["target"]["path"]
        sampler = animation["samplers"][channel["sampler"]]
        key_times = accessor_array(document, binary, sampler["input"])
        values = accessor_array(document, binary, sampler["output"])
        interpolation = sampler.get("interpolation", "LINEAR")
        if path_name == "rotation":
            local_q[:, j] = interpolate_quaternions(key_times, values, sample_times, interpolation)
        elif path_name == "translation":
            local_t[:, j] = interpolate_vectors(key_times, values, sample_times, interpolation)
        elif path_name == "scale":
            local_s[:, j] = interpolate_vectors(key_times, values, sample_times, interpolation)

    parent_by_node: dict[int, int] = {}
    for parent_index, node in enumerate(document["nodes"]):
        for child_index in node.get("children", []):
            parent_by_node[child_index] = parent_index
    ordered = sorted(
        joint_nodes,
        key=lambda node_index: hierarchy_depth(node_index, parent_by_node),
    )
    local_m = quaternion_matrices(local_q)
    local_m *= local_s[..., None, :]
    world_m = np.empty_like(local_m)
    world_p = np.empty_like(local_t)
    for node_index in ordered:
        j = joint_lookup[node_index]
        parent_index = parent_by_node.get(node_index)
        if parent_index is None or parent_index not in joint_lookup:
            world_m[:, j] = local_m[:, j]
            world_p[:, j] = local_t[:, j]
        else:
            p = joint_lookup[parent_index]
            world_m[:, j] = np.einsum("tij,tjk->tik", world_m[:, p], local_m[:, j])
            world_p[:, j] = world_p[:, p] + np.einsum("tij,tj->ti", world_m[:, p], local_t[:, j])

    dt = float(np.mean(np.diff(sample_times)))
    velocity = np.gradient(world_p, dt, axis=0, edge_order=1)
    angular_speed = quaternion_angular_speed(local_q, dt)
    quality = "warning" if selection != "exact-name" else "verified"
    return Motion(
        clip_id=clip_id,
        source_file=path.name,
        animation_name=animation_name,
        selection=selection,
        quality=quality,
        issues=issues,
        time=(sample_times - sample_times[0]).astype(np.float32),
        joint_names=joint_names,
        joint_groups=groups,
        local_translation=local_t.astype(np.float32),
        local_rotation=local_q.astype(np.float32),
        world_position=world_p.astype(np.float32),
        linear_velocity=velocity.astype(np.float32),
        angular_speed=angular_speed.astype(np.float32),
    )


def hierarchy_depth(node_index: int, parents: dict[int, int]) -> int:
    depth = 0
    seen: set[int] = set()
    while node_index in parents and node_index not in seen:
        seen.add(node_index)
        node_index = parents[node_index]
        depth += 1
    return depth


def quaternion_angular_speed(q: np.ndarray, dt: float) -> np.ndarray:
    q0 = q[:-1]
    q1 = q[1:].copy()
    dots = np.sum(q0 * q1, axis=-1)
    q1[dots < 0] *= -1
    dots = np.clip(np.abs(np.sum(q0 * q1, axis=-1)), 0.0, 1.0)
    speed = 2 * np.arccos(dots) / max(dt, 1e-12)
    result = np.empty(q.shape[:2], dtype=np.float64)
    result[0] = speed[0]
    result[-1] = speed[-1]
    if len(result) > 2:
        result[1:-1] = (speed[:-1] + speed[1:]) / 2
    return result


def quaternion_to_6d(q: np.ndarray) -> np.ndarray:
    matrix = quaternion_matrices(q)
    return matrix[..., :, :2].reshape(q.shape[:-1] + (6,))


def phase_resample(values: np.ndarray, frames: int) -> np.ndarray:
    source = np.linspace(0.0, 1.0, values.shape[0])
    target = np.linspace(0.0, 1.0, frames)
    flat = values.reshape(values.shape[0], -1)
    result = np.empty((frames, flat.shape[1]), dtype=np.float64)
    for channel in range(flat.shape[1]):
        result[:, channel] = np.interp(target, source, flat[:, channel])
    return result


def motion_frame_features(motion: Motion, frames: int) -> np.ndarray:
    root_index = motion.joint_names.index("Hips") if "Hips" in motion.joint_names else 0
    centered = motion.world_position.astype(np.float64) - motion.world_position[:, root_index : root_index + 1]
    head_candidates = [i for i, name in enumerate(motion.joint_names) if name == "Head"]
    head_index = head_candidates[0] if head_candidates else int(np.argmax(centered[0, :, 1]))
    body_scale = float(np.median(np.linalg.norm(centered[:, head_index], axis=1)))
    centered /= max(body_scale, 1e-6)
    rotations = quaternion_to_6d(motion.local_rotation.astype(np.float64))
    positions = phase_resample(centered, frames).reshape(frames, len(motion.joint_names), 3)
    rotations = phase_resample(rotations, frames).reshape(frames, len(motion.joint_names), 6)
    return np.concatenate([positions, rotations], axis=2).reshape(frames, -1)


def body_region_channel_weights(motion: Motion) -> np.ndarray:
    """Give each body region equal aggregate squared weight after z-scoring."""
    counts = {group: motion.joint_groups.count(group) for group in set(motion.joint_groups)}
    joint_weights = np.asarray(
        [1.0 / math.sqrt(counts[group]) for group in motion.joint_groups],
        dtype=np.float64,
    )
    return np.repeat(joint_weights, 9)


def reduce_frame_features(
    features: list[np.ndarray],
    components: int,
    channel_weights: np.ndarray,
) -> list[np.ndarray]:
    stacked = np.concatenate(features, axis=0)
    mean = stacked.mean(axis=0)
    std = stacked.std(axis=0)
    standardized = (stacked - mean) / np.where(std < 1e-6, 1.0, std)
    if channel_weights.shape != (standardized.shape[1],):
        raise ValueError(
            f"Expected {standardized.shape[1]} channel weights; got {channel_weights.shape}"
        )
    standardized *= channel_weights[None, :]
    _, _, vt = np.linalg.svd(standardized, full_matrices=False)
    basis = vt[: min(components, vt.shape[0])].T
    reduced = standardized @ basis
    result: list[np.ndarray] = []
    offset = 0
    for feature in features:
        result.append(reduced[offset : offset + len(feature)])
        offset += len(feature)
    return result


def dtw_distance(a: np.ndarray, b: np.ndarray, band_ratio: float = 0.15) -> float:
    n, m = len(a), len(b)
    band = max(abs(n - m), int(max(n, m) * band_ratio))
    previous = np.full(m + 1, np.inf, dtype=np.float64)
    previous[0] = 0.0
    path_previous = np.zeros(m + 1, dtype=np.int32)
    for i in range(1, n + 1):
        current = np.full(m + 1, np.inf, dtype=np.float64)
        path_current = np.zeros(m + 1, dtype=np.int32)
        start = max(1, i - band)
        end = min(m, i + band)
        local = np.linalg.norm(b[start - 1 : end] - a[i - 1], axis=1)
        for offset, j in enumerate(range(start, end + 1)):
            candidates = (previous[j], current[j - 1], previous[j - 1])
            choice = int(np.argmin(candidates))
            if choice == 0:
                best, length = candidates[0], path_previous[j]
            elif choice == 1:
                best, length = candidates[1], path_current[j - 1]
            else:
                best, length = candidates[2], path_previous[j - 1]
            current[j] = local[offset] + best
            path_current[j] = length + 1
        previous = current
        path_previous = path_current
    return float(previous[m] / max(path_previous[m], 1))


def distance_matrix(features: list[np.ndarray], durations: np.ndarray) -> np.ndarray:
    count = len(features)
    result = np.zeros((count, count), dtype=np.float64)
    for i in range(count):
        for j in range(i + 1, count):
            shape_distance = dtw_distance(features[i], features[j])
            duration_distance = abs(math.log(max(durations[i], 1e-6) / max(durations[j], 1e-6)))
            distance = math.sqrt(shape_distance**2 + (0.12 * duration_distance) ** 2)
            result[i, j] = result[j, i] = distance
    return result


def classical_mds(distances: np.ndarray, dimensions: int) -> np.ndarray:
    count = len(distances)
    centering = np.eye(count) - np.ones((count, count)) / count
    gram = -0.5 * centering @ (distances**2) @ centering
    values, vectors = np.linalg.eigh(gram)
    order = np.argsort(values)[::-1]
    values = np.maximum(values[order[:dimensions]], 0.0)
    return vectors[:, order[:dimensions]] * np.sqrt(values)[None, :]


def embed_distances(distances: np.ndarray, dimensions: int, seed: int) -> tuple[np.ndarray, str]:
    try:
        import umap  # type: ignore

        model = umap.UMAP(
            n_neighbors=min(8, len(distances) - 1),
            n_components=dimensions,
            metric="precomputed",
            min_dist=0.12 if dimensions == 2 else 0.05,
            random_state=seed,
        )
        return model.fit_transform(distances).astype(np.float64), "UMAP"
    except ImportError:
        return classical_mds(distances, dimensions), "classical MDS fallback"


def load_metadata(path: Path) -> list[dict[str, str]]:
    text = path.read_text(encoding="utf-8")
    result = []
    for match in ENTRY_RE.finditer(text):
        result.append(
            {
                "thai": match.group("thai").strip(),
                "english": match.group("english").strip(),
                "pronounce": match.group("pronounce").strip(),
            }
        )
    if len(result) < 59:
        raise ValueError(f"Expected at least 59 posture labels in {path.name}; found {len(result)}")
    if len(result) > 59:
        print(
            f"Metadata warning: {path.name} contains {len(result)} labels but only 59 GLBs; "
            f"the unpaired final label is {result[59]['thai']} / {result[59]['english']}.",
            flush=True,
        )
    return result[:59]


def save_timeseries(motion: Motion, output: Path) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(
        output,
        time_seconds=motion.time,
        joint_names=np.asarray(motion.joint_names, dtype="U32"),
        joint_groups=np.asarray(motion.joint_groups, dtype="U16"),
        local_translation=motion.local_translation,
        local_rotation_xyzw=motion.local_rotation,
        world_position=motion.world_position,
        linear_velocity=motion.linear_velocity,
        angular_speed=motion.angular_speed,
    )


def motion_metrics(motion: Motion) -> dict[str, Any]:
    duration = float(motion.time[-1])
    group_energy: dict[str, float] = {}
    for group in sorted(set(motion.joint_groups)):
        indices = [i for i, value in enumerate(motion.joint_groups) if value == group]
        speeds = np.linalg.norm(motion.linear_velocity[:, indices], axis=-1)
        group_energy[group] = float(np.sqrt(np.mean(speeds**2)))
    total = sum(group_energy.values()) or 1.0
    group_energy = {key: value / total for key, value in group_energy.items()}
    root_index = motion.joint_names.index("Hips") if "Hips" in motion.joint_names else 0
    relative = motion.world_position - motion.world_position[:, root_index : root_index + 1]
    extent = np.ptp(relative.reshape(-1, 3), axis=0)
    left = group_energy.get("left-arm", 0.0) + group_energy.get("left-leg", 0.0)
    right = group_energy.get("right-arm", 0.0) + group_energy.get("right-leg", 0.0)
    return {
        "duration_seconds": round(duration, 3),
        "samples": int(len(motion.time)),
        "joint_count": len(motion.joint_names),
        "mean_speed": round(float(np.mean(np.linalg.norm(motion.linear_velocity, axis=-1))), 5),
        "mean_angular_speed": round(float(np.mean(motion.angular_speed)), 5),
        "spatial_extent": [round(float(value), 4) for value in extent],
        "symmetry_balance": round(1.0 - min(abs(left - right) / max(left + right, 1e-9), 1.0), 4),
        "body_energy": {key: round(value, 5) for key, value in group_energy.items()},
        "dominant_group": max(group_energy, key=group_energy.get),
    }


def skeleton_measurements(motion: Motion) -> dict[str, Any]:
    """Return anatomical scale and a phase-normalized skeleton-center track."""
    root_index = motion.joint_names.index("Hips") if "Hips" in motion.joint_names else 0
    head_candidates = [i for i, name in enumerate(motion.joint_names) if name == "Head"]
    head_index = head_candidates[0] if head_candidates else int(
        np.argmax(motion.world_position[0, :, 1])
    )
    head_to_hips = np.linalg.norm(
        motion.world_position[:, head_index] - motion.world_position[:, root_index],
        axis=1,
    )
    skeleton_center = (
        motion.world_position.min(axis=1) + motion.world_position.max(axis=1)
    ) / 2.0
    center_track = phase_resample(skeleton_center, 64)
    calibration_frame = min(5, len(motion.time) - 1)
    return {
        "measurement": "median Euclidean Head-to-Hips joint distance across the animation",
        "head_to_hips_distance": round(float(np.median(head_to_hips)), 6),
        "calibration_frame_index": calibration_frame,
        "calibration_time_seconds": round(
            float(motion.time[calibration_frame] - motion.time[0]), 6
        ),
        "calibration_head_to_hips_distance": round(
            float(head_to_hips[calibration_frame]), 6
        ),
        "calibration_center": [
            round(float(value), 5) for value in skeleton_center[calibration_frame]
        ],
        "center_measurement": "per-frame center of the complete 59-joint skeleton bounding box",
        "center_track_phase_frames": 64,
        "center_track": [
            [round(float(value), 5) for value in center]
            for center in center_track
        ],
    }


def normalize_map_coordinates(values: np.ndarray) -> np.ndarray:
    result = np.empty_like(values, dtype=np.float64)
    for axis in range(2):
        low, high = np.percentile(values[:, axis], [1, 99])
        if high - low < 1e-9:
            result[:, axis] = 0.5
        else:
            result[:, axis] = np.clip((values[:, axis] - low) / (high - low), 0, 1)
    return result


def build_lineage_tree(
    distances: np.ndarray,
    movements: list[dict[str, Any]],
) -> dict[str, Any]:
    """Build a rooted motion-similarity dendrogram with average linkage.

    Internal nodes are descriptive cluster archetypes, not claims of historical
    or biological descent. Each node stores the recorded medoid closest to all
    other descendants so the interface can show a concrete GLB exemplar.
    """
    from scipy.cluster.hierarchy import linkage  # type: ignore
    from scipy.spatial.distance import squareform  # type: ignore

    count = len(movements)
    condensed = squareform(distances, checks=True)
    matrix = linkage(condensed, method="average", optimal_ordering=True)
    nodes: dict[int, dict[str, Any]] = {}
    for index, movement in enumerate(movements):
        nodes[index] = {
            "id": f"m{movement['id']}",
            "type": "movement",
            "movement_id": movement["id"],
            "members": [movement["id"]],
            "height": 0.0,
            "medoid": movement["id"],
            "dominant_group": movement["metrics"]["dominant_group"],
            "body_energy": movement["metrics"]["body_energy"],
        }

    for row_index, row in enumerate(matrix):
        left_index, right_index = int(row[0]), int(row[1])
        node_index = count + row_index
        left = nodes[left_index]
        right = nodes[right_index]
        members = left["members"] + right["members"]
        zero_based = np.asarray([member - 1 for member in members], dtype=int)
        within = distances[np.ix_(zero_based, zero_based)]
        medoid_local = int(np.argmin(within.sum(axis=1)))
        medoid = members[medoid_local]
        body_energy: dict[str, float] = {}
        for group in movements[0]["metrics"]["body_energy"]:
            body_energy[group] = float(
                np.mean([movements[member - 1]["metrics"]["body_energy"].get(group, 0.0) for member in members])
            )
        total_energy = sum(body_energy.values()) or 1.0
        body_energy = {group: round(value / total_energy, 5) for group, value in body_energy.items()}
        dominant_group = max(body_energy, key=body_energy.get)
        node_id = f"c{node_index + 1}"
        nodes[node_index] = {
            "id": node_id,
            "type": "ancestor",
            "left": left["id"],
            "right": right["id"],
            "members": members,
            "count": len(members),
            "height": round(float(row[2]), 7),
            "medoid": medoid,
            "dominant_group": dominant_group,
            "body_energy": body_energy,
        }
        left["parent"] = node_id
        right["parent"] = node_id

    root = nodes[count + len(matrix) - 1]

    def leaf_order(node: dict[str, Any]) -> list[int]:
        if node["type"] == "movement":
            return [node["movement_id"]]
        by_id = {value["id"]: value for value in nodes.values()}
        return leaf_order(by_id[node["left"]]) + leaf_order(by_id[node["right"]])

    return {
        "method": "average-linkage hierarchical clustering (UPGMA) on the multivariate DTW distance matrix",
        "interpretation": "Internal nodes are inferred motion-similarity archetypes, not verified historical ancestors.",
        "root": root["id"],
        "max_height": root["height"],
        "leaf_order": leaf_order(root),
        "nodes": [nodes[index] for index in sorted(nodes)],
    }


def build_project(root: Path, sample_rate: float, phase_frames: int, seed: int) -> None:
    metadata = load_metadata(root / "59.ts")
    glb_dir = root / "glb-optim"
    output_dir = root / "public" / "data"
    series_dir = output_dir / "timeseries"
    series_dir.mkdir(parents=True, exist_ok=True)

    motions: list[Motion] = []
    for clip_id in range(1, 60):
        print(f"[{clip_id:02d}/59] extracting {clip_id}.glb", flush=True)
        motion = extract_motion(glb_dir / f"{clip_id}.glb", clip_id, sample_rate)
        motions.append(motion)
        save_timeseries(motion, series_dir / f"{clip_id:02d}.npz")

    features = [motion_frame_features(motion, phase_frames) for motion in motions]
    channel_weights = body_region_channel_weights(motions[0])
    reduced = reduce_frame_features(features, components=24, channel_weights=channel_weights)
    durations = np.asarray([motion.time[-1] for motion in motions], dtype=np.float64)
    print("Computing multivariate DTW distance matrix", flush=True)
    distances = distance_matrix(reduced, durations)
    high, method_high = embed_distances(distances, dimensions=16, seed=seed)
    map_raw, method_map = embed_distances(distances, dimensions=2, seed=seed)
    map_values = normalize_map_coordinates(map_raw)

    entries: list[dict[str, Any]] = []
    for i, motion in enumerate(motions):
        order = np.argsort(distances[i])
        neighbors = [
            {"id": int(index + 1), "distance": round(float(distances[i, index]), 6)}
            for index in order
            if index != i
        ][:5]
        entries.append(
            {
                "id": motion.clip_id,
                **metadata[i],
                "glb": f"glb-optim/{motion.clip_id}.glb",
                "timeseries": f"public/data/timeseries/{motion.clip_id:02d}.npz",
                "animation_name": motion.animation_name,
                "animation_selection": motion.selection,
                "quality": motion.quality,
                "issues": motion.issues,
                "embedding": [round(float(value), 7) for value in high[i]],
                "map": {"x": round(float(map_values[i, 0]), 6), "y": round(float(map_values[i, 1]), 6)},
                "skeleton": skeleton_measurements(motion),
                "metrics": motion_metrics(motion),
                "neighbors": neighbors,
            }
        )

    lineage_tree = build_lineage_tree(distances, entries)

    payload = {
        "schema_version": 1,
        "generated_from": "59 GLB motion files and 59.ts labels",
        "sample_rate_hz": sample_rate,
        "phase_frames": phase_frames,
        "frame_feature_components": 24,
        "raw_frame_feature_dimensions": int(features[0].shape[1]),
        "body_region_weighting": "inverse square root of joint count, applied after per-channel z-score normalization",
        "embedding_dimensions": 16,
        "distance": "Sakoe-Chiba constrained multivariate DTW on root-normalized positions and continuous 6D local rotations, plus a small duration term",
        "embedding_method": method_high,
        "map_method": method_map,
        "random_seed": seed,
        "avatar_framing": {
            "measurement": "Head-to-Hips joint distance at sample frame index +5",
            "calibration_frame_index": 5,
            "center_measurement": "64-phase track of the complete 59-joint skeleton bounding-box center",
            "camera_distance_multiplier": 6.25,
            "field_of_view_degrees": 35,
            "playback_speed": 3,
            "collection_median_head_to_hips": round(
                float(np.median([entry["skeleton"]["head_to_hips_distance"] for entry in entries])),
                6,
            ),
        },
        "joints": motions[0].joint_names,
        "body_groups": sorted(set(motions[0].joint_groups)),
        "quality_summary": {
            "verified": sum(motion.quality == "verified" for motion in motions),
            "warning": sum(motion.quality == "warning" for motion in motions),
        },
        "collection_issues": [
            "59.ts contains a 60th label (กินนรรำ / A Kinnorn Dancing) without a corresponding GLB.",
            "20.glb is byte-identical to 21.glb and contains animation no21_Tas.",
            "32.glb contains animations no22_Tas through no31_Tas but no animation no32_Tas.",
        ],
        "lineage_tree": lineage_tree,
        "movements": entries,
    }
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "embedding.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    np.save(output_dir / "distance-matrix.npy", distances.astype(np.float32))
    (output_dir / "timeseries-schema.json").write_text(
        json.dumps(
            {
                "format": "NumPy compressed archive (.npz)",
                "sample_rate_hz": sample_rate,
                "arrays": {
                    "time_seconds": "[time] seconds from animation start",
                    "joint_names": "[joint] GLB skeleton node names",
                    "joint_groups": "[joint] analytical body-part groups",
                    "local_translation": "[time, joint, xyz] GLB local translation",
                    "local_rotation_xyzw": "[time, joint, xyzw] normalized local quaternion",
                    "world_position": "[time, joint, xyz] forward-kinematic world position",
                    "linear_velocity": "[time, joint, xyz] world-position derivative per second",
                    "angular_speed": "[time, joint] local angular speed in radians per second",
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {output_dir / 'embedding.json'}", flush=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--sample-rate", type=float, default=12.0)
    parser.add_argument("--phase-frames", type=int, default=64)
    parser.add_argument("--seed", type=int, default=42)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    build_project(args.root.resolve(), args.sample_rate, args.phase_frames, args.seed)
