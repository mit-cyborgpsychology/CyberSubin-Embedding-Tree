import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const PLAYBACK_SPEED = 3;
const TARGET_HEAD_TO_HIPS = 0.45;
const MODEL_WORKERS = 6;
const EMBEDDING_SPREAD = 1.55;

const ELEMENTS = [
  { id: "energy", label: "ENERGY", field: "avg_energy_percentage", color: "#65f3ff", anchor: [-1.4, 5.1, -2.9] },
  { id: "curves", label: "CIRCLES + CURVES", field: "avg_circles_curves_percentage", color: "#fb5c50", anchor: [6.2, 2.3, 1.2] },
  { id: "axes", label: "AXIS POINTS", field: "avg_axis_points_percentage", color: "#ffcc66", anchor: [4.1, -3.35, 3.6] },
  { id: "synchrony", label: "SYNCHRONOUS LIMBS", field: "avg_synchronous_limbs_percentage", color: "#b7ff63", anchor: [-0.6, -4.9, -2.4] },
  { id: "space", label: "EXTERNAL BODY SPACES", field: "avg_external_body_spaces_percentage", color: "#a98bff", anchor: [-5.9, -2.2, 2.6] },
  { id: "relations", label: "SHIFTING RELATIONS", field: "avg_shifting_relations_percentage", color: "#ff6fae", anchor: [-5.3, 3.2, -3.5] },
];

const state = {
  movements: [],
  rows: [],
  rowById: new Map(),
  movementItems: [],
  movementPositions: [],
  elementItems: [],
  connectionItems: [],
  elementExtents: new Map(),
  loaded: 0,
  failed: 0,
  playing: true,
  linksVisible: true,
  curvedLinks: true,
  sceneReady: false,
};

const ui = {
  root: document.getElementById("element-space"),
  stage: document.getElementById("space-stage"),
  canvas: document.getElementById("space-canvas"),
  movementLabels: document.getElementById("space-movement-labels"),
  elementLabels: document.getElementById("space-element-labels"),
  loadedCount: document.getElementById("space-loaded-count"),
  loading: document.getElementById("space-loading"),
  loadingDetail: document.getElementById("space-loading-detail"),
  error: document.getElementById("space-error"),
  errorMessage: document.getElementById("space-error-message"),
  animationButton: document.getElementById("space-toggle-animation"),
  linksButton: document.getElementById("space-toggle-links"),
  lineStyleButton: document.getElementById("space-line-style"),
  autoRotateButton: document.getElementById("space-auto-rotate"),
  resetButton: document.getElementById("space-reset-view"),
};

let renderer;
let scene;
let camera;
let controls;
let linksGroup;
let avatarsGroup;
let elementsGroup;
let gltfLoader;
let dracoLoader;
let animationFrame;
let resizeObserver;
const clock = new THREE.Clock();
const projectionVector = new THREE.Vector3();
const cameraDirection = new THREE.Vector3();

init();

async function init() {
  try {
    setupScene();
    bindControls();
    startRendering();

    const [embeddingResponse, csvResponse] = await Promise.all([
      fetch("/public/data/embedding.json"),
      fetch("/public/data/no60-element-analysis-1-59.csv"),
    ]);

    if (!embeddingResponse.ok) throw new Error(`Embedding data returned ${embeddingResponse.status}`);
    if (!csvResponse.ok) throw new Error(`Element analysis returned ${csvResponse.status}`);

    const [embeddingPayload, csvText] = await Promise.all([
      embeddingResponse.json(),
      csvResponse.text(),
    ]);

    state.movements = embeddingPayload.movements || [];
    state.rows = parseCsv(csvText).map(normalizeAnalysisRow);
    state.rowById = new Map(state.rows.map((row) => [row.pose_number, row]));
    validateData();

    const movementPositions = projectEmbeddingTo3D(state.movements.map((movement) => movement.embedding));
    state.movementPositions = movementPositions;
    createMovementLabels(movementPositions);
    createElementNodes();
    createConnections(movementPositions);
    createSpatialParticles();
    state.sceneReady = true;
    ui.loadingDetail.textContent = "LOADING 59 ANIMATED GLB MODELS";

    await loadAllMovements(movementPositions);
    ui.root.setAttribute("aria-busy", "false");
    revealScene();

    if (!state.loaded) {
      throw new Error("None of the 59 GLB movement models could be loaded.");
    }
  } catch (error) {
    console.error(error);
    ui.loading.classList.add("is-ready");
    ui.error.hidden = false;
    ui.errorMessage.textContent = error.message || String(error);
    ui.root.setAttribute("aria-busy", "false");
  }
}

