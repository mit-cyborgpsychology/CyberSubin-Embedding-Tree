(() => {
  const SIZE = 1800;
  const CENTER = SIZE / 2;
  const ROOT_RADIUS = 0;
  const TREE_RADIUS = 500;
  const LABEL_RADIUS = 525;
  const AVATAR_RADIUS = 760;
  const AVATAR_WIDTH = 78;
  const AVATAR_HEIGHT = 112;

  const CLUSTER_COLORS = [
    "var(--cluster-a)",
    "var(--cluster-b)",
    "var(--cluster-c)",
    "var(--cluster-d)",
    "var(--cluster-e)",
    "var(--cluster-f)",
  ];

  const state = {
    movements: [],
    movementById: new Map(),
    nodes: new Map(),
    positions: new Map(),
    clusters: [],
    clusterByNode: new Map(),
    clusterByMovement: new Map(),
    items: [],
    loaded: 0,
    failed: 0,
    playing: true,
    labels: true,
    selectedId: null,
    activeClusterIndex: -1,
    fitScale: 1,
    zoom: 1,
    panX: 0,
    panY: 0,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
    trackingFrame: null,
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindControls();
    try {
      const response = await fetch("public/data/embedding.json");
      if (!response.ok) throw new Error(`Embedding data returned ${response.status}`);
      const payload = await response.json();
      state.movements = payload.movements;
      state.movementById = new Map(state.movements.map((movement) => [movement.id, movement]));
      state.nodes = new Map(payload.lineage_tree.nodes.map((node) => [node.id, node]));
      computeBranchClusters(payload.lineage_tree, 6);
      renderLegend();
      computePositions(payload.lineage_tree);
      renderTree(payload.lineage_tree);
      renderAvatars(payload.lineage_tree.leaf_order);
      await Promise.all([
        document.fonts?.ready || Promise.resolve(),
        customElements.whenDefined("model-viewer"),
      ]);
      resetView();
      startSkeletonTracking();
      elements.atlas.setAttribute("aria-busy", "false");
      window.setTimeout(() => elements.loadingOverlay.classList.add("is-ready"), 800);
    } catch (error) {
      console.error(error);
      elements.fatalError.hidden = false;
      elements.loadingOverlay.classList.add("is-ready");
    }
  }

  function cacheElements() {
    [
      "circular-atlas", "tree-viewport", "tree-stage", "tree-guides", "tree-branches",
      "tree-nodes", "tree-labels", "leaf-avatars", "loaded-count", "load-status", "play-all",
      "toggle-labels", "refit", "zoom-in", "zoom-out", "zoom-level", "selected-leaf",
      "group-legend", "branch-previous", "branch-next", "branch-all", "branch-status",
      "loading-overlay", "loading-bar", "fatal-error",
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
    elements.atlas = elements.circularAtlas;
  }

  function bindControls() {
    elements.playAll.addEventListener("click", togglePlayback);
    elements.toggleLabels.addEventListener("click", toggleLabels);
    elements.refit.addEventListener("click", resetView);
    elements.zoomIn.addEventListener("click", () => zoomBy(1.25));
    elements.zoomOut.addEventListener("click", () => zoomBy(0.8));
    elements.branchPrevious.addEventListener("click", () => stepBranch(-1));
    elements.branchNext.addEventListener("click", () => stepBranch(1));
    elements.branchAll.addEventListener("click", () => setActiveCluster(-1));
    elements.treeViewport.addEventListener("wheel", handleWheel, { passive: false });
    elements.treeViewport.addEventListener("pointerdown", beginPan);
    elements.treeViewport.addEventListener("pointermove", movePan);
    elements.treeViewport.addEventListener("pointerup", endPan);
    elements.treeViewport.addEventListener("pointercancel", endPan);
    window.addEventListener("resize", resetView);
  }

  function renderLegend() {
    elements.groupLegend.innerHTML = state.clusters.map((cluster) => (
      `<button class="branch-group-button" type="button" data-cluster-index="${state.clusters.indexOf(cluster)}" aria-pressed="false" style="--group-color:${cluster.color}" aria-label="Highlight branch group ${cluster.label}, ${cluster.members.length} dances">${cluster.label} · ${cluster.members.length}</button>`
    )).join("");
    elements.groupLegend.querySelectorAll(".branch-group-button").forEach((button) => {
      button.addEventListener("click", () => {
        const index = Number(button.dataset.clusterIndex);
        setActiveCluster(index === state.activeClusterIndex ? -1 : index);
      });
    });
  }

  function computeBranchClusters(tree, targetCount) {
    state.clusterByNode.clear();
    state.clusterByMovement.clear();
    state.clusters = Array.from({ length: targetCount }, (_, index) => ({
      members: tree.leaf_order.slice(
        Math.floor(index * tree.leaf_order.length / targetCount),
        Math.floor((index + 1) * tree.leaf_order.length / targetCount),
      ),
      label: String.fromCharCode(65 + index),
      color: CLUSTER_COLORS[index % CLUSTER_COLORS.length],
    }));

    state.clusters.forEach((cluster) => {
      cluster.members.forEach((movementId) => state.clusterByMovement.set(movementId, cluster));
    });
    state.nodes.forEach((node) => {
      const memberships = new Set(node.members.map((movementId) => state.clusterByMovement.get(movementId)));
      if (memberships.size === 1) state.clusterByNode.set(node.id, memberships.values().next().value);
    });
    state.clusters.forEach((cluster) => {
      cluster.pathIds = new Set();
      cluster.members.forEach((movementId) => {
        let node = state.nodes.get(`m${movementId}`);
        while (node?.parent) {
          cluster.pathIds.add(node.id);
          node = state.nodes.get(node.parent);
        }
      });
    });
  }

  function computePositions(tree) {
    const orderIndex = new Map(tree.leaf_order.map((id, index) => [id, index]));
    const step = (Math.PI * 2) / tree.leaf_order.length;
    state.nodes.forEach((node) => {
      const indices = node.members.map((id) => orderIndex.get(id));
      const meanIndex = indices.reduce((sum, value) => sum + value, 0) / indices.length;
      const angle = -Math.PI / 2 + meanIndex * step;
      const radius = node.type === "movement"
        ? TREE_RADIUS
        : ROOT_RADIUS + (1 - node.height / tree.max_height) * (TREE_RADIUS - ROOT_RADIUS);
      state.positions.set(node.id, { angle, radius });
    });
  }

  function renderTree(tree) {
    elements.treeGuides.innerHTML = [145, 265, 385, TREE_RADIUS].map((radius, index) => (
      `<circle cx="${CENTER}" cy="${CENTER}" r="${radius}"></circle>${index === 3 ? `<text x="${CENTER + 12}" y="${CENTER - radius - 10}">OBSERVED MOVEMENTS</text>` : ""}`
    )).join("");

    const branchMarkup = [];
    state.nodes.forEach((node) => {
      if (!node.parent) return;
      const parent = state.nodes.get(node.parent);
      const parentPosition = state.positions.get(parent.id);
      const childPosition = state.positions.get(node.id);
      const cluster = state.clusterByNode.get(node.id);
      branchMarkup.push(
        `<path class="tree-branch" data-child="${node.id}" style="--branch-color:${cluster?.color || "var(--trunk)"}" d="${branchPath(parentPosition, childPosition)}"></path>`,
      );
    });
    elements.treeBranches.innerHTML = branchMarkup.join("");

    elements.treeNodes.innerHTML = [...state.nodes.values()]
      .filter((node) => node.type !== "movement" && node.parent)
      .map((node) => {
        const position = state.positions.get(node.id);
        const point = polar(position.radius, position.angle);
        const cluster = state.clusterByNode.get(node.id);
        return `<circle class="tree-node" data-child="${node.id}" cx="${point.x}" cy="${point.y}" r="3.4" style="--branch-color:${cluster?.color || "var(--trunk)"}"></circle>`;
      }).join("");

    elements.treeLabels.innerHTML = tree.leaf_order.map((movementId) => {
      const movement = state.movementById.get(movementId);
      const position = state.positions.get(`m${movementId}`);
      const angleDegrees = position.angle * 180 / Math.PI;
      const normalized = (angleDegrees + 360) % 360;
      const flip = normalized > 90 && normalized < 270;
      const point = polar(LABEL_RADIUS, position.angle);
      const tickStart = polar(TREE_RADIUS + 4, position.angle);
      const tickEnd = polar(LABEL_RADIUS - 9, position.angle);
      const rotation = angleDegrees + (flip ? 180 : 0);
      const textX = flip ? -8 : 8;
      const cluster = state.clusterByMovement.get(movementId);
      return `<line class="leaf-tick" data-movement="${movementId}" style="--branch-color:${cluster.color}" x1="${tickStart.x}" y1="${tickStart.y}" x2="${tickEnd.x}" y2="${tickEnd.y}"></line>
        <text class="leaf-label" data-movement="${movementId}" transform="translate(${point.x} ${point.y}) rotate(${rotation})" text-anchor="${flip ? "end" : "start"}" x="${textX}" y="6">${String(movementId).padStart(2, "0")} · ${escapeHtml(movement.thai)}</text>`;
    }).join("");
  }

  function renderAvatars(leafOrder) {
    const fragment = document.createDocumentFragment();
    leafOrder.forEach((movementId) => {
      const movement = state.movementById.get(movementId);
      const position = state.positions.get(`m${movementId}`);
      const point = polar(AVATAR_RADIUS, position.angle);
      const button = document.createElement("button");
      button.type = "button";
      button.className = `leaf-avatar${movement.quality === "warning" ? " has-warning" : ""}`;
      button.dataset.id = String(movementId).padStart(2, "0");
      button.dataset.clusterIndex = String(state.clusters.indexOf(state.clusterByMovement.get(movementId)));
      button.style.left = `${point.x - AVATAR_WIDTH / 2}px`;
      button.style.top = `${point.y - AVATAR_HEIGHT / 2}px`;
      button.style.setProperty("--avatar-color", state.clusterByMovement.get(movementId).color);
      button.style.zIndex = String(5 + movementId);
      button.title = `${movementId}. ${movement.thai} — ${movement.english}`;
      button.setAttribute("aria-label", `${movementId}. ${movement.thai}, ${movement.english}`);
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        selectMovement(movementId);
      });

      const viewer = document.createElement("model-viewer");
      configureViewer(viewer, movement);
      const item = { movement, button, viewer, lastCenterIndex: -1 };
      viewer.addEventListener("load", () => {
        viewer.timeScale = 3;
        viewer.currentTime = movement.skeleton?.calibration_time_seconds || 0;
        setCalibrationCenter(item);
        viewer.jumpCameraToGoal?.();
        recordLoad(false);
      }, { once: true });
      viewer.addEventListener("error", () => recordLoad(true), { once: true });
      button.appendChild(viewer);
      fragment.appendChild(button);
      state.items.push(item);
    });
    elements.leafAvatars.appendChild(fragment);
  }

  function configureViewer(viewer, movement) {
    viewer.setAttribute("src", movement.glb);
    viewer.setAttribute("animation-name", movement.animation_name);
    viewer.setAttribute("autoplay", "");
    viewer.setAttribute("loading", "eager");
    viewer.setAttribute("reveal", "auto");
    viewer.setAttribute("interaction-prompt", "none");
    viewer.setAttribute("shadow-intensity", "0");
    viewer.setAttribute("tone-mapping", "neutral");
    const skeletonSize = movement.skeleton?.calibration_head_to_hips_distance
      || movement.skeleton?.head_to_hips_distance || 66.2;
    const cameraDistance = skeletonSize * 6.25;
    viewer.setAttribute("camera-orbit", `0deg 82deg ${cameraDistance.toFixed(3)}m`);
    viewer.setAttribute("min-camera-orbit", `auto auto ${cameraDistance.toFixed(3)}m`);
    viewer.setAttribute("max-camera-orbit", `auto auto ${cameraDistance.toFixed(3)}m`);
    viewer.setAttribute("field-of-view", "35deg");
    viewer.setAttribute("min-field-of-view", "35deg");
    viewer.setAttribute("max-field-of-view", "35deg");
    viewer.setAttribute("interpolation-decay", "0");
    const center = movement.skeleton?.calibration_center;
    if (center?.length === 3) viewer.setAttribute("camera-target", `${center[0]}m ${center[1]}m ${center[2]}m`);
    viewer.setAttribute("alt", `${movement.english}, animated Thai dance avatar`);
  }

  function branchPath(parent, child) {
    const start = polar(parent.radius, parent.angle);
    const arcEnd = polar(parent.radius, child.angle);
    const end = polar(child.radius, child.angle);
    if (parent.radius < 0.001) return `M ${CENTER} ${CENTER} L ${end.x} ${end.y}`;
    let delta = child.angle - parent.angle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const largeArc = Math.abs(delta) > Math.PI ? 1 : 0;
    const sweep = delta >= 0 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${parent.radius} ${parent.radius} 0 ${largeArc} ${sweep} ${arcEnd.x} ${arcEnd.y} L ${end.x} ${end.y}`;
  }

  function polar(radius, angle) {
    return {
      x: round(CENTER + Math.cos(angle) * radius),
      y: round(CENTER + Math.sin(angle) * radius),
    };
  }

  function selectMovement(movementId) {
    state.selectedId = movementId;
    const cluster = state.clusterByMovement.get(movementId);
    state.activeClusterIndex = state.clusters.indexOf(cluster);
    updateBranchNavigator();
    updateHighlightState();
    const movement = state.movementById.get(movementId);
    elements.selectedLeaf.innerHTML = `<strong>${String(movementId).padStart(2, "0")} · <span lang="th">${escapeHtml(movement.thai)}</span></strong><span>${escapeHtml(movement.english)} · Branch group ${cluster.label} (${cluster.members.length}) · highlighted to the root</span>`;
  }

  function setActiveCluster(index, { clearMovement = true } = {}) {
    state.activeClusterIndex = index >= 0
      ? ((index % state.clusters.length) + state.clusters.length) % state.clusters.length
      : -1;
    if (clearMovement) state.selectedId = null;
    updateBranchNavigator();
    updateHighlightState();

    const cluster = state.clusters[state.activeClusterIndex];
    elements.selectedLeaf.innerHTML = cluster
      ? `<strong>Branch group ${cluster.label}</strong><span>${cluster.members.length} dances highlighted · use ← and → to move between branches</span>`
      : `<strong>Motion lineage</strong><span>Choose a branch group below, or select an avatar to trace its path.</span>`;
  }

  function stepBranch(direction) {
    const nextIndex = state.activeClusterIndex < 0
      ? (direction > 0 ? 0 : state.clusters.length - 1)
      : (state.activeClusterIndex + direction + state.clusters.length) % state.clusters.length;
    setActiveCluster(nextIndex);
  }

  function updateBranchNavigator() {
    const activeCluster = state.clusters[state.activeClusterIndex];
    elements.groupLegend.querySelectorAll(".branch-group-button").forEach((button) => {
      button.setAttribute("aria-pressed", String(Number(button.dataset.clusterIndex) === state.activeClusterIndex));
    });
    elements.branchAll.setAttribute("aria-pressed", String(!activeCluster));
    elements.branchStatus.textContent = activeCluster
      ? `Group ${activeCluster.label} · ${activeCluster.members.length} dances`
      : "All branches";
  }

  function updateHighlightState() {
    const activeCluster = state.clusters[state.activeClusterIndex] || null;
    const pathIds = new Set();
    let node = state.selectedId == null ? null : state.nodes.get(`m${state.selectedId}`);
    while (node?.parent) {
      pathIds.add(node.id);
      node = state.nodes.get(node.parent);
    }

    document.querySelectorAll(".tree-branch, .tree-node").forEach((segment) => {
      const segmentId = segment.dataset.child;
      const onPath = pathIds.has(segmentId);
      const inActiveGroup = Boolean(activeCluster?.pathIds.has(segmentId));
      const isMuted = activeCluster
        ? Boolean(!inActiveGroup && !onPath)
        : Boolean(state.selectedId != null && !onPath);
      segment.style.setProperty("--highlight-color", activeCluster?.color || "var(--trunk)");
      segment.classList.toggle("is-path", onPath);
      segment.classList.toggle("is-group-active", inActiveGroup);
      segment.classList.remove("is-context");
      segment.classList.toggle("is-muted", isMuted);
    });

    document.querySelectorAll(".leaf-tick, .leaf-label").forEach((leaf) => {
      const leafCluster = state.clusterByMovement.get(Number(leaf.dataset.movement));
      const inActiveGroup = Boolean(activeCluster && leafCluster === activeCluster);
      leaf.classList.toggle("is-group-active", inActiveGroup);
      leaf.classList.toggle("is-muted", Boolean(activeCluster && !inActiveGroup));
    });

    document.querySelectorAll(".leaf-avatar").forEach((button) => {
      const movementId = Number(button.dataset.id);
      const inActiveGroup = Number(button.dataset.clusterIndex) === state.activeClusterIndex;
      button.classList.toggle("is-selected", movementId === state.selectedId);
      button.classList.toggle("is-group-active", Boolean(activeCluster && inActiveGroup));
      button.classList.toggle("is-muted", Boolean(activeCluster && !inActiveGroup));
    });
  }

  function recordLoad(failed) {
    if (failed) state.failed += 1;
    else state.loaded += 1;
    const complete = state.loaded + state.failed;
    elements.loadedCount.textContent = state.loaded;
    elements.loadingBar.style.width = `${(complete / state.movements.length) * 100}%`;
    if (state.failed) {
      elements.loadStatus.classList.add("has-errors");
      elements.loadStatus.title = `${state.failed} GLB preview${state.failed === 1 ? "" : "s"} failed to load`;
    }
  }

  function startSkeletonTracking() {
    if (state.trackingFrame) cancelAnimationFrame(state.trackingFrame);
    const track = () => {
      if (state.playing) state.items.forEach((item) => updateViewerCenter(item));
      state.trackingFrame = requestAnimationFrame(track);
    };
    state.trackingFrame = requestAnimationFrame(track);
  }

  function updateViewerCenter(item, force = false) {
    const centers = item.movement.skeleton?.center_track;
    const duration = item.viewer.duration;
    if (!centers?.length || !Number.isFinite(duration) || duration <= 0) return;
    const progress = ((item.viewer.currentTime % duration) + duration) % duration / duration;
    const index = Math.min(centers.length - 1, Math.round(progress * (centers.length - 1)));
    if (!force && index === item.lastCenterIndex) return;
    item.lastCenterIndex = index;
    const [x, y, z] = centers[index];
    item.viewer.setAttribute("camera-target", `${x}m ${y}m ${z}m`);
    item.viewer.jumpCameraToGoal?.();
  }

  function setCalibrationCenter(item) {
    const center = item.movement.skeleton?.calibration_center;
    const centers = item.movement.skeleton?.center_track;
    const duration = item.viewer.duration;
    if (!center?.length || !centers?.length || !Number.isFinite(duration) || duration <= 0) {
      updateViewerCenter(item, true);
      return;
    }
    const progress = clamp(item.viewer.currentTime / duration, 0, 1);
    item.lastCenterIndex = Math.min(centers.length - 1, Math.round(progress * (centers.length - 1)));
    item.viewer.setAttribute("camera-target", `${center[0]}m ${center[1]}m ${center[2]}m`);
  }

  function togglePlayback() {
    state.playing = !state.playing;
    state.items.forEach(({ viewer }) => {
      viewer.timeScale = 3;
      if (state.playing) viewer.play?.();
      else viewer.pause?.();
    });
    elements.playAll.textContent = state.playing ? "Pause all" : "Play all";
    elements.playAll.setAttribute("aria-pressed", String(state.playing));
  }

  function toggleLabels() {
    state.labels = !state.labels;
    elements.atlas.classList.toggle("labels-hidden", !state.labels);
    elements.toggleLabels.textContent = state.labels ? "Hide names" : "Show names";
    elements.toggleLabels.setAttribute("aria-pressed", String(state.labels));
  }

  function resetView() {
    const width = elements.treeViewport.clientWidth;
    const height = elements.treeViewport.clientHeight;
    const topInset = width < 680 ? 102 : 74;
    state.fitScale = Math.min((width - 20) / SIZE, (height - topInset - 16) / SIZE);
    state.zoom = 1;
    state.panX = width / 2 - CENTER * state.fitScale;
    state.panY = topInset + (height - topInset) / 2 - CENTER * state.fitScale;
    applyTransform();
  }

  function zoomBy(factor, clientX, clientY) {
    const bounds = elements.treeViewport.getBoundingClientRect();
    const focusX = (clientX ?? bounds.left + bounds.width / 2) - bounds.left;
    const focusY = (clientY ?? bounds.top + bounds.height / 2) - bounds.top;
    const nextZoom = clamp(state.zoom * factor, 0.5, 8);
    const ratio = nextZoom / state.zoom;
    state.panX = focusX - (focusX - state.panX) * ratio;
    state.panY = focusY - (focusY - state.panY) * ratio;
    state.zoom = nextZoom;
    applyTransform();
  }

  function handleWheel(event) {
    if (event.target.closest("button, a")) return;
    event.preventDefault();
    zoomBy(Math.exp(-event.deltaY * 0.0015), event.clientX, event.clientY);
  }

  function beginPan(event) {
    if (event.button !== 0 || event.target.closest("button, a")) return;
    state.pointerId = event.pointerId;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    elements.treeViewport.setPointerCapture?.(event.pointerId);
    elements.treeViewport.classList.add("is-panning");
  }

  function movePan(event) {
    if (state.pointerId !== event.pointerId) return;
    state.panX += event.clientX - state.pointerX;
    state.panY += event.clientY - state.pointerY;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    applyTransform();
  }

  function endPan(event) {
    if (state.pointerId !== event.pointerId) return;
    elements.treeViewport.releasePointerCapture?.(event.pointerId);
    elements.treeViewport.classList.remove("is-panning");
    state.pointerId = null;
  }

  function applyTransform() {
    const scale = state.fitScale * state.zoom;
    elements.treeStage.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${scale})`;
    elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function round(value) {
    return Number(value.toFixed(3));
  }

  function toCamel(value) {
    return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
    })[character]);
  }
})();
