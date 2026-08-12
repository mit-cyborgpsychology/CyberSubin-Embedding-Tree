const SVG_NS = "http://www.w3.org/2000/svg";
const PLAYBACK_SPEED = 3;
const EMBEDDING_SPREAD_2D = 1.1;
const AVATAR_COLOR = "#ff8066";

const ELEMENTS = [
  {
    id: "energy",
    label: "ENERGY",
    panelLabel: "Energy",
    field: "avg_energy_percentage",
    color: "#65f3ff",
    anchor: [0.46, 0.09],
  },
  {
    id: "curves",
    label: "CIRCLES + CURVES",
    panelLabel: "Circles + curves",
    field: "avg_circles_curves_percentage",
    color: "#fb5c50",
    anchor: [0.87, 0.25],
  },
  {
    id: "axes",
    label: "AXIS POINTS",
    panelLabel: "Axis points",
    field: "avg_axis_points_percentage",
    color: "#ffcc66",
    anchor: [0.84, 0.75],
  },
  {
    id: "synchrony",
    label: "SYNCHRONOUS LIMBS",
    panelLabel: "Synchronous limbs",
    field: "avg_synchronous_limbs_percentage",
    color: "#b7ff63",
    anchor: [0.55, 0.91],
  },
  {
    id: "space",
    label: "EXTERNAL BODY SPACES",
    panelLabel: "External body spaces",
    field: "avg_external_body_spaces_percentage",
    color: "#a98bff",
    anchor: [0.13, 0.72],
  },
  {
    id: "relations",
    label: "SHIFTING RELATIONS",
    panelLabel: "Shifting relations",
    field: "avg_shifting_relations_percentage",
    color: "#ff6fae",
    anchor: [0.11, 0.24],
  },
];

const state = {
  movements: [],
  rows: [],
  rowById: new Map(),
  items: [],
  links: [],
  elementItems: [],
  playing: true,
  linksVisible: true,
  curvedLinks: true,
  avatarSize: 1,
  avatarSpread: 1,
  selected: null,
  settledModels: 0,
  loadedModels: 0,
  lastTrackTime: 0,
  elementExtents: new Map(),
};

const ui = {
  root: document.getElementById("element-embedding"),
  stage: document.getElementById("embedding-stage"),
  svg: document.getElementById("network"),
  connections: document.getElementById("connections"),
  elementNodes: document.getElementById("element-nodes"),
  avatarLayer: document.getElementById("avatar-layer"),
  selectionPanel: document.getElementById("selection-panel"),
  loading: document.getElementById("loading-state"),
  loadingLabel: document.getElementById("loading-label"),
  error: document.getElementById("error-state"),
  errorMessage: document.getElementById("error-message"),
  animationButton: document.getElementById("toggle-animation"),
  linksButton: document.getElementById("toggle-links"),
  lineStyleButton: document.getElementById("toggle-line-style"),
  avatarSizeSlider: document.getElementById("embedding-avatar-size"),
  avatarSizeValue: document.getElementById("embedding-avatar-size-value"),
  avatarSpreadSlider: document.getElementById("embedding-avatar-spread"),
  avatarSpreadValue: document.getElementById("embedding-avatar-spread-value"),
};

init();