function setupScene() {
  renderer = new THREE.WebGLRenderer({
    canvas: ui.canvas,
    alpha: true,
    antialias: true,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.34;

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x020304, 0.018);

  camera = new THREE.PerspectiveCamera(42, 1, 0.05, 100);
  camera.position.set(10.8, 7.2, 12.8);

  controls = new OrbitControls(camera, ui.canvas);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.rotateSpeed = 0.62;
  controls.zoomSpeed = 0.82;
  controls.panSpeed = 0.55;
  controls.minDistance = 5.5;
  controls.maxDistance = 34;
  controls.autoRotate = false;
  controls.autoRotateSpeed = 0.55;
  controls.update();

  linksGroup = new THREE.Group();
  linksGroup.name = "weighted-element-connections";
  avatarsGroup = new THREE.Group();
  avatarsGroup.name = "animated-movement-avatars";
  elementsGroup = new THREE.Group();
  elementsGroup.name = "element-nodes";
  scene.add(linksGroup, avatarsGroup, elementsGroup);

  scene.add(
    new THREE.HemisphereLight(0xe5f2ff, 0x34231f, 2.55),
    new THREE.AmbientLight(0xffffff, 1.05),
  );
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.85);
  keyLight.position.set(8, 10, 9);
  const leftFill = new THREE.DirectionalLight(0xffb09a, 2.05);
  leftFill.position.set(-10, 4, 6);
  const rightFill = new THREE.DirectionalLight(0xb8dcff, 1.9);
  rightFill.position.set(9, 1, -5);
  const rearFill = new THREE.DirectionalLight(0xe7efff, 2.2);
  rearFill.position.set(-2, 6, -11);
  const lowerFill = new THREE.DirectionalLight(0xffd8c2, 1.25);
  lowerFill.position.set(1, -9, 3);
  scene.add(keyLight, leftFill, rightFill, rearFill, lowerFill);

  dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/vendor/three/examples/jsm/libs/draco/");
  dracoLoader.setWorkerLimit(4);
  gltfLoader = new GLTFLoader();
  gltfLoader.setDRACOLoader(dracoLoader);

  resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(ui.stage);
  resizeRenderer();
}

function bindControls() {
  ui.animationButton.addEventListener("click", () => {
    state.playing = !state.playing;
    ui.animationButton.textContent = state.playing ? "PAUSE ALL" : "PLAY ALL";
    ui.animationButton.setAttribute("aria-pressed", String(state.playing));
  });

  ui.linksButton.addEventListener("click", () => {
    state.linksVisible = !state.linksVisible;
    linksGroup.visible = state.linksVisible;
    ui.linksButton.textContent = state.linksVisible ? "HIDE LINKS" : "SHOW LINKS";
    ui.linksButton.setAttribute("aria-pressed", String(state.linksVisible));
  });

  ui.lineStyleButton.addEventListener("click", () => {
    state.curvedLinks = !state.curvedLinks;
    ui.lineStyleButton.textContent = state.curvedLinks ? "CURVED LINES" : "STRAIGHT LINES";
    ui.lineStyleButton.setAttribute("aria-pressed", String(state.curvedLinks));
    if (state.movementPositions.length) {
      createConnections(state.movementPositions, state.curvedLinks);
    }
  });

  ui.autoRotateButton.addEventListener("click", () => {
    controls.autoRotate = !controls.autoRotate;
    ui.autoRotateButton.setAttribute("aria-pressed", String(controls.autoRotate));
    ui.autoRotateButton.textContent = controls.autoRotate ? "STOP ROTATE" : "AUTO ROTATE";
  });

  ui.resetButton.addEventListener("click", resetView);
  ui.canvas.addEventListener("dblclick", resetView);
}

