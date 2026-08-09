# CyberSubin-Embedding Map and Tree

An analysis pipeline and interactive atlas for 59 Thai traditional dance motion-capture clips. The project extracts the animated skeleton from each GLB into body-part time series, creates a reproducible motion embedding, and places every dance in a searchable 2D similarity map with its original animated avatar.

## Open the atlas

The site is static, but browsers require an HTTP server to load JSON and GLB files:

```bash
cd /path/to/CyberSubin-Embedding-Tree
python3 -m http.server 8000
```

Open [http://localhost:8000](http://localhost:8000). The project root opens the full-screen **All-Avatar Embedding** directly. The earlier combined map-and-tree interface has been retired; the three active views are the all-avatar embedding map, the circular motion lineage, and the 3D evolutionary motion tree.

Open [http://localhost:8000/avatar-map.html](http://localhost:8000/avatar-map.html) for the separate **All-Avatar Embedding**: a full-screen view that plays all 59 GLB recordings at once. Every avatar is centered directly on its exact 2D UMAP coordinate, and overlap is intentionally preserved. The page includes play/pause-all, label visibility, zoom, pan, and refit controls.

The all-avatar view uses transparent, borderless previews on a black embedding field. Calibration uses sample frame index +5—the sixth extracted frame, approximately 0.42 seconds after the start at 12 Hz—rather than the first frame. Its Head-to-Hips distance fixes the absolute skeleton-proportional camera distance, and its complete 59-joint bounding-box center supplies the initial camera target. A 64-phase skeleton-center track keeps the body centered afterward. Every avatar is placed directly on its UMAP coordinate, overlap is preserved, and playback begins at the calibration pose at 3× speed. Use the +/− controls or scroll to zoom from 50% to 400%; drag the field to pan, and use **Refit** to restore the complete map.

Open [http://localhost:8000/circular-tree.html](http://localhost:8000/circular-tree.html) for the **Circular Motion Lineage**. It renders the average-linkage DTW hierarchy as a radial dendrogram and places all 59 skeleton-normalized, 3× GLB animations around the outer ring in dendrogram leaf order. Radial branch position encodes merge dissimilarity. For visual separation, the optimized leaf order is divided into six contiguous, nearly equal branch groups of 9–10 movements. Every pure descendant branch, leaf tick, and avatar in a group shares one stable color; central branches spanning multiple groups remain neutral. These colors are presentation groups, not additional inferred ancestry. Use the branch navigator's arrow controls or colored group buttons to highlight one branch sector; all of that sector's shared connectors are recolored into one continuous path to the root, while the complete tree remains visible as dimmed context. Small merge-point markers make every branch joint explicit, and **All** restores the full tree. Selecting an avatar activates its branch group and traces that movement's complete path to the shared root. The circular tree supports zoom, pan, fit, label visibility, and global playback controls.

Open [http://localhost:8000/evolution-tree-3d.html](http://localhost:8000/evolution-tree-3d.html) for the **3D Evolutionary Motion Tree**. This view is rebuilt as one self-contained HTML page with inline styles and controls, eliminating separate page-specific CSS and JavaScript files that could become stale. The same 117-node average-linkage hierarchy grows from a shared root to all 59 animated observed movements in a plant-like spatial crown. A visual backbone is traced by repeatedly selecting the child with the largest descendant set for exactly ten steps. Those ten parent–child steps are fixed to the vertical axis and kept neutral grey, producing a straight lower trunk that remains upright as the view rotates. The backbone stops at that point: its two children form a matched left–right top fork with the same launch height, opening angle, and nearly equal segment length. Both receive the same 0.48-radian azimuthal twist, which preserves their symmetric screen projection while sending them toward opposite sides of the depth axis. Other side subtrees attached along the lower trunk are greedily divided between left and right by descendant count, then fanned up to 0.62 radians forward or backward using a depth-indexed golden-angle phase. A longer virtual camera distance supplies restrained perspective depth, preventing a foreground bough from visually overpowering its symmetric background partner. The result retains a balanced default silhouette but occupies a genuinely three-dimensional crown instead of a single plane. Within every side subtree, the child with the larger descendant set becomes a visual leader: it inherits most of its parent's growth heading and bends only gradually, while the lateral child peels away by a deterministic 22–42 degree divergence. This directional inheritance replaces alternating fork angles that can create zigzags. Segment length varies independently by child and grows with depth, while roughly the longest upper third receive an additional deterministic 12–37% reach extension. A 1.82 horizontal expansion factor broadens lateral growth. Connections use tangent-aware cubic curves: leader edges enter a joint along the incoming growth direction, while lateral edges arc away more quickly. Small deterministic bend and lift variation softens the silhouette while preserving every parent, child, and endpoint; the straight lower stem is explicitly exempt from curvature. Tips with more root-to-tip hierarchy steps generally appear taller; selecting an avatar reports its step count. Height therefore approximates topological hop depth in this rendering, not dendrogram dissimilarity. Branch width still tapers with descendant-cluster size. The rotatable hierarchy is projected into SVG, while each animated leaf uses the same `model-viewer` engine as the embedding and circular views. Every GLB is normalized by its frame +5 Head-to-Hips skeleton measurement, centered using the 64-phase skeleton track, and played at 3× speed. Drag to rotate, scroll to zoom, use the branch navigator to isolate a continuous root-to-canopy sector, or choose a numbered avatar to trace one terminal path. The pinned avatar component and Draco decoder are vendored locally, so the hierarchy, renderer, decoder, and GLBs all load from the same local server. Hop depth in this inferred similarity tree is not evidence of historical chronology, biological evolution, cultural primitivity, or direct descent.

The GLBs use Draco mesh compression. The viewer and Draco decoder are bundled under `vendor/`, so the visualizations do not require an internet connection when served from this project.

## Generated data

Running the pipeline creates:

- `public/data/timeseries/01.npz` through `59.npz`: compact time series sampled at 12 Hz.
- `public/data/embedding.json`: names, quality flags, 16-dimensional embeddings, 2D map coordinates, metrics, nearest neighbors, and the rooted lineage tree.
- `public/data/distance-matrix.npy`: the complete 59 × 59 motion-distance matrix.
- `public/data/timeseries-schema.json`: array names, shapes, and meanings.

Each `.npz` archive contains:

| Array | Shape | Meaning |
| --- | --- | --- |
| `time_seconds` | time | Seconds since the selected animation begins |
| `joint_names` | joint | The 59 GLB skeleton-node names |
| `joint_groups` | joint | Analytical body-region assignment |
| `local_translation` | time × joint × 3 | Local GLB translation |
| `local_rotation_xyzw` | time × joint × 4 | Unit local quaternion |
| `world_position` | time × joint × 3 | Position reconstructed by forward kinematics |
| `linear_velocity` | time × joint × 3 | World-position derivative per second |
| `angular_speed` | time × joint | Local angular speed in radians per second |

The GLBs do not declare a physical length unit, so positions and linear velocities remain in source scene units. Rotations, angular speeds, time, and normalized embedding features are unit-safe.

To export a clip as a long-form CSV:

```bash
python3 scripts/export_csv.py 1
```

## Rebuild the analysis

Python 3.10+ is recommended.

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python scripts/motion_pipeline.py
python scripts/validate_outputs.py
```

The run is deterministic (`random_seed = 42`). Change sampling or phase resolution explicitly if needed:

```bash
python scripts/motion_pipeline.py --sample-rate 12 --phase-frames 64 --seed 42
```

## Methodology: converting skeletal time series into embeddings

There is no universally best representation for time-series data. The choice depends on the number of independent samples, the invariances that should define similarity, and the intended downstream analysis. This collection has only 59 independent recordings, so the pipeline uses an explicit, deterministic kinematic distance rather than training a high-capacity neural encoder.

The complete transformation is:

```text
GLB animation channels
  → uniformly sampled skeletal time series
  → forward-kinematic world positions
  → root- and scale-normalized joint trajectories
  → continuous 6D joint rotations
  → 531-dimensional frame vectors
  → 64-frame phase normalization
  → channel standardization and body-region weighting
  → 24-dimensional per-frame PCA representation
  → 59 × 59 multivariate DTW distance matrix
  → 16D UMAP embedding + independent 2D UMAP map
  → average-linkage movement tree
```

### 1. Select and sample each GLB animation

For movement (i), the pipeline first searches `i.glb` for an animation named exactly `no{i}_Tas`. If the exact animation is absent, the deterministic fallback and warning are recorded in `embedding.json`.

GLB animation channels can have different key times and interpolation modes. Every selected animation is therefore sampled onto one uniform clock at 12 Hz:

\[
t_k = t_0 + \frac{k}{12}, \qquad k = 0,\ldots,T_i-1.
\]

Translations and scales use the interpolation specified by the GLB (`LINEAR` or `STEP`). Joint quaternions are normalized, sign-unwrapped so adjacent samples remain on the same quaternion hemisphere, and interpolated with spherical linear interpolation. This avoids sudden numerical sign changes between (q) and (-q), which describe the same physical rotation.

The extracted archive preserves seven analytical arrays for all 59 joints: local translation, local quaternion rotation, reconstructed world position, linear velocity, angular speed, joint name, and body-region assignment. Velocities are saved for descriptive analysis, but the current embedding itself uses joint positions and rotations.

### 2. Reconstruct world-space joint trajectories

GLB stores each joint relative to its parent. The pipeline traverses the skeleton from the hips outward and performs forward kinematics. For joint (j), parent (p(j)), frame (t), local rotation (R^{L}_{t,j}), and local translation (d^{L}_{t,j}):

\[
R^{W}_{t,j} = R^{W}_{t,p(j)}R^{L}_{t,j},
\]

\[
p^{W}_{t,j} = p^{W}_{t,p(j)} + R^{W}_{t,p(j)}d^{L}_{t,j}.
\]

The implementation applies the complete GLB translation–rotation–scale transform, including animated scale when present. This produces a trajectory (p^{W}_{t,j}\in\mathbb{R}^{3}) for every body joint at every sampled time.

### 3. Canonicalize position and rotation

Raw world coordinates include the avatar’s arbitrary scene location and skeleton scale. For every frame, the hips are treated as the root. Joint positions are centered on the hips and divided by a robust body-size estimate:

\[
\tilde{p}_{t,j} = \frac{p^{W}_{t,j}-p^{W}_{t,\mathrm{hips}}}{s_i},
\]

where (s_i) is the median head-to-hips distance across movement (i). Consequently, the comparison emphasizes articulated pose rather than where the avatar was placed in the scene. The current pipeline does **not** rotate every movement into a common facing direction, because all recordings use the same rig and coordinate convention.

Local quaternions are converted to rotation matrices, and the first two matrix columns are retained as a continuous six-value representation (r^{6D}_{t,j}\). Unlike Euler angles or raw quaternion coordinates, this representation avoids discontinuities that make Euclidean learning unstable ([Zhou et al., CVPR 2019](https://openaccess.thecvf.com/content_CVPR_2019/html/Zhou_On_the_Continuity_of_Rotation_Representations_in_Neural_Networks_CVPR_2019_paper.html)).

### 4. Construct the multivariate time series

At each time (t), the 3D root-relative position and 6D local rotation of every joint are concatenated:

\[
x_t = [\tilde{p}_{t,1}, r^{6D}_{t,1}, \ldots, \tilde{p}_{t,59}, r^{6D}_{t,59}].
\]

Each joint contributes (3+6=9) variables, so one frame initially has

\[
59\times9=531
\]

dimensions. Retaining all finger joints is important for Thai dance, where hand articulation is semantically meaningful.

### 5. Normalize movement duration and channel scale

The recordings have different durations. Each 531-variable sequence is linearly resampled from physical time onto 64 normalized phase positions:

\[
\tau_m = \frac{m}{63}, \qquad m=0,\ldots,63.
\]

This creates a common coarse progression from the beginning to the end of each dance phrase without forcing exact frame-to-frame correspondence.

All (59\times64=3{,}776) phase-normalized frames are then pooled to estimate one mean \(\mu_d\) and standard deviation \(\sigma_d\) for every feature channel (d):

\[
z_{t,d}=\frac{x_{t,d}-\mu_d}{\max(\sigma_d,10^{-6})}.
\]

This prevents high-magnitude position channels from dominating lower-magnitude rotation channels. After standardization, each channel belonging to body region (g) receives weight

\[
w_g=\frac{1}{\sqrt{n_g}},
\]

where (n_g) is the number of joints assigned to that region. Because total squared weight is approximately proportional to (n_gw_g^2=1), the large number of finger joints cannot overwhelm the torso, head, or legs merely through feature count. The six regions are left arm/hand, right arm/hand, left leg, right leg, torso, and head.

### 6. Reduce each frame from 531 to 24 dimensions

The weighted standardized frame matrix is factorized with singular value decomposition. The first 24 principal directions form matrix (W_{24}), and every frame becomes

\[
y_t=z_tW_{24}, \qquad y_t\in\mathbb{R}^{24}.
\]

PCA here is not the final dance embedding. It is an intermediate compression that removes correlated joint channels and makes temporal comparison computationally stable. Each dance is still represented as a sequence of 64 vectors:

\[
Y_i=(y_{i,1},\ldots,y_{i,64})\in\mathbb{R}^{64\times24}.
\]

### 7. Compare complete dances with multivariate DTW

Two recordings may execute the same phrase at slightly different rates. Directly flattening the 64 frames would penalize such local timing differences. Instead, the pipeline uses multivariate dynamic time warping (DTW). Its local cost is Euclidean distance between two 24D frame vectors:

\[
c(a,b)=\lVert y_{i,a}-y_{j,b}\rVert_2.
\]

The accumulated alignment cost is computed recursively:

\[
D(a,b)=c(a,b)+\min\{D(a-1,b),D(a,b-1),D(a-1,b-1)\}.
\]

The alignment is restricted to a 15% Sakoe–Chiba band—9 frames at the current 64-frame resolution—so DTW can correct moderate tempo variation without matching unrelated beginnings and endings. The final DTW cost is divided by alignment-path length.

Phase normalization removes most absolute-duration information, so a weak duration penalty is added back. If (L_i) and (L_j) are the original durations:

\[
d_{ij}=\sqrt{d_{\mathrm{DTW}}(i,j)^2+
\left(0.12\left|\log\frac{L_i}{L_j}\right|\right)^2}.
\]

This produces the symmetric (59\times59) matrix in `public/data/distance-matrix.npy`. DTW is used because temporal alignment is fundamental when comparing human motion performed at different rates; canonical time warping extends the same principle to cross-subject motion capture ([Zhou & De la Torre](https://www.cs.cmu.edu/~ftorre/web_page/humansensing.cs.cmu.edu/projects/ctw.html)).

### 8. Convert distances into the 16D embedding and 2D map

UMAP is fitted with `metric="precomputed"`, so its input is the DTW distance matrix rather than flattened raw time-series values. The neighborhood size is 8 and the random seed is fixed at 42.

Two independent models are fitted:

| Output | Dimensions | `min_dist` | Purpose |
| --- | ---: | ---: | --- |
| Dance embedding | 16 | 0.05 | Retain a richer dataset-level representation for similarity analysis |
| Visualization map | 2 | 0.12 | Produce readable coordinates for the interactive interface |

The 2D coordinates are **not** obtained by reducing the saved 16D vectors. Both outputs are fitted directly from the same DTW matrix, preventing distortions in the 16D representation from being compounded in the visual map. UMAP supports precomputed dissimilarities and aims to preserve local neighborhood structure ([McInnes et al.](https://arxiv.org/abs/1802.03426), [UMAP parameter documentation](https://umap-learn.readthedocs.io/en/latest/parameters.html#metric)). For display only, each 2D axis is scaled between its 1st and 99th percentiles and clipped to ([0,1]).

The final `embedding` field for dance (i) is therefore a 16-value UMAP coordinate derived from its DTW relationships to all 58 other recordings. It is a **collection-relative embedding**: adding a new dance requires computing its motion time series, rebuilding the distance matrix, and refitting UMAP so all coordinates remain comparable.

### 9. Construct the movement lineage tree

The tree is fitted directly to the same DTW matrix; it does not use either UMAP output. Average-linkage agglomerative clustering begins with 59 one-movement clusters and repeatedly merges the pair with the smallest average cross-cluster distance:

\[
d(A,B)=\frac{1}{|A||B|}\sum_{i\in A}\sum_{j\in B}d_{ij}.
\]

Merging continues until one root remains ([SciPy linkage documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.cluster.hierarchy.linkage.html)). Each internal node stores its descendants, merge distance, aggregate body-region activity, and medoid—the recorded movement minimizing total distance to the other descendants. The interface uses tree parent links to find the lowest common ancestor of any two selected leaves.

### Fixed analytical parameters

| Parameter | Value |
| --- | ---: |
| Source movements | 59 |
| Animated joints | 59 |
| Extraction rate | 12 Hz |
| Raw variables per frame | 531 |
| Normalized phase frames | 64 |
| PCA frame dimensions | 24 |
| DTW warping band | 15% / 9 frames |
| UMAP neighbors | 8 |
| Saved embedding dimensions | 16 |
| Visualization dimensions | 2 |
| Random seed | 42 |

### What “common ancestor” means here

The tree is a **motion-similarity dendrogram**, not evidence of historical transmission or chronological descent. Biological UPGMA interpretations usually rely on clock-like evolution, an assumption these dance recordings do not provide. Therefore:

- Leaves are observed GLB recordings.
- Internal nodes are inferred shared kinematic archetypes.
- The “closest archetype” avatar is a real descendant medoid, not a synthesized ancestral dance.
- Branch height is DTW merge dissimilarity, not time, age, or cultural influence.

Establishing a historical phylogeny would require dated sources, teacher–student lineages, regional provenance, choreographic notation, and expert constraints in addition to motion similarity.

### Why not train a neural time-series encoder now?

[TS2Vec](https://arxiv.org/abs/2106.10466) is a strong self-supervised baseline for larger time-series collections because it learns contextual representations at multiple temporal scales. Here there are only 59 independent sequences, no repeated performers, and no held-out semantic labels. Training a deep encoder on this set would make its apparent clusters difficult to validate and sensitive to augmentation choices. DTW + UMAP is deterministic, inspectable, and makes the desired tempo tolerance explicit.

When the collection grows to hundreds or thousands of independent recordings, compare this baseline against TS2Vec or a skeleton-graph encoder using performer-held-out evaluation. Measure neighbor agreement with expert labels, retrieval precision, stability across seeds, and robustness to tempo, mirroring, root translation, and missing joints.

## Source-data audit

The pipeline selects an animation whose name exactly matches the GLB number whenever possible. It records every fallback in `embedding.json`.

- `20.glb` is byte-identical to `21.glb`; both contain only `no21_Tas`. Movement 20 is therefore displayed but flagged as unverified.
- `32.glb` contains animations `no22_Tas` through `no31_Tas` and no `no32_Tas`. The deterministic fallback is `no31_Tas`, and movement 32 is flagged as unverified.
- `17.glb`, `51.glb`, and `52.glb` contain extra earlier animations, but the correctly numbered animation is present and selected.
- `59.ts` contains 60 labels even though only 59 GLBs exist. Labels 1–59 map by number; the final label, `กินนรรำ / A Kinnorn Dancing`, has no source GLB and is not shifted onto clip 59.

Because movements 20 and 32 do not have trustworthy source animation data, their coordinates must not be interpreted as evidence about those named dance forms. Replace those two GLBs and rerun the pipeline to repair the atlas.

## Interpretation limits

- UMAP axes are not named movement dimensions. Read local neighborhoods, not absolute left/right or up/down positions.
- Lineage-tree direction and branch height encode hierarchical motion similarity, not historical time.
- A 2D projection inevitably distorts some relationships. Use the saved 16D embeddings or DTW matrix for quantitative analysis.
- The current map describes these recordings on this rig. It does not yet estimate performer-invariant cultural categories.
- The body-energy chart is a normalized descriptive signal, not an expert assessment of technique, quality, or authenticity.