async function init() {
  bindGlobalControls();

  try {
    const [embeddingResponse, csvResponse] = await Promise.all([
      fetch("/public/data/embedding.json"),
      fetch("/public/data/no60-element-analysis-1-59.csv"),
      customElements.whenDefined("model-viewer"),
    ]);

    if (!embeddingResponse.ok) {
      throw new Error(`Embedding data returned ${embeddingResponse.status}`);
    }
    if (!csvResponse.ok) {
      throw new Error(`Element analysis returned ${csvResponse.status}`);
    }

    const [embedding, csvText] = await Promise.all([
      embeddingResponse.json(),
      csvResponse.text(),
    ]);

    state.movements = embedding.movements || [];
    state.rows = parseCsv(csvText).map(normalizeAnalysisRow);
    state.rowById = new Map(state.rows.map((row) => [row.pose_number, row]));

    validateData();
    renderAvatarNodes();
    renderNetworkStructure();
    layoutNetwork();
    startSkeletonTracking();
    ui.avatarSizeSlider.disabled = false;
    ui.avatarSpreadSlider.disabled = false;

    const resizeObserver = new ResizeObserver(layoutNetwork);
    resizeObserver.observe(ui.stage);

    ui.root.setAttribute("aria-busy", "false");
    window.setTimeout(revealMap, 2200);
  } catch (error) {
    console.error(error);
    ui.loading.classList.add("is-ready");
    ui.error.hidden = false;
    ui.errorMessage.textContent = error.message;
    ui.root.setAttribute("aria-busy", "false");
  }
}

function bindGlobalControls() {
  ui.animationButton.addEventListener("click", () => {
    state.playing = !state.playing;
    state.items.forEach(({ viewer }) => {
      viewer.timeScale = PLAYBACK_SPEED;
      if (state.playing) viewer.play?.();
      else viewer.pause?.();
    });
    ui.animationButton.textContent = state.playing ? "PAUSE ALL" : "PLAY ALL";
    ui.animationButton.setAttribute("aria-pressed", String(state.playing));
  });

  ui.linksButton.addEventListener("click", () => {
    state.linksVisible = !state.linksVisible;
    ui.stage.classList.toggle("links-hidden", !state.linksVisible);
    ui.linksButton.textContent = state.linksVisible ? "HIDE LINKS" : "SHOW LINKS";
    ui.linksButton.setAttribute("aria-pressed", String(state.linksVisible));
  });

  ui.lineStyleButton.addEventListener("click", () => {
    state.curvedLinks = !state.curvedLinks;
    ui.lineStyleButton.textContent = state.curvedLinks ? "CURVED LINES" : "STRAIGHT LINES";
    ui.lineStyleButton.setAttribute("aria-pressed", String(state.curvedLinks));
    ui.stage.dataset.lineStyle = state.curvedLinks ? "curved" : "straight";
    layoutNetwork();
  });

  ui.avatarSizeSlider.addEventListener("input", () => {
    state.avatarSize = Number(ui.avatarSizeSlider.value) / 100;
    ui.avatarSizeValue.value = `${ui.avatarSizeSlider.value}%`;
    ui.stage.style.setProperty("--avatar-size", state.avatarSize.toFixed(2));
    ui.stage.dataset.avatarScale = state.avatarSize.toFixed(2);
    layoutNetwork();
  });

  ui.avatarSpreadSlider.addEventListener("input", () => {
    state.avatarSpread = Number(ui.avatarSpreadSlider.value) / 100;
    ui.avatarSpreadValue.value = `${ui.avatarSpreadSlider.value}%`;
    ui.stage.dataset.avatarSpread = state.avatarSpread.toFixed(2);
    layoutNetwork();
  });

  ui.stage.addEventListener("click", (event) => {
    if (event.target.closest(".dance-node, .element-node")) return;
    state.selected = null;
    clearFocus();
  });
}

function validateData() {
  if (state.movements.length !== 59) {
    throw new Error(`Expected 59 embedded movements, found ${state.movements.length}`);
  }
  if (state.rows.length !== 59) {
    throw new Error(`Expected 59 element-analysis rows, found ${state.rows.length}`);
  }

  const missing = state.movements
    .map((movement) => movement.id)
    .filter((id) => !state.rowById.has(id));
  if (missing.length) {
    throw new Error(`Element analysis is missing movement ${missing.join(", ")}`);
  }

  state.rows.forEach((row) => {
    ELEMENTS.forEach((element) => {
      if (!Number.isFinite(row[element.field])) {
        throw new Error(`Movement ${row.pose_number} has no value for ${element.field}`);
      }
    });
  });

  state.elementExtents = new Map(ELEMENTS.map((element) => {
    const values = state.rows.map((row) => row[element.field]);
    return [element.id, [Math.min(...values), Math.max(...values)]];
  }));
}

