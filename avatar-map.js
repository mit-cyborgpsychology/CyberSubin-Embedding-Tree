(() => {
  const GROUP_LABELS = {
    "left-arm": "Left arm & hand",
    "right-arm": "Right arm & hand",
    "left-leg": "Left leg",
    "right-leg": "Right leg",
    torso: "Torso",
    head: "Head",
  };
  const GROUP_SHORT = {
    "left-arm": "L arm",
    "right-arm": "R arm",
    "left-leg": "L leg",
    "right-leg": "R leg",
    torso: "Torso",
    head: "Head",
  };
  const GROUP_COLORS = {
    "left-arm": "var(--left-arm)",
    "right-arm": "var(--right-arm)",
    "left-leg": "var(--left-leg)",
    "right-leg": "var(--right-leg)",
    torso: "var(--torso)",
    head: "var(--head)",
  };

  const state = {
    movements: [],
    items: [],
    loaded: 0,
    failed: 0,
    playing: true,
    labels: true,
    layoutFrame: null,
    trackingFrame: null,
    zoom: 1,
    panX: 0,
    panY: 0,
    pointerId: null,
    pointerX: 0,
    pointerY: 0,
  };

  const elements = {};

  document.addEventListener("DOMContentLoaded", init);

  async function init() {
    cacheElements();
    bindControls();
    renderLegend();
    try {
      const response = await fetch("public/data/embedding.json");
      if (!response.ok) throw new Error(`Embedding data returned ${response.status}`);
      const payload = await response.json();
      state.movements = payload.movements;
      renderAvatars();
      await Promise.all([
        document.fonts?.ready || Promise.resolve(),
        customElements.whenDefined("model-viewer"),
      ]);
      scheduleLayout();
      startSkeletonTracking();
      elements.atlas.setAttribute("aria-busy", "false");
      window.setTimeout(() => elements.loadingOverlay.classList.add("is-ready"), 700);
    } catch (error) {
      console.error(error);
      elements.fatalError.hidden = false;
      elements.loadingOverlay.classList.add("is-ready");
    }
  }

  function cacheElements() {
    [
      "avatar-atlas", "map-surface", "embedding-links", "avatar-layer", "loaded-count",
      "load-status", "play-all", "toggle-labels", "refit", "group-legend",
      "loading-overlay", "loading-bar", "fatal-error", "zoom-in", "zoom-out",
      "zoom-level",
    ].forEach((id) => { elements[toCamel(id)] = document.getElementById(id); });
    elements.atlas = elements.avatarAtlas;
  }

  function bindControls() {
    elements.playAll.addEventListener("click", togglePlayback);
    elements.toggleLabels.addEventListener("click", toggleLabels);
    elements.refit.addEventListener("click", resetView);
    elements.zoomIn.addEventListener("click", () => zoomBy(1.25));
    elements.zoomOut.addEventListener("click", () => zoomBy(0.8));
    elements.mapSurface.addEventListener("wheel", handleWheel, { passive: false });
    elements.mapSurface.addEventListener("pointerdown", beginPan);
    elements.mapSurface.addEventListener("pointermove", movePan);
    elements.mapSurface.addEventListener("pointerup", endPan);
    elements.mapSurface.addEventListener("pointercancel", endPan);
    window.addEventListener("resize", scheduleLayout);
  }

  function renderLegend() {
    elements.groupLegend.innerHTML = Object.entries(GROUP_LABELS).map(([group, label]) => (
      `<span data-short="${GROUP_SHORT[group]}"><i style="--legend-color:${GROUP_COLORS[group]}"></i>${label}</span>`
    )).join("");
  }

  function renderAvatars() {
    const fragment = document.createDocumentFragment();
    state.movements.forEach((movement) => {
      const card = document.createElement("article");
      card.className = `avatar-card${movement.quality === "warning" ? " has-warning" : ""}`;
      card.dataset.id = movement.id;
      card.style.setProperty("--avatar-color", GROUP_COLORS[movement.metrics.dominant_group]);
      card.style.zIndex = String(4 + movement.id);
      card.title = `${movement.id}. ${movement.thai} — ${movement.english}`;

      const viewer = document.createElement("model-viewer");
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
      const calibrationCenter = movement.skeleton?.calibration_center;
      if (calibrationCenter?.length === 3) {
        viewer.setAttribute(
          "camera-target",
          `${calibrationCenter[0]}m ${calibrationCenter[1]}m ${calibrationCenter[2]}m`,
        );
      }
      viewer.setAttribute("alt", `${movement.english}, animated Thai dance avatar`);
      const item = {
        movement, card, viewer, anchorX: 0, anchorY: 0, x: 0, y: 0,
        width: 0, height: 0, viewerHeight: 0, lastCenterIndex: -1,
      };
      viewer.addEventListener("load", () => {
        viewer.timeScale = 3;
        viewer.currentTime = movement.skeleton?.calibration_time_seconds || 0;
        setCalibrationCenter(item);
        viewer.jumpCameraToGoal?.();
        recordLoad(false);
      }, { once: true });
      viewer.addEventListener("error", () => recordLoad(true), { once: true });

      const label = document.createElement("div");
      label.className = "avatar-label";
      label.innerHTML = `<strong>${String(movement.id).padStart(2, "0")}</strong><span lang="th">${escapeHtml(movement.thai)}</span>`;
      card.append(viewer, label);
      fragment.appendChild(card);
      state.items.push(item);
    });
    elements.avatarLayer.appendChild(fragment);
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

  function scheduleLayout() {
    if (!state.items.length) return;
    if (state.layoutFrame) cancelAnimationFrame(state.layoutFrame);
    state.layoutFrame = requestAnimationFrame(layoutAvatars);
  }

  function layoutAvatars() {
    state.layoutFrame = null;
    const width = elements.mapSurface.clientWidth;
    const height = elements.mapSurface.clientHeight;
    const mobile = width < 680;
    const bounds = {
      left: mobile ? 25 : 44,
      right: mobile ? width - 17 : width - 34,
      top: mobile ? 116 : 92,
      bottom: mobile ? height - 40 : height - 47,
    };
    const cardWidth = mobile ? 66 : clamp(width * 0.065, 78, 96);
    const cardHeight = cardWidth / 0.69;
    const labelHeight = mobile ? 24 : 28;
    const viewerHeight = cardHeight - labelHeight;
    elements.avatarLayer.style.setProperty("--card-width", `${cardWidth}px`);
    elements.avatarLayer.style.setProperty("--card-height", `${cardHeight}px`);
    elements.avatarLayer.style.setProperty("--label-height", `${labelHeight}px`);

    state.items.forEach((item) => {
      item.width = cardWidth;
      item.height = cardHeight;
      item.viewerHeight = viewerHeight;
      item.anchorX = bounds.left + item.movement.map.x * (bounds.right - bounds.left);
      item.anchorY = bounds.top + (1 - item.movement.map.y) * (bounds.bottom - bounds.top);
      item.x = item.anchorX;
      item.y = item.anchorY;
    });

    state.items.forEach((item) => {
      item.card.style.left = `${item.x - item.width / 2}px`;
      item.card.style.top = `${item.y - item.viewerHeight / 2}px`;
    });
    drawGuides(width, height);
    applyViewTransform();
  }

  function zoomBy(factor, clientX, clientY) {
    const bounds = elements.mapSurface.getBoundingClientRect();
    const focusX = (clientX ?? bounds.left + bounds.width / 2) - bounds.left;
    const focusY = (clientY ?? bounds.top + bounds.height / 2) - bounds.top;
    const nextZoom = clamp(state.zoom * factor, 0.5, 4);
    const ratio = nextZoom / state.zoom;
    state.panX = focusX - (focusX - state.panX) * ratio;
    state.panY = focusY - (focusY - state.panY) * ratio;
    state.zoom = nextZoom;
    applyViewTransform();
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
    elements.mapSurface.setPointerCapture?.(event.pointerId);
    elements.mapSurface.classList.add("is-panning");
  }

  function movePan(event) {
    if (state.pointerId !== event.pointerId) return;
    state.panX += event.clientX - state.pointerX;
    state.panY += event.clientY - state.pointerY;
    state.pointerX = event.clientX;
    state.pointerY = event.clientY;
    applyViewTransform();
  }

  function endPan(event) {
    if (state.pointerId !== event.pointerId) return;
    elements.mapSurface.releasePointerCapture?.(event.pointerId);
    elements.mapSurface.classList.remove("is-panning");
    state.pointerId = null;
  }

  function resetView() {
    state.zoom = 1;
    state.panX = 0;
    state.panY = 0;
    scheduleLayout();
  }

  function applyViewTransform() {
    const transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
    elements.embeddingLinks.style.transform = transform;
    elements.avatarLayer.style.transform = transform;
    elements.zoomLevel.textContent = `${Math.round(state.zoom * 100)}%`;
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
    const centerIndex = Math.min(centers.length - 1, Math.round(progress * (centers.length - 1)));
    if (!force && centerIndex === item.lastCenterIndex) return;
    item.lastCenterIndex = centerIndex;
    const [x, y, z] = centers[centerIndex];
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
    item.lastCenterIndex = Math.min(
      centers.length - 1,
      Math.round(progress * (centers.length - 1)),
    );
    item.viewer.setAttribute("camera-target", `${center[0]}m ${center[1]}m ${center[2]}m`);
  }

  function drawGuides(width, height) {
    elements.embeddingLinks.setAttribute("viewBox", `0 0 ${width} ${height}`);
    elements.embeddingLinks.innerHTML = state.items.map((item) => {
      const color = GROUP_COLORS[item.movement.metrics.dominant_group];
      return `<circle class="embedding-anchor" style="--guide-color:${color}" cx="${item.anchorX.toFixed(2)}" cy="${item.anchorY.toFixed(2)}" r="2.8" />`;
    }).join("");
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
    window.setTimeout(scheduleLayout, 20);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
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