function resetView() {
  camera.position.set(10.8, 7.2, 12.8);
  controls.target.set(0, 0, 0);
  controls.update();
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
  if (missing.length) throw new Error(`Element analysis is missing movement ${missing.join(", ")}`);

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

function projectEmbeddingTo3D(embeddings) {
  const dimensions = embeddings[0]?.length || 0;
  if (dimensions < 3) throw new Error("The movement embedding has fewer than three dimensions.");

  const means = Array.from({ length: dimensions }, (_, dimension) => (
    embeddings.reduce((sum, row) => sum + row[dimension], 0) / embeddings.length
  ));
  const centered = embeddings.map((row) => row.map((value, dimension) => value - means[dimension]));
  const covariance = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));

  for (let rowIndex = 0; rowIndex < dimensions; rowIndex += 1) {
    for (let columnIndex = rowIndex; columnIndex < dimensions; columnIndex += 1) {
      const value = centered.reduce(
        (sum, row) => sum + row[rowIndex] * row[columnIndex],
        0,
      ) / Math.max(centered.length - 1, 1);
      covariance[rowIndex][columnIndex] = value;
      covariance[columnIndex][rowIndex] = value;
    }
  }

  const eigenvectors = [];
  for (let component = 0; component < 3; component += 1) {
    let vector = Array.from(
      { length: dimensions },
      (_, index) => Math.sin((index + 1) * (component + 1) * 1.618),
    );
    vector = normalizeVector(vector);

    for (let iteration = 0; iteration < 90; iteration += 1) {
      let next = covariance.map((row) => dot(row, vector));
      eigenvectors.forEach((previous) => {
        const overlap = dot(next, previous);
        next = next.map((value, index) => value - overlap * previous[index]);
      });
      vector = normalizeVector(next);
    }
    eigenvectors.push(vector);
  }

  const projected = centered.map((row) => eigenvectors.map((vector) => dot(row, vector)));
  const axisScales = [0, 1, 2].map((axis) => {
    const variance = projected.reduce((sum, row) => sum + row[axis] ** 2, 0) / projected.length;
    return Math.sqrt(Math.max(variance, 1e-9));
  });
  const balanced = projected.map((row) => [
    row[0] / axisScales[0],
    row[1] / axisScales[1],
    row[2] / axisScales[2],
  ]);
  const positions = balanced.map((row, index) => {
    const movementId = state.movements[index]?.id || index + 1;
    const phaseX = pseudoRandom(movementId * 41 + 7) * Math.PI * 2;
    const phaseY = pseudoRandom(movementId * 59 + 19) * Math.PI * 2;
    const phaseZ = pseudoRandom(movementId * 73 + 31) * Math.PI * 2;
    return new THREE.Vector3(
      row[0] * 1.5 + Math.sin(row[1] * 1.35 + phaseX) * 0.43,
      row[1] * 1.42 + Math.sin(row[2] * 1.5 + phaseY) * 0.36,
      row[2] * 1.62 + Math.sin(row[0] * 1.2 + phaseZ) * 0.47,
    );
  });
  const center = positions.reduce((sum, position) => sum.add(position), new THREE.Vector3())
    .multiplyScalar(1 / positions.length);
  return positions.map((position) => position.sub(center).multiplyScalar(EMBEDDING_SPREAD));
}

function createMovementLabels(positions) {
  const fragment = document.createDocumentFragment();
  state.movements.forEach((movement, index) => {
    const row = state.rowById.get(movement.id);
    const dominant = dominantElement(row);
    const label = document.createElement("span");
    label.className = "space-movement-label";
    label.textContent = String(movement.id).padStart(2, "0");
    label.title = `${movement.thai} — ${movement.english}`;
    label.dataset.dominantElement = dominant.id;
    label.style.setProperty("--dominant-color", dominant.color);
    fragment.appendChild(label);
    state.movementItems.push({
      movement,
      row,
      dominant,
      target: positions[index],
      label,
      root: null,
      mixer: null,
      duration: 0,
      scale: 1,
      centerTrack: movement.skeleton?.center_track || [],
      lastCenterIndex: -1,
    });
  });
  ui.movementLabels.appendChild(fragment);
  ui.canvas.dataset.dominantCounts = JSON.stringify(dominantElementCounts(state.movementItems));
}

function createElementNodes() {
  const fragment = document.createDocumentFragment();

  ELEMENTS.forEach((element) => {
    const position = new THREE.Vector3(...element.anchor);

    const label = document.createElement("span");
    label.className = "space-element-label";
    label.textContent = element.label;
    label.style.setProperty("--element-color", element.color);
    fragment.appendChild(label);
    state.elementItems.push({ element, position, label });
  });

  ui.elementLabels.appendChild(fragment);
  ui.canvas.dataset.elementNodeMeshes = String(elementsGroup.children.length);
}