function renderAvatarNodes() {
  const fragment = document.createDocumentFragment();

  state.movements.forEach((movement) => {
    const row = state.rowById.get(movement.id);
    const dominant = dominantElement(row);
    const node = document.createElement("button");
    node.type = "button";
    node.className = "dance-node";
    node.dataset.movementId = String(movement.id);
    node.setAttribute(
      "aria-label",
      `Movement ${movement.id}: ${movement.thai}, ${movement.english}`,
    );
    node.title = `${String(movement.id).padStart(2, "0")} · ${movement.thai} — ${movement.english}`;
    node.style.zIndex = String(100 + movement.id);
    node.style.setProperty("--dominant-color", AVATAR_COLOR);
    node.dataset.dominantElement = dominant.id;

    const viewer = document.createElement("model-viewer");
    viewer.setAttribute("src", toRootPath(movement.glb));
    viewer.setAttribute("animation-name", movement.animation_name);
    viewer.setAttribute("autoplay", "");
    viewer.setAttribute("loading", "eager");
    viewer.setAttribute("reveal", "auto");
    viewer.setAttribute("interaction-prompt", "none");
    viewer.setAttribute("shadow-intensity", "0");
    viewer.setAttribute("tone-mapping", "neutral");
    viewer.setAttribute("alt", `${movement.english}, animated Thai dance movement`);
    viewer.setAttribute("interpolation-decay", "0");

    const skeletonSize = movement.skeleton?.calibration_head_to_hips_distance
      || movement.skeleton?.head_to_hips_distance
      || 66.2;
    const cameraDistance = skeletonSize * 6.25;
    viewer.setAttribute("camera-orbit", `0deg 82deg ${cameraDistance.toFixed(3)}m`);
    viewer.setAttribute("min-camera-orbit", `auto auto ${cameraDistance.toFixed(3)}m`);
    viewer.setAttribute("max-camera-orbit", `auto auto ${cameraDistance.toFixed(3)}m`);
    viewer.setAttribute("field-of-view", "35deg");
    viewer.setAttribute("min-field-of-view", "35deg");
    viewer.setAttribute("max-field-of-view", "35deg");

    const calibrationCenter = movement.skeleton?.calibration_center;
    if (calibrationCenter?.length === 3) {
      viewer.setAttribute("camera-target", vectorToTarget(calibrationCenter));
    }

    const name = document.createElement("span");
    name.className = "dance-node__name";
    name.textContent = movement.thai;
    name.lang = "th";
    name.title = movement.english;
    node.append(viewer, name);

    const item = {
      movement,
      row,
      dominant,
      node,
      viewer,
      x: 0,
      y: 0,
      loaded: false,
      lastCenterIndex: -1,
    };

    viewer.addEventListener("load", () => {
      item.loaded = true;
      viewer.timeScale = PLAYBACK_SPEED;
      viewer.currentTime = movement.skeleton?.calibration_time_seconds || 0;
      recolorModelViewer(viewer);
      setCalibrationCenter(item);
      viewer.jumpCameraToGoal?.();
      if (state.playing) viewer.play?.();
      recordModelSettled(false);
    }, { once: true });
    viewer.addEventListener("error", () => recordModelSettled(true), { once: true });

    bindFocusInteractions(
      node,
      { kind: "movement", id: movement.id },
      () => showMovementFocus(movement.id),
    );

    fragment.appendChild(node);
    state.items.push(item);
  });

  ui.avatarLayer.appendChild(fragment);
  ui.stage.dataset.dominantCounts = JSON.stringify(dominantElementCounts(state.items));
  ui.stage.dataset.avatarColor = AVATAR_COLOR;
  ui.stage.dataset.avatarScale = state.avatarSize.toFixed(2);
  ui.stage.dataset.avatarSpread = state.avatarSpread.toFixed(2);
}

