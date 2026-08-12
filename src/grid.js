import { posture } from '../59.ts';
import { writeViewStateToParams } from './view-url.js';
import './grid.css';

const MODEL_COUNT = 59;
const DEFAULT_MOVEMENT_ID = '59';
const DEFAULT_SPEED = 3;
const PLAYBACK_SPEED_OPTIONS = Object.freeze([0.05, 0.1, 0.5, 1, 1.5, 2, 3, 4, 5, 10, 20, 50]);
const GRID_STATE_KEY = 'cyber-subin-six-avatar-state';
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const EXTRA_MODEL_URLS = import.meta.glob('../models/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});
const STANDALONE_RIG_MODEL_URLS = import.meta.glob('../glb-style-2/*.glb', {
  eager: true,
  query: '?url',
  import: 'default'
});

const INDEXED_MOVEMENTS = posture.slice(0, MODEL_COUNT).map((movement, index) => ({
  ...movement,
  id: String(index + 1),
  fileName: `${index + 1}.glb`,
  modelNumber: index + 1,
  source: 'indexed'
}));

const EXTRA_MOVEMENTS = Object.keys(EXTRA_MODEL_URLS)
  .map((path) => {
    const fileName = path.split('/').at(-1);
    return { id: fileName, fileName, modelNumber: null, source: 'models' };
  })
  .sort((first, second) => first.fileName.localeCompare(second.fileName, undefined, {
    numeric: true,
    sensitivity: 'base'
  }));

const STANDALONE_RIG_MOVEMENTS = Object.keys(STANDALONE_RIG_MODEL_URLS)
  .map((path) => {
    const fileName = path.split('/').at(-1);
    return {
      id: `glb-style-2/${fileName}`,
      fileName,
      modelNumber: null,
      source: 'glb-style-2',
      rigFamily: 'glb-style-2',
      sequenceCompatible: false,
      mixUpCompatible: false
    };
  })
  .sort((first, second) => first.fileName.localeCompare(second.fileName, undefined, {
    numeric: true,
    sensitivity: 'base'
  }));

const MOVEMENTS = [...INDEXED_MOVEMENTS, ...EXTRA_MOVEMENTS, ...STANDALONE_RIG_MOVEMENTS];

function isRigCompositionCompatibleMovementId(movementId) {
  return INDEXED_MOVEMENTS.some((movement) => movement.id === movementId);
}
const EFFECTS = [
  { id: 'off', label: 'OFF' },
  { id: 'energy', label: 'ENERGY' },
  { id: 'curves', label: 'CIRCLES + CURVES' },
  { id: 'axes', label: 'AXIS POINTS' },
  { id: 'sync', label: 'SYNCHRONOUS LIMBS' },
  { id: 'space', label: 'EXTERNAL BODY SPACES' },
  { id: 'relations', label: 'SHIFTING RELATIONS' },
  { id: 'all', label: 'ALL EFFECTS' }
];
const DEFAULT_EFFECTS = ['energy', 'curves', 'axes', 'sync', 'space', 'relations'];

function readRestoredGridState() {
  if (PAGE_PARAMS.get('restore') !== '1') return null;
  try {
    const stored = JSON.parse(window.sessionStorage.getItem(GRID_STATE_KEY));
    return Array.isArray(stored?.cells) && stored.cells.length === 6 ? stored : null;
  } catch {
    return null;
  }
}

const restoredGridState = readRestoredGridState();

const ui = {
  grid: document.querySelector('#avatar-grid'),
  globalAvatar: document.querySelector('#global-avatar'),
  globalEffect: document.querySelector('#global-effect'),
  applyAvatarAll: document.querySelector('#apply-avatar-all'),
  randomAvatarAll: document.querySelector('#random-avatar-all'),
  applyEffectAll: document.querySelector('#apply-effect-all'),
  distributeEffects: document.querySelector('#distribute-effects'),
  editMasterSettings: document.querySelector('#edit-master-settings'),
  applySettingsAll: document.querySelector('#apply-settings-all'),
  resetAll: document.querySelector('#reset-all'),
  playAll: document.querySelector('#play-all'),
  restartAll: document.querySelector('#restart-all'),
  currentTime: document.querySelector('#grid-current-time'),
  totalTime: document.querySelector('#grid-total-time'),
  timeline: document.querySelector('#grid-timeline'),
  speedButtons: [...document.querySelectorAll('[data-grid-speed]')],
  speedMenu: document.querySelector('#grid-speed-menu'),
  speedMenuValue: document.querySelector('#grid-speed-value'),
  singleViewLink: document.querySelector('#single-view-link'),
  hideControlButtons: document.querySelector('#hide-control-buttons'),
  hideAllUi: document.querySelector('#hide-all-ui')
};

const transportState = {
  playing: restoredGridState?.transport?.playing ?? true,
  speed: PLAYBACK_SPEED_OPTIONS.includes(Number(restoredGridState?.transport?.speed))
    ? Number(restoredGridState.transport.speed)
    : DEFAULT_SPEED,
  progress: Math.max(0, Math.min(1, Number(restoredGridState?.transport?.progress) || 0)),
  scrubbing: false,
  resumeAfterScrub: false
};

function formatTime(seconds) {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${remainder.toFixed(2).padStart(5, '0')}`;
}

function movementLabel(movement) {
  if (movement.source === 'indexed') {
    return `${String(movement.modelNumber).padStart(2, '0')} · ${movement.thai} — ${movement.english.trim()}`;
  }
  return movement.source === 'glb-style-2'
    ? `${movement.fileName} · STANDALONE RIG`
    : movement.fileName;
}

function appendMovementOptions(select) {
  const indexedGroup = document.createElement('optgroup');
  indexedGroup.label = '59 INDEXED MOVEMENTS';
  const modelFolderGroup = document.createElement('optgroup');
  modelFolderGroup.label = '/MODELS · FILE NAME INDEX';
  const standaloneRigGroup = document.createElement('optgroup');
  standaloneRigGroup.label = '/GLB-STYLE-2 · STANDALONE RIGS · NO SEQUENCE / MIX-UP';

  for (const movement of INDEXED_MOVEMENTS) {
    const option = document.createElement('option');
    option.value = movement.id;
    option.textContent = movementLabel(movement);
    indexedGroup.append(option);
  }

  for (const movement of EXTRA_MOVEMENTS) {
    const option = document.createElement('option');
    option.value = movement.id;
    option.textContent = movementLabel(movement);
    modelFolderGroup.append(option);
  }

  for (const movement of STANDALONE_RIG_MOVEMENTS) {
    const option = document.createElement('option');
    option.value = movement.id;
    option.textContent = movementLabel(movement);
    standaloneRigGroup.append(option);
  }

  select.append(indexedGroup, modelFolderGroup, standaloneRigGroup);
}

function appendEffectOptions(select) {
  for (const effect of EFFECTS) {
    const option = document.createElement('option');
    option.value = effect.id;
    option.textContent = effect.label;
    select.append(option);
  }
}

function ensureCustomEffectOption(select) {
  if (select.querySelector('option[value="custom"]')) return;
  const option = document.createElement('option');
  option.value = 'custom';
  option.textContent = 'CUSTOM MIX';
  select.append(option);
}

function experimentsForEffect(effect) {
  if (effect === 'off') return [];
  if (effect === 'all') return EFFECTS.filter((candidate) => !['off', 'all'].includes(candidate.id)).map((candidate) => candidate.id);
  return EFFECTS.some((candidate) => candidate.id === effect) ? [effect] : [];
}

function embeddedAvatarUrl(movement, effect, index, viewState = null) {
  const params = new URLSearchParams({
    embedded: '1',
    transport: index === 0 ? '1' : '0',
    movement,
    effect
  });
  if (viewState) writeViewStateToParams(params, viewState);
  return `/?${params}`;
}

function sendCommand(cell, action, value) {
  cell.iframe.contentWindow?.postMessage({
    source: 'cyber-subin-grid',
    action,
    value
  }, window.location.origin);
}

function sendAll(action, value) {
  for (const cell of cells) sendCommand(cell, action, value);
}

function hasSequence(viewState) {
  return typeof viewState?.sequence === 'string'
    && viewState.sequence.split(',').some((movementId) => INDEXED_MOVEMENTS.some((movement) => movement.id === movementId));
}

function clearSequenceFromView(viewState) {
  const nextView = structuredClone(viewState ?? {});
  nextView.sequence = '';
  nextView.sequenceActive = false;
  nextView.sequenceTimelineOpen = false;
  nextView.sequenceTransitionDurations = '';
  nextView.sequenceTransitionEasings = '';
  nextView.sequencePlaybackSpeeds = '';
  nextView.sequenceLoopMode = 'loop';
  return nextView;
}

function clearRigCompositionFromView(viewState) {
  const nextView = clearSequenceFromView(viewState);
  nextView.mixUpActive = false;
  nextView.mixUpPanelOpen = false;
  return nextView;
}

function updateCellSequenceButton(cell) {
  if (!cell?.applySequenceButton) return;
  const compatible = isRigCompositionCompatibleMovementId(cell.avatarSelect.value);
  const available = compatible
    && hasSequence(cell.viewState)
    && cell.card.classList.contains('ready');
  cell.applySequenceButton.disabled = !available;
  cell.applySequenceButton.title = available
    ? 'Apply this read-only movement sequence to all six avatars'
    : compatible
      ? 'Create a sequence in Single View first'
      : 'Standalone glb-style-2 rigs cannot use sequences';
}

function setAllPlaying(playing) {
  transportState.playing = playing;
  ui.playAll.textContent = playing ? 'PAUSE ALL' : 'PLAY ALL';
  ui.playAll.setAttribute('aria-label', playing ? 'Pause all animations' : 'Play all animations');
  ui.playAll.classList.toggle('active', !playing);
  sendAll('playing', playing);
}

function setAllSpeed(speed) {
  if (!PLAYBACK_SPEED_OPTIONS.includes(speed)) return;
  transportState.speed = speed;
  ui.speedButtons.forEach((button) => {
    const active = Number(button.dataset.gridSpeed) === speed;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  if (ui.speedMenuValue) ui.speedMenuValue.textContent = `${speed}×`;
  sendAll('speed', speed);
}

function setInterfaceHidden(hidden) {
  document.body.classList.toggle('interface-hidden', hidden);
  ui.hideAllUi.textContent = hidden ? 'EXIT PRESENTATION' : 'PRESENTATION MODE';
  ui.hideAllUi.setAttribute('aria-pressed', String(hidden));
  ui.hideAllUi.setAttribute('aria-label', hidden ? 'Exit presentation mode' : 'Enter presentation mode');
}

function setControlButtonsHidden(hidden) {
  document.body.classList.toggle('controls-hidden', hidden);
  ui.hideControlButtons.textContent = hidden ? 'SHOW BUTTONS' : 'HIDE BUTTONS';
  ui.hideControlButtons.setAttribute('aria-pressed', String(hidden));
  ui.hideControlButtons.setAttribute('aria-label', hidden ? 'Show grid control buttons' : 'Hide grid control buttons');
}

function saveGridState(focusedIndex = restoredGridState?.focusedIndex ?? null) {
  const snapshot = {
    focusedIndex,
    globalAvatar: ui.globalAvatar.value,
    globalEffect: ui.globalEffect.value,
    cells: cells.map((cell) => ({
      movement: cell.avatarSelect.value,
      effect: cell.effectSelect.value,
      effects: cell.viewState?.experiments ?? experimentsForEffect(cell.effectSelect.value),
      view: cell.viewState ?? null
    })),
    transport: {
      playing: transportState.playing,
      speed: transportState.speed,
      progress: transportState.progress
    }
  };

  try {
    window.sessionStorage.setItem(GRID_STATE_KEY, JSON.stringify(snapshot));
  } catch {
    // Deep-linking still works even if private browsing blocks temporary storage.
  }
}

function openCellInSingleView(index) {
  const cell = cells[index];
  if (!cell) return;
  saveGridState(index);

  const params = new URLSearchParams({
    movement: cell.avatarSelect.value,
    effect: cell.effectSelect.value,
    speed: String(transportState.speed),
    progress: String(transportState.progress),
    playing: String(transportState.playing),
    from: 'grid'
  });
  writeViewStateToParams(
    params,
    cell.viewState ?? { experiments: experimentsForEffect(cell.effectSelect.value) }
  );
  window.location.assign(`/?${params}`);
}

const requestedMovement = PAGE_PARAMS.get('movement');
const restoredFirstMovement = restoredGridState?.cells?.[0]?.movement;
const initialMovement = restoredFirstMovement || requestedMovement;
const defaultMovement = MOVEMENTS.some((movement) => movement.id === initialMovement)
  ? initialMovement
  : DEFAULT_MOVEMENT_ID;

appendMovementOptions(ui.globalAvatar);
appendEffectOptions(ui.globalEffect);
ui.globalAvatar.value = MOVEMENTS.some((movement) => movement.id === restoredGridState?.globalAvatar)
  ? restoredGridState.globalAvatar
  : defaultMovement;
ui.globalEffect.value = EFFECTS.some((effect) => effect.id === restoredGridState?.globalEffect)
  ? restoredGridState.globalEffect
  : 'energy';

const cells = Array.from({ length: 6 }, (_, index) => {
  const restoredCell = restoredGridState?.cells?.[index];
  const cellMovement = MOVEMENTS.some((movement) => movement.id === restoredCell?.movement)
    ? restoredCell.movement
    : defaultMovement;
  const restoredExperiments = Array.isArray(restoredCell?.effects)
    ? restoredCell.effects.filter((effect) => EFFECTS.some((candidate) => candidate.id === effect))
    : null;
  const cellEffect = restoredCell?.effect === 'custom' && restoredExperiments?.length
    ? 'custom'
    : EFFECTS.some((effect) => effect.id === restoredCell?.effect)
      ? restoredCell.effect
      : DEFAULT_EFFECTS[index];
  const restoredCellViewState = restoredCell?.view && typeof restoredCell.view === 'object'
    ? restoredCell.view
    : restoredExperiments
      ? { experiments: restoredExperiments }
      : null;
  const cellViewState = isRigCompositionCompatibleMovementId(cellMovement)
    ? restoredCellViewState
    : clearRigCompositionFromView(restoredCellViewState);

  const card = document.createElement('article');
  card.className = 'avatar-card';
  card.dataset.cellIndex = String(index);

  const header = document.createElement('header');
  header.className = 'avatar-card__header';

  const indexLabel = document.createElement('span');
  indexLabel.className = 'avatar-card__index';
  indexLabel.textContent = String(index + 1).padStart(2, '0');

  const avatarLabel = document.createElement('label');
  avatarLabel.innerHTML = '<span>AVATAR</span>';
  const avatarSelect = document.createElement('select');
  avatarSelect.setAttribute('aria-label', `Select avatar for cell ${index + 1}`);
  appendMovementOptions(avatarSelect);
  avatarSelect.value = cellMovement;
  avatarLabel.append(avatarSelect);

  const effectLabel = document.createElement('label');
  effectLabel.innerHTML = '<span>EFFECT</span>';
  const effectSelect = document.createElement('select');
  effectSelect.setAttribute('aria-label', `Select effect for cell ${index + 1}`);
  appendEffectOptions(effectSelect);
  if (cellEffect === 'custom') ensureCustomEffectOption(effectSelect);
  effectSelect.value = cellEffect;
  effectLabel.append(effectSelect);

  const stateLabel = document.createElement('span');
  stateLabel.className = 'avatar-card__state';
  stateLabel.textContent = 'LOADING';

  const applyStyleButton = document.createElement('button');
  applyStyleButton.className = 'avatar-card__apply-style';
  applyStyleButton.type = 'button';
  applyStyleButton.disabled = true;
  applyStyleButton.setAttribute('aria-label', `Apply cell ${index + 1} style to all six avatars`);
  applyStyleButton.title = 'Apply this visual style to all six avatars';
  applyStyleButton.textContent = 'STYLE ×6';

  const applySequenceButton = document.createElement('button');
  applySequenceButton.className = 'avatar-card__apply-sequence';
  applySequenceButton.type = 'button';
  applySequenceButton.disabled = true;
  applySequenceButton.setAttribute('aria-label', `Apply cell ${index + 1} movement sequence to all six avatars`);
  applySequenceButton.title = 'Create a sequence in Single View first';
  applySequenceButton.textContent = 'SEQ ×6';

  const openButton = document.createElement('button');
  openButton.className = 'avatar-card__open';
  openButton.type = 'button';
  openButton.setAttribute('aria-label', `Open cell ${index + 1} in single view`);
  openButton.title = 'Open in single view';
  openButton.textContent = '↗';

  header.append(indexLabel, avatarLabel, effectLabel, stateLabel, applyStyleButton, applySequenceButton, openButton);

  const iframe = document.createElement('iframe');
  iframe.className = 'avatar-frame';
  iframe.title = `Avatar ${index + 1} movement visualization`;
  iframe.setAttribute('allow', 'autoplay');
  iframe.src = embeddedAvatarUrl(
    cellMovement,
    cellEffect === 'custom' ? 'off' : cellEffect,
    index,
    cellViewState
  );

  card.append(header, iframe);
  ui.grid.append(card);

  const cell = {
    card,
    iframe,
    avatarSelect,
    effectSelect,
    stateLabel,
    applyStyleButton,
    applySequenceButton,
    openButton,
    viewState: cellViewState
  };

  avatarSelect.addEventListener('change', () => {
    const nextViewState = structuredClone(
      cell.viewState ?? { experiments: experimentsForEffect(effectSelect.value) }
    );
    cell.viewState = isRigCompositionCompatibleMovementId(avatarSelect.value)
      ? clearSequenceFromView(nextViewState)
      : clearRigCompositionFromView(nextViewState);
    updateCellSequenceButton(cell);
    card.classList.remove('ready');
    stateLabel.textContent = 'LOADING';
    sendCommand(cell, 'movement', avatarSelect.value);
    saveGridState();
  });

  effectSelect.addEventListener('change', () => {
    if (effectSelect.value === 'custom') return;
    const experiments = experimentsForEffect(effectSelect.value);
    cell.viewState = { ...(cell.viewState ?? {}), experiments };
    sendCommand(cell, 'effect', effectSelect.value);
    saveGridState();
  });
  applyStyleButton.addEventListener('click', () => applyCellStyleToAll(index));
  applySequenceButton.addEventListener('click', () => applyCellSequenceToAll(index));
  openButton.addEventListener('click', () => openCellInSingleView(index));

  return cell;
});

let synchronizationPending = true;
let pendingTransportState = restoredGridState ? { ...transportState } : null;

function prepareSynchronizedReload() {
  synchronizationPending = true;
  pendingTransportState = {
    playing: transportState.playing,
    speed: transportState.speed,
    progress: transportState.progress
  };
}

function randomizeIndexedMovements() {
  const randomizedIds = INDEXED_MOVEMENTS.map((movement) => movement.id);
  for (let index = randomizedIds.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [randomizedIds[index], randomizedIds[swapIndex]] = [randomizedIds[swapIndex], randomizedIds[index]];
  }

  prepareSynchronizedReload();
  cells.forEach((cell, index) => {
    const movement = randomizedIds[index];
    cell.viewState = clearSequenceFromView(
      cell.viewState ?? { experiments: experimentsForEffect(cell.effectSelect.value) }
    );
    cell.avatarSelect.value = movement;
    cell.card.classList.remove('ready');
    cell.stateLabel.textContent = 'LOADING';
    sendCommand(cell, 'movement', movement);
  });
  ui.globalAvatar.value = randomizedIds[0];
  saveGridState();
}

function distributeNo60Elements() {
  cells.forEach((cell, index) => {
    const effect = DEFAULT_EFFECTS[index];
    cell.effectSelect.value = effect;
    cell.viewState = { ...(cell.viewState ?? {}), experiments: [effect] };
    sendCommand(cell, 'effect', effect);
  });
  ui.globalEffect.value = DEFAULT_EFFECTS[0];
  saveGridState();
}

function applyCellStyleToAll(sourceIndex) {
  const sourceCell = cells[sourceIndex];
  const sourceView = sourceCell?.viewState;
  if (!sourceView) {
    openCellInSingleView(sourceIndex);
    return;
  }

  const {
    experiments: _sourceExperiments,
    sequence: _sourceSequence,
    sequenceActive: _sourceSequenceActive,
    sequenceTimelineOpen: _sourceSequenceTimelineOpen,
    sequenceTransitionDuration: _sourceSequenceTransitionDuration,
    sequenceTransitionEasing: _sourceSequenceTransitionEasing,
    sequenceTransitionDurations: _sourceSequenceTransitionDurations,
    sequenceTransitionEasings: _sourceSequenceTransitionEasings,
    sequencePlaybackSpeeds: _sourceSequencePlaybackSpeeds,
    sequenceLoopMode: _sourceSequenceLoopMode,
    ...sourceStyle
  } = sourceView;
  cells.forEach((cell) => {
    const experiments = cell.viewState?.experiments ?? experimentsForEffect(cell.effectSelect.value);
    cell.viewState = {
      ...cell.viewState,
      ...structuredClone(sourceStyle),
      experiments: [...experiments]
    };
    if (cell.viewState.no60ModificationMode) cell.viewState.no60ModificationPanelOpen = false;
    if (cell.card.classList.contains('ready')) {
      cell.stateLabel.textContent = cell.viewState.no60ModificationMode ? 'LIVE · MOD' : 'LIVE';
    }
    sendCommand(cell, 'viewState', cell.viewState);
  });

  sourceCell.applyStyleButton.classList.add('applied');
  sourceCell.applyStyleButton.textContent = 'APPLIED';
  window.setTimeout(() => {
    sourceCell.applyStyleButton.classList.remove('applied');
    sourceCell.applyStyleButton.textContent = 'STYLE ×6';
  }, 900);
}

function applyCellSequenceToAll(sourceIndex) {
  const sourceCell = cells[sourceIndex];
  const sourceSequence = sourceCell?.viewState?.sequence;
  if (!hasSequence(sourceCell?.viewState)) {
    openCellInSingleView(sourceIndex);
    return;
  }

  const firstMovement = sourceSequence.split(',').find((movementId) => (
    INDEXED_MOVEMENTS.some((movement) => movement.id === movementId)
  ));
  cells.forEach((cell) => {
    if (!isRigCompositionCompatibleMovementId(cell.avatarSelect.value)) {
      cell.viewState = clearRigCompositionFromView(cell.viewState);
      updateCellSequenceButton(cell);
      return;
    }
    cell.viewState = {
      ...(cell.viewState ?? {}),
      sequence: sourceSequence,
      sequenceActive: true,
      sequenceTimelineOpen: false,
      sequenceTransitionDuration: sourceCell.viewState.sequenceTransitionDuration,
      sequenceTransitionEasing: sourceCell.viewState.sequenceTransitionEasing,
      sequenceTransitionDurations: sourceCell.viewState.sequenceTransitionDurations,
      sequenceTransitionEasings: sourceCell.viewState.sequenceTransitionEasings,
      sequencePlaybackSpeeds: sourceCell.viewState.sequencePlaybackSpeeds,
      sequenceLoopMode: sourceCell.viewState.sequenceLoopMode
    };
    if (firstMovement) cell.avatarSelect.value = firstMovement;
    sendCommand(cell, 'viewState', cell.viewState);
    updateCellSequenceButton(cell);
  });
  if (firstMovement) ui.globalAvatar.value = firstMovement;
  saveGridState();
  window.setTimeout(() => {
    sendAll('speed', transportState.speed);
    sendAll('seek', transportState.progress);
    sendAll('playing', transportState.playing);
  }, 650);

  sourceCell.applySequenceButton.classList.add('applied');
  sourceCell.applySequenceButton.textContent = 'APPLIED';
  window.setTimeout(() => {
    sourceCell.applySequenceButton.classList.remove('applied');
    sourceCell.applySequenceButton.textContent = 'SEQ ×6';
  }, 900);
}

function applyMasterSettingsToAll() {
  applyCellStyleToAll(0);
  if (hasSequence(cells[0]?.viewState)) applyCellSequenceToAll(0);
}

function resetAllGridSettings() {
  try {
    window.sessionStorage.removeItem(GRID_STATE_KEY);
  } catch {
    // Reset still works if temporary browser storage is unavailable.
  }

  setInterfaceHidden(false);
  setControlButtonsHidden(false);
  ui.globalAvatar.value = DEFAULT_MOVEMENT_ID;
  ui.globalEffect.value = DEFAULT_EFFECTS[0];
  transportState.playing = true;
  transportState.speed = DEFAULT_SPEED;
  transportState.progress = 0;
  transportState.scrubbing = false;
  transportState.resumeAfterScrub = false;
  ui.playAll.textContent = 'PAUSE ALL';
  ui.playAll.setAttribute('aria-label', 'Pause all animations');
  ui.playAll.classList.remove('active');
  ui.timeline.value = '0';
  ui.timeline.style.setProperty('--progress', '0%');
  ui.currentTime.textContent = '00:00.00';
  ui.totalTime.textContent = '/ 00:00.00';
  ui.speedButtons.forEach((button) => {
    const active = Number(button.dataset.gridSpeed) === DEFAULT_SPEED;
    button.classList.toggle('active', active);
    button.setAttribute('aria-checked', String(active));
  });
  if (ui.speedMenuValue) ui.speedMenuValue.textContent = `${DEFAULT_SPEED}×`;

  synchronizationPending = true;
  pendingTransportState = { playing: true, speed: DEFAULT_SPEED, progress: 0 };
  cells.forEach((cell, index) => {
    const effect = DEFAULT_EFFECTS[index];
    cell.avatarSelect.value = DEFAULT_MOVEMENT_ID;
    cell.effectSelect.value = effect;
    cell.viewState = null;
    cell.card.classList.remove('ready');
    cell.stateLabel.textContent = 'LOADING';
    cell.iframe.src = embeddedAvatarUrl(DEFAULT_MOVEMENT_ID, effect, index);
  });
}

ui.singleViewLink.href = `/?movement=${encodeURIComponent(cells[0].avatarSelect.value)}`;
ui.singleViewLink.addEventListener('click', (event) => {
  event.preventDefault();
  const restoredFocus = Number(restoredGridState?.focusedIndex);
  openCellInSingleView(Number.isInteger(restoredFocus) && restoredFocus >= 0 && restoredFocus < 6 ? restoredFocus : 0);
});

ui.timeline.value = String(transportState.progress);
ui.timeline.style.setProperty('--progress', `${transportState.progress * 100}%`);
ui.playAll.textContent = transportState.playing ? 'PAUSE ALL' : 'PLAY ALL';
ui.playAll.setAttribute('aria-label', transportState.playing ? 'Pause all animations' : 'Play all animations');
ui.playAll.classList.toggle('active', !transportState.playing);
ui.speedButtons.forEach((button) => {
  const active = Number(button.dataset.gridSpeed) === transportState.speed;
  button.classList.toggle('active', active);
  button.setAttribute('aria-checked', String(active));
});
if (ui.speedMenuValue) ui.speedMenuValue.textContent = `${transportState.speed}×`;

ui.applyAvatarAll.addEventListener('click', () => {
  prepareSynchronizedReload();
  for (const [index, cell] of cells.entries()) {
    const currentViewState = cell.viewState
      ?? { experiments: experimentsForEffect(cell.effectSelect.value) };
    const preservedViewState = isRigCompositionCompatibleMovementId(ui.globalAvatar.value)
      ? clearSequenceFromView(currentViewState)
      : clearRigCompositionFromView(currentViewState);
    cell.avatarSelect.value = ui.globalAvatar.value;
    cell.viewState = preservedViewState;
    updateCellSequenceButton(cell);
    cell.card.classList.remove('ready');
    cell.stateLabel.textContent = 'LOADING';
    const iframeEffect = cell.effectSelect.value === 'custom' ? 'off' : cell.effectSelect.value;
    cell.iframe.src = embeddedAvatarUrl(
      ui.globalAvatar.value,
      iframeEffect,
      index,
      preservedViewState
    );
  }
  saveGridState();
});

ui.randomAvatarAll.addEventListener('click', randomizeIndexedMovements);

ui.applyEffectAll.addEventListener('click', () => {
  for (const cell of cells) {
    cell.effectSelect.value = ui.globalEffect.value;
    cell.viewState = { ...(cell.viewState ?? {}), experiments: experimentsForEffect(ui.globalEffect.value) };
    sendCommand(cell, 'effect', ui.globalEffect.value);
  }
  saveGridState();
});

ui.distributeEffects.addEventListener('click', distributeNo60Elements);
ui.editMasterSettings.addEventListener('click', () => openCellInSingleView(0));
ui.applySettingsAll.addEventListener('click', applyMasterSettingsToAll);
ui.resetAll.addEventListener('click', resetAllGridSettings);

ui.playAll.addEventListener('click', () => setAllPlaying(!transportState.playing));
ui.hideControlButtons.addEventListener('click', () => setControlButtonsHidden(!document.body.classList.contains('controls-hidden')));
ui.hideAllUi.addEventListener('click', () => setInterfaceHidden(!document.body.classList.contains('interface-hidden')));

for (const button of ui.speedButtons) {
  button.addEventListener('click', () => {
    setAllSpeed(Number(button.dataset.gridSpeed));
    ui.speedMenu?.removeAttribute('open');
  });
}

ui.timeline.addEventListener('pointerdown', () => {
  transportState.scrubbing = true;
  transportState.resumeAfterScrub = transportState.playing;
  if (transportState.playing) setAllPlaying(false);
});

ui.timeline.addEventListener('input', () => {
  const progress = Number(ui.timeline.value);
  transportState.progress = progress;
  ui.timeline.style.setProperty('--progress', `${progress * 100}%`);
  sendAll('seek', progress);
});

const finishScrubbing = () => {
  if (!transportState.scrubbing) return;
  transportState.scrubbing = false;
  if (transportState.resumeAfterScrub) setAllPlaying(true);
  transportState.resumeAfterScrub = false;
};
ui.timeline.addEventListener('change', finishScrubbing);
ui.timeline.addEventListener('pointerup', finishScrubbing);
ui.timeline.addEventListener('pointercancel', finishScrubbing);

ui.restartAll.addEventListener('click', () => {
  sendAll('restart');
  setAllPlaying(true);
  transportState.progress = 0;
  ui.timeline.value = '0';
  ui.timeline.style.setProperty('--progress', '0%');
});

window.addEventListener('message', (event) => {
  if (event.origin !== window.location.origin || event.data?.source !== 'cyber-subin-avatar') return;
  const cell = cells.find((candidate) => candidate.iframe.contentWindow === event.source);
  if (!cell) return;

  if (event.data.type === 'transport') {
    if (cell !== cells[0] || transportState.scrubbing) return;
    const progress = Math.max(0, Math.min(1, Number(event.data.progress) || 0));
    transportState.progress = progress;
    ui.timeline.value = String(progress);
    ui.timeline.style.setProperty('--progress', `${progress * 100}%`);
    ui.currentTime.textContent = formatTime(event.data.currentTime);
    ui.totalTime.textContent = `/ ${formatTime(event.data.duration)}`;
    return;
  }

  if (event.data.type !== 'ready') return;
  cell.card.classList.add('ready');
  cell.applyStyleButton.disabled = false;
  if (!cell.viewState && event.data.viewState && typeof event.data.viewState === 'object') {
    cell.viewState = structuredClone(event.data.viewState);
  }
  if (cell.viewState?.no60ModificationMode) cell.viewState.no60ModificationPanelOpen = false;
  cell.stateLabel.textContent = cell.viewState?.no60ModificationMode ? 'LIVE · MOD' : 'LIVE';
  if (cell.viewState) sendCommand(cell, 'viewState', cell.viewState);
  updateCellSequenceButton(cell);

  if (synchronizationPending && cells.every((candidate) => candidate.card.classList.contains('ready'))) {
    synchronizationPending = false;
    const transportToApply = pendingTransportState;
    pendingTransportState = null;
    requestAnimationFrame(() => {
      if (transportToApply) {
        setAllSpeed(transportToApply.speed);
        transportState.progress = transportToApply.progress;
        ui.timeline.value = String(transportToApply.progress);
        ui.timeline.style.setProperty('--progress', `${transportToApply.progress * 100}%`);
        sendAll('seek', transportToApply.progress);
        setAllPlaying(transportToApply.playing);
      } else {
        sendAll('restart');
      }
    });
  }
});