function disposeConnections() {
  linksGroup.children.forEach((group) => {
    group.traverse((object) => {
      if (!object.isMesh) return;
      object.geometry?.dispose();
      object.material?.dispose();
    });
  });
  linksGroup.clear();
  state.connectionItems = [];
}

function createConnections(movementPositions, curved = state.curvedLinks) {
  disposeConnections();
  state.elementItems.forEach(({ element, position: elementPosition }, elementIndex) => {
    const elementGroup = new THREE.Group();
    elementGroup.name = `${element.id}-${curved ? "curved" : "straight"}-weighted-connections`;
    state.movements.forEach((movement, index) => {
      const movementPosition = movementPositions[index];
      const value = state.rowById.get(movement.id)[element.field];
      const normalized = normalizedElementValue(value, element.id);
      const radius = connectionRadius(value, element.id);
      const opacity = connectionOpacity(value, element.id);
      const curve = curved
        ? organicConnectionCurve(
          movementPosition,
          elementPosition,
          movement.id,
          elementIndex,
        )
        : new THREE.LineCurve3(movementPosition.clone(), elementPosition.clone());
      const geometry = new THREE.TubeGeometry(curve, curved ? 12 : 2, radius, 4, false);
      const material = new THREE.MeshBasicMaterial({
        color: element.color,
        transparent: true,
        opacity,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `${element.id}-movement-${movement.id}`;
      mesh.frustumCulled = false;
      mesh.renderOrder = 1;
      mesh.userData = {
        elementId: element.id,
        movementId: movement.id,
        value,
        normalized,
        radius,
        opacity,
        curved,
      };
      elementGroup.add(mesh);
      state.connectionItems.push(mesh);
    });
    linksGroup.add(elementGroup);
  });
  linksGroup.visible = state.linksVisible;

  ui.canvas.dataset.connectionCount = String(state.connectionItems.length);
  ui.canvas.dataset.lineStyle = curved ? "curved" : "straight";
  ui.canvas.dataset.curvedConnections = String(
    state.connectionItems.filter((mesh) => mesh.userData.curved).length,
  );
  const connectionStats = Object.fromEntries(ELEMENTS.map((element) => {
    const connections = state.connectionItems.filter(
      (mesh) => mesh.userData.elementId === element.id,
    );
    return [element.id, {
      count: connections.length,
      minimumRadius: Math.min(...connections.map((mesh) => mesh.userData.radius)),
      maximumRadius: Math.max(...connections.map((mesh) => mesh.userData.radius)),
      minimumOpacity: Math.min(...connections.map((mesh) => mesh.userData.opacity)),
      maximumOpacity: Math.max(...connections.map((mesh) => mesh.userData.opacity)),
    }];
  }));
  const positionExtents = [0, 1, 2].map((axis) => [
    Math.min(...movementPositions.map((position) => position.getComponent(axis))),
    Math.max(...movementPositions.map((position) => position.getComponent(axis))),
  ]);
  ui.canvas.dataset.connectionStats = JSON.stringify(connectionStats);
  ui.canvas.dataset.positionExtents = JSON.stringify(positionExtents);
  window.__cybersubinElementMap3D = {
    getConnectionStats: () => connectionStats,
    movementPositions: movementPositions.map((position) => position.toArray()),
    elementPositions: state.elementItems.map((item) => item.position.toArray()),
  };
}

function createSpatialParticles() {
  const count = 260;
  const positions = new Float32Array(count * 3);
  for (let index = 0; index < count; index += 1) {
    const u = pseudoRandom(index * 3 + 1);
    const v = pseudoRandom(index * 3 + 2);
    const w = pseudoRandom(index * 3 + 3);
    const radius = 6.5 + u * 7.5;
    const theta = v * Math.PI * 2;
    const phi = Math.acos(2 * w - 1);
    positions[index * 3] = radius * Math.sin(phi) * Math.cos(theta);
    positions[index * 3 + 1] = radius * Math.cos(phi);
    positions[index * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    color: 0x64717a,
    size: 0.018,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    sizeAttenuation: true,
  });
  scene.add(new THREE.Points(geometry, material));
}

async function loadAllMovements(positions) {
  let nextIndex = 0;
  const workers = Array.from({ length: MODEL_WORKERS }, async () => {
    while (nextIndex < state.movements.length) {
      const index = nextIndex;
      nextIndex += 1;
      await loadMovement(state.movementItems[index], positions[index]);
    }
  });
  await Promise.all(workers);
}

async function loadMovement(item, targetPosition) {
  try {
    const gltf = await gltfLoader.loadAsync(toRootPath(item.movement.glb));
    const root = gltf.scene;
    root.name = `movement-${item.movement.id}`;
    root.userData.movementId = item.movement.id;
    root.userData.dominantElement = item.dominant.id;
    root.userData.dominantColor = item.dominant.color;
    const dominantColor = new THREE.Color(item.dominant.color);
    let recoloredMaterials = 0;
    root.traverse((object) => {
      if (!object.isMesh && !object.isSkinnedMesh) return;
      object.frustumCulled = false;
      object.castShadow = false;
      object.receiveShadow = false;
      if (!object.material) return;
      const materials = (Array.isArray(object.material) ? object.material : [object.material])
        .map((sourceMaterial) => {
          const material = sourceMaterial.clone();
          if (material.color) material.color.copy(dominantColor);
          if (material.emissive) {
            material.emissive.copy(dominantColor).multiplyScalar(0.055);
            material.emissiveIntensity = 0.55;
          }
          material.side = THREE.DoubleSide;
          if ("envMapIntensity" in material) material.envMapIntensity = 1.15;
          material.needsUpdate = true;
          recoloredMaterials += 1;
          return material;
        });
      object.material = Array.isArray(object.material) ? materials : materials[0];
    });
    root.userData.recoloredMaterials = recoloredMaterials;

    const skeletonSize = item.movement.skeleton?.calibration_head_to_hips_distance
      || item.movement.skeleton?.head_to_hips_distance
      || 66.2;
    item.scale = TARGET_HEAD_TO_HIPS / skeletonSize;
    root.scale.setScalar(item.scale);
    item.root = root;
    item.target.copy(targetPosition);

    const clip = gltf.animations.find((animation) => animation.name === item.movement.animation_name)
      || gltf.animations[0];
    if (clip) {
      const mixer = new THREE.AnimationMixer(root);
      const action = mixer.clipAction(clip);
      action.play();
      mixer.setTime(item.movement.skeleton?.calibration_time_seconds || 0);
      item.mixer = mixer;
      item.duration = clip.duration;
    }

    updateMovementAnchor(item, true);
    avatarsGroup.add(root);
    recordModelResult(false);
  } catch (error) {
    console.warn(`Movement ${item.movement.id} failed to load`, error);
    item.label.classList.add("is-failed");
    recordModelResult(true);
  }
}

function recordModelResult(failed) {
  if (failed) state.failed += 1;
  else state.loaded += 1;
  const settled = state.loaded + state.failed;
  ui.loadedCount.textContent = String(state.loaded);
  ui.loadingDetail.textContent = `LOADING ${state.loaded} / ${state.movements.length} ANIMATED MODELS`;
  if (state.loaded >= 8 || settled === state.movements.length) revealScene();
}

function revealScene() {
  ui.loading.classList.add("is-ready");
}

function startRendering() {
  const render = () => {
    animationFrame = requestAnimationFrame(render);
    const delta = Math.min(clock.getDelta(), 0.05);

    if (state.playing) {
      state.movementItems.forEach((item) => {
        if (!item.mixer) return;
        item.mixer.update(delta * PLAYBACK_SPEED);
        updateMovementAnchor(item);
      });
    }

    controls.update();
    renderer.render(scene, camera);
    if (state.sceneReady) updateScreenLabels();
  };
  render();
}

function updateMovementAnchor(item, force = false) {
  if (!item.root) return;
  const centers = item.centerTrack;
  let center = item.movement.skeleton?.calibration_center || [0, 0, 0];

  if (centers.length && item.mixer && item.duration > 0) {
    const progress = (((item.mixer.time % item.duration) + item.duration) % item.duration) / item.duration;
    const centerIndex = Math.min(centers.length - 1, Math.round(progress * (centers.length - 1)));
    if (!force && centerIndex === item.lastCenterIndex) return;
    item.lastCenterIndex = centerIndex;
    center = centers[centerIndex];
  }

  item.root.position.set(
    item.target.x - center[0] * item.scale,
    item.target.y - center[1] * item.scale,
    item.target.z - center[2] * item.scale,
  );
}

function updateScreenLabels() {
  const width = ui.stage.clientWidth;
  const height = ui.stage.clientHeight;
  camera.getWorldDirection(cameraDirection);

  state.movementItems.forEach((item) => {
    projectionVector.copy(item.target);
    projectionVector.y -= 0.43;
    positionLabel(item.label, projectionVector, width, height, false);
  });

  state.elementItems.forEach((item) => {
    positionLabel(item.label, item.position, width, height, true);
  });
}

function positionLabel(label, worldPosition, width, height, isElement) {
  const toPoint = projectionVector.copy(worldPosition).sub(camera.position);
  const inFront = toPoint.dot(cameraDirection) > 0;
  projectionVector.copy(worldPosition).project(camera);
  const visible = inFront && projectionVector.z > -1 && projectionVector.z < 1;

  if (!visible) {
    label.style.display = "none";
    return;
  }

  label.style.display = "block";
  label.style.left = `${(projectionVector.x * 0.5 + 0.5) * width}px`;
  label.style.top = `${(-projectionVector.y * 0.5 + 0.5) * height}px`;
  label.style.zIndex = String(Math.max(1, Math.round((1 - projectionVector.z) * 5000)));
  if (!isElement) {
    const distance = camera.position.distanceTo(worldPosition);
    label.style.opacity = String(clamp(1.35 - distance / 26, 0.48, 0.98));
  }
}

function resizeRenderer() {
  if (!renderer || !camera) return;
  const width = Math.max(1, ui.stage.clientWidth);
  const height = Math.max(1, ui.stage.clientHeight);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

function organicConnectionCurve(start, end, movementId, elementIndex) {
  const direction = end.clone().sub(start);
  const distance = Math.max(direction.length(), 0.001);
  const tangent = direction.clone().normalize();
  const seedOne = pseudoRandom(movementId * 67 + elementIndex * 131 + 17);
  const seedTwo = pseudoRandom(movementId * 89 + elementIndex * 173 + 43);
  const reference = new THREE.Vector3(
    seedOne - 0.5,
    seedTwo - 0.5,
    pseudoRandom(movementId * 107 + elementIndex * 197 + 61) - 0.5,
  ).normalize();
  const perpendicular = tangent.clone().cross(reference);
  if (perpendicular.lengthSq() < 1e-5) perpendicular.set(0, 1, 0).cross(tangent);
  perpendicular.normalize();
  const binormal = tangent.clone().cross(perpendicular).normalize();
  const directionSign = seedOne > 0.43 ? 1 : -1;
  const bend = distance * (0.09 + seedOne * 0.085) * directionSign;
  const depthBend = distance * (seedTwo - 0.5) * 0.1;
  const controlOne = start.clone()
    .addScaledVector(direction, 0.27)
    .addScaledVector(perpendicular, bend)
    .addScaledVector(binormal, depthBend);
  const controlTwo = start.clone()
    .addScaledVector(direction, 0.68)
    .addScaledVector(perpendicular, bend * 0.62)
    .addScaledVector(binormal, -depthBend * 0.45);
  return new THREE.CubicBezierCurve3(start.clone(), controlOne, controlTwo, end.clone());
}

function normalizedElementValue(value, elementId) {
  const [minimum, maximum] = state.elementExtents.get(elementId) || [0, 100];
  return clamp((value - minimum) / Math.max(maximum - minimum, 0.001), 0, 1);
}

function connectionRadius(value, elementId) {
  const normalized = normalizedElementValue(value, elementId);
  return 0.0035 + Math.pow(normalized, 1.62) * 0.032;
}

function connectionOpacity(value, elementId) {
  const normalized = normalizedElementValue(value, elementId);
  return 0.035 + Math.pow(normalized, 1.18) * 0.29;
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
  return records.map((record) => Object.fromEntries(
    headers.map((header, index) => [header, record[index] ?? ""]),
  ));
}

function normalizeAnalysisRow(row) {
  const normalized = { ...row, pose_number: Number(row.pose_number) };
  ELEMENTS.forEach((element) => {
    normalized[element.field] = Number(row[element.field]);
  });
  return normalized;
}

function normalizeVector(vector) {
  const magnitude = Math.hypot(...vector);
  if (magnitude < 1e-12) return vector.map((_, index) => (index === 0 ? 1 : 0));
  return vector.map((value) => value / magnitude);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function pseudoRandom(seed) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function toRootPath(path) {
  return path.startsWith("/") ? path : `/${path}`;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

window.addEventListener("beforeunload", () => {
  if (animationFrame) cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  disposeConnections();
  dracoLoader?.dispose();
  renderer?.dispose();
});