function renderNetworkStructure() {
  const elementFragment = document.createDocumentFragment();

  ELEMENTS.forEach((element, index) => {
    const group = svgElement("g", "element-node");
    group.dataset.elementId = element.id;
    group.style.setProperty("--element-color", element.color);
    group.setAttribute("role", "button");
    group.setAttribute("tabindex", "0");
    group.setAttribute("aria-label", `${element.panelLabel} element`);

    const hitArea = svgElement("rect", "element-node__hit");
    hitArea.setAttribute("x", "-78");
    hitArea.setAttribute("y", "-23");
    hitArea.setAttribute("width", "156");
    hitArea.setAttribute("height", "46");
    const label = svgElement("text", "element-node__label");
    label.dataset.elementLabel = element.id;
    setMultilineLabel(label, element.label);

    group.append(hitArea, label);
    elementFragment.appendChild(group);

    const item = { element, index, group, label, x: 0, y: 0 };
    state.elementItems.push(item);
    bindFocusInteractions(
      group,
      { kind: "element", id: element.id },
      () => showElementFocus(element.id),
    );
  });

  ui.elementNodes.appendChild(elementFragment);

  const linkFragment = document.createDocumentFragment();
  state.items.forEach((item) => {
    ELEMENTS.forEach((element, elementIndex) => {
      const value = item.row[element.field];
      const normalized = normalizedElementValue(value, element.id);
      const path = svgElement("path", "element-link");
      path.dataset.movementId = String(item.movement.id);
      path.dataset.elementId = element.id;
      path.dataset.value = value.toFixed(3);
      path.dataset.normalized = normalized.toFixed(4);
      path.style.setProperty("--element-color", element.color);
      path.style.setProperty("--weight", `${lineWidth(value, element.id).toFixed(2)}px`);
      path.style.setProperty("--link-opacity", lineOpacity(value, element.id).toFixed(3));
      path.setAttribute("aria-hidden", "true");
      linkFragment.appendChild(path);
      state.links.push({
        path,
        movementId: item.movement.id,
        elementId: element.id,
        elementIndex,
        value,
      });
    });
  });
  ui.connections.appendChild(linkFragment);
}

function bindFocusInteractions(target, descriptor, renderFocus) {
  const enter = () => renderFocus();
  const leave = () => restorePersistentFocus();

  target.addEventListener("pointerenter", enter);
  target.addEventListener("pointerleave", leave);
  target.addEventListener("focus", enter);
  target.addEventListener("blur", leave);
  target.addEventListener("click", (event) => {
    event.stopPropagation();
    const alreadySelected = state.selected
      && state.selected.kind === descriptor.kind
      && state.selected.id === descriptor.id;
    state.selected = alreadySelected ? null : descriptor;
    if (state.selected) renderFocus();
    else clearFocus();
  });
  target.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function layoutNetwork() {
  if (!state.items.length || !state.elementItems.length) return;

  const { width, height } = ui.stage.getBoundingClientRect();
  if (!width || !height) return;

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const avatarMargin = (width < 700 ? 30 : 45) * state.avatarSize;
  const halfCloudWidth = Math.min(
    Math.max(120, Math.min(width * 0.31, height * 0.59) * EMBEDDING_SPREAD_2D * state.avatarSpread),
    width * 0.5 - avatarMargin,
  );
  const halfCloudHeight = Math.min(
    Math.max(110, Math.min(height * 0.35, width * 0.34) * EMBEDDING_SPREAD_2D * state.avatarSpread),
    height * 0.5 - avatarMargin,
  );

  ui.svg.setAttribute("viewBox", `0 0 ${width} ${height}`);

  const embeddingVectors = state.items.map(({ movement }) => {
    const x = movement.map.x - 0.5;
    const y = (1 - movement.map.y) - 0.5;
    const phaseX = organicNoise(movement.id * 37 + 11);
    const phaseY = organicNoise(movement.id * 53 + 29);
    return {
      x: x
        + Math.sin((y + 0.5) * Math.PI * 2.25 + phaseX * Math.PI) * 0.085
        + (phaseX - 0.5) * 0.035,
      y: y
        + Math.sin((x + 0.5) * Math.PI * 2.65 - phaseY * Math.PI) * 0.065
        + (phaseY - 0.5) * 0.035,
    };
  });
  const xExtent = extent(embeddingVectors.map(({ x }) => x));
  const yExtent = extent(embeddingVectors.map(({ y }) => y));

  state.items.forEach((item, index) => {
    const vector = embeddingVectors[index];
    const x = remap(vector.x, xExtent[0], xExtent[1], -1, 1);
    const y = remap(vector.y, yExtent[0], yExtent[1], -1, 1);
    item.x = centerX + x * halfCloudWidth;
    item.y = centerY + y * halfCloudHeight;
    item.node.style.left = `${item.x}px`;
    item.node.style.top = `${item.y}px`;
  });

  state.elementItems.forEach((item) => {
    const [anchorX, anchorY] = item.element.anchor;
    const labelMarginX = width < 700 ? 65 : 92;
    const labelMarginY = 30;
    item.x = clamp(width * anchorX, labelMarginX, width - labelMarginX);
    item.y = clamp(height * anchorY, labelMarginY, height - labelMarginY);
    item.group.setAttribute("transform", `translate(${item.x.toFixed(2)} ${item.y.toFixed(2)})`);
    positionCenteredLabel(item.label);
  });

  state.links.forEach((link) => {
    const movement = state.items.find((item) => item.movement.id === link.movementId);
    const element = state.elementItems.find((item) => item.element.id === link.elementId);
    if (!movement || !element) return;

    if (!state.curvedLinks) {
      link.path.setAttribute(
        "d",
        `M ${movement.x.toFixed(2)} ${movement.y.toFixed(2)} L ${element.x.toFixed(2)} ${element.y.toFixed(2)}`,
      );
      return;
    }

    const dx = element.x - movement.x;
    const dy = element.y - movement.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const perpendicularX = -dy / distance;
    const perpendicularY = dx / distance;
    const seed = organicNoise(link.movementId * 71 + link.elementIndex * 149 + 17);
    const direction = seed > 0.42 ? 1 : -1;
    const bend = distance * (0.11 + seed * 0.11) * direction;
    const controlOneX = movement.x + dx * 0.25 + perpendicularX * bend;
    const controlOneY = movement.y + dy * 0.25 + perpendicularY * bend;
    const controlTwoX = movement.x + dx * 0.68 + perpendicularX * bend * 0.62;
    const controlTwoY = movement.y + dy * 0.68 + perpendicularY * bend * 0.62;
    link.path.setAttribute(
      "d",
      `M ${movement.x.toFixed(2)} ${movement.y.toFixed(2)} C ${controlOneX.toFixed(2)} ${controlOneY.toFixed(2)} ${controlTwoX.toFixed(2)} ${controlTwoY.toFixed(2)} ${element.x.toFixed(2)} ${element.y.toFixed(2)}`,
    );
  });
}

function showMovementFocus(movementId) {
  clearActiveClasses();
  ui.stage.dataset.focusKind = "movement";
  const item = state.items.find((candidate) => candidate.movement.id === movementId);
  if (!item) return;
  item.node.classList.add("is-active");
  state.links
    .filter((link) => link.movementId === movementId)
    .forEach((link) => link.path.classList.add("is-active"));
  renderMovementPanel(item);
}

function showElementFocus(elementId) {
  clearActiveClasses();
  ui.stage.dataset.focusKind = "element";
  const item = state.elementItems.find((candidate) => candidate.element.id === elementId);
  if (!item) return;
  item.group.classList.add("is-active");
  state.links
    .filter((link) => link.elementId === elementId)
    .forEach((link) => link.path.classList.add("is-active"));
  renderElementPanel(item.element);
}

function restorePersistentFocus() {
  if (!state.selected) {
    clearFocus();
    return;
  }
  if (state.selected.kind === "movement") showMovementFocus(state.selected.id);
  else showElementFocus(state.selected.id);
}

function clearFocus() {
  clearActiveClasses();
  delete ui.stage.dataset.focusKind;
  ui.selectionPanel.style.removeProperty("--panel-accent");
  ui.selectionPanel.innerHTML = `
    <span class="selection-panel__eyebrow">MOVEMENT EMBEDDING</span>
    <strong>HOVER A DANCE OR ELEMENT</strong>
    <p>Each color is normalized within its element to reveal variation.</p>
  `;
}

function clearActiveClasses() {
  ui.stage.querySelectorAll(".is-active").forEach((node) => node.classList.remove("is-active"));
}

function renderMovementPanel(item) {
  ui.selectionPanel.style.setProperty("--panel-accent", "#ffffff");
  const metrics = ELEMENTS.map((element) => `
    <span class="selection-panel__metric" style="--metric-color:${element.color}">
      ${escapeHtml(shortElementLabel(element))}<b>${item.row[element.field].toFixed(1)}%</b>
    </span>
  `).join("");
  ui.selectionPanel.innerHTML = `
    <span class="selection-panel__eyebrow">MOVEMENT ${String(item.movement.id).padStart(2, "0")} · DOMINANT ${escapeHtml(item.dominant.label)}</span>
    <strong><span lang="th">${escapeHtml(item.movement.thai)}</span> · ${escapeHtml(item.movement.english)}</strong>
    <div class="selection-panel__metrics">${metrics}</div>
  `;
}

function renderElementPanel(element) {
  const values = state.rows.map((row) => row[element.field]);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  ui.selectionPanel.style.setProperty("--panel-accent", element.color);
  ui.selectionPanel.innerHTML = `
    <span class="selection-panel__eyebrow">ELEMENT CONNECTIONS</span>
    <strong>${escapeHtml(element.label)}</strong>
    <p>Across 59 movements · minimum ${minimum.toFixed(1)}% · mean ${mean.toFixed(1)}% · maximum ${maximum.toFixed(1)}% · thickness normalized within this element</p>
  `;
}

function recordModelSettled(failed) {
  state.settledModels += 1;
  if (!failed) state.loadedModels += 1;
  ui.loadingLabel.textContent = `LOADING ${state.loadedModels} / ${state.movements.length} AVATARS`;
  if (state.settledModels === state.movements.length || state.loadedModels >= 10) {
    revealMap();
  }
}

function revealMap() {
  ui.loading.classList.add("is-ready");
}

function startSkeletonTracking() {
  const track = (timestamp) => {
    if (state.playing && timestamp - state.lastTrackTime >= 140) {
      state.items.forEach(updateViewerCenter);
      state.lastTrackTime = timestamp;
    }
    requestAnimationFrame(track);
  };
  requestAnimationFrame(track);
}

function updateViewerCenter(item) {
  if (!item.loaded) return;
  const centers = item.movement.skeleton?.center_track;
  const duration = item.viewer.duration;
  if (!centers?.length || !Number.isFinite(duration) || duration <= 0) return;
  const progress = (((item.viewer.currentTime % duration) + duration) % duration) / duration;
  const centerIndex = Math.min(centers.length - 1, Math.round(progress * (centers.length - 1)));
  if (centerIndex === item.lastCenterIndex) return;
  item.lastCenterIndex = centerIndex;
  item.viewer.setAttribute("camera-target", vectorToTarget(centers[centerIndex]));
  item.viewer.jumpCameraToGoal?.();
}

function setCalibrationCenter(item) {
  const center = item.movement.skeleton?.calibration_center;
  const centers = item.movement.skeleton?.center_track;
  const duration = item.viewer.duration;
  if (!center?.length) return;
  item.viewer.setAttribute("camera-target", vectorToTarget(center));
  if (!centers?.length || !Number.isFinite(duration) || duration <= 0) return;
  const progress = clamp(item.viewer.currentTime / duration, 0, 1);
  item.lastCenterIndex = Math.min(centers.length - 1, Math.round(progress * (centers.length - 1)));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      cell = "";
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
    } else {
      cell += character;
    }
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((record) => Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])));
}

function normalizeAnalysisRow(row) {
  const normalized = { ...row, pose_number: Number(row.pose_number) };
  ELEMENTS.forEach((element) => {
    normalized[element.field] = Number(row[element.field]);
  });
  return normalized;
}

function setMultilineLabel(label, text) {
  const words = text.split(" ");
  const lines = text.length > 15
    ? [words.slice(0, Math.ceil(words.length / 2)).join(" "), words.slice(Math.ceil(words.length / 2)).join(" ")]
    : [text];
  label.replaceChildren(...lines.map((line) => {
    const tspan = svgElement("tspan");
    tspan.textContent = line;
    tspan.setAttribute("x", "0");
    return tspan;
  }));
}

function positionCenteredLabel(label) {
  const tspans = [...label.querySelectorAll("tspan")];
  tspans.forEach((tspan, index) => {
    tspan.setAttribute("x", "0");
    tspan.setAttribute("y", ((index - (tspans.length - 1) / 2) * 14).toFixed(2));
  });
  label.setAttribute("x", "0");
  label.setAttribute("y", "0");
  label.style.textAnchor = "middle";
}

function svgElement(tag, className = "") {
  const node = document.createElementNS(SVG_NS, tag);
  if (className) node.setAttribute("class", className);
  return node;
}

function extent(values) {
  return [Math.min(...values), Math.max(...values)];
}

function remap(value, sourceMinimum, sourceMaximum, targetMinimum, targetMaximum) {
  const normalized = (value - sourceMinimum) / Math.max(sourceMaximum - sourceMinimum, 0.001);
  return targetMinimum + normalized * (targetMaximum - targetMinimum);
}

function organicNoise(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function normalizedElementValue(value, elementId) {
  const [minimum, maximum] = state.elementExtents.get(elementId) || [0, 100];
  return clamp((value - minimum) / Math.max(maximum - minimum, 0.001), 0, 1);
}

function lineWidth(value, elementId) {
  return 0.18 + Math.pow(normalizedElementValue(value, elementId), 1.55) * 7.2;
}

function lineOpacity(value, elementId) {
  return 0.045 + Math.pow(normalizedElementValue(value, elementId), 1.15) * 0.22;
}

function dominantElement(row) {
  return ELEMENTS.reduce((dominant, element) => (
    row[element.field] > row[dominant.field] ? element : dominant
  ), ELEMENTS[0]);
}

function dominantElementCounts(items) {
  return Object.fromEntries(ELEMENTS.map((element) => [
    element.id,
    items.filter((item) => item.dominant.id === element.id).length,
  ]));
}

function recolorModelViewer(viewer) {
  const materials = viewer.model?.materials || [];
  const color = hexToRgba(AVATAR_COLOR);
  let applied = 0;
  materials.forEach((material) => {
    try {
      material.pbrMetallicRoughness.setBaseColorFactor(color);
      applied += 1;
    } catch (error) {
      console.warn(`Could not recolor ${material.name || "model material"}`, error);
    }
  });
  viewer.dataset.avatarColor = AVATAR_COLOR;
  viewer.dataset.recoloredMaterials = String(applied);
}

function hexToRgba(hex) {
  const value = Number.parseInt(hex.replace("#", ""), 16);
  return [
    ((value >> 16) & 255) / 255,
    ((value >> 8) & 255) / 255,
    (value & 255) / 255,
    1,
  ];
}

function shortElementLabel(element) {
  return ({
    energy: "ENERGY",
    curves: "CURVES",
    axes: "AXIS",
    synchrony: "SYNC",
    space: "SPACE",
    relations: "RELATIONS",
  })[element.id];
}

function vectorToTarget(vector) {
  return `${vector[0]}m ${vector[1]}m ${vector[2]}m`;
}

function toRootPath(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}
