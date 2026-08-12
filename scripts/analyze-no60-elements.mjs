#!/usr/bin/env node

import { readFile, mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

import {
  analyzeNo60ElementFrames,
  NO60_ELEMENT_ANALYSIS_DEFINITIONS
} from '../src/no60-element-analysis.js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(SCRIPT_DIR, '..');
const DISPLAY_HEIGHT = 3;
const INITIAL_POSE_TRIM_SECONDS = 0.35;
const SAMPLE_RATE = 8;
const MIN_SAMPLES = 180;
const MAX_SAMPLES = 480;

const TRACK_DEFINITIONS = Object.freeze([
  { id: 'leftHand', bones: ['LeftHand'], anchor: 'LeftHand' },
  { id: 'rightHand', bones: ['RightHand'], anchor: 'RightHand' },
  { id: 'leftArm', bones: ['LeftArm', 'LeftForeArm'], anchor: 'LeftForeArm' },
  { id: 'rightArm', bones: ['RightArm', 'RightForeArm'], anchor: 'RightForeArm' },
  { id: 'leftLeg', bones: ['LeftUpLeg', 'LeftLeg'], anchor: 'LeftLeg' },
  { id: 'rightLeg', bones: ['RightUpLeg', 'RightLeg'], anchor: 'RightLeg' },
  { id: 'leftFoot', bones: ['LeftFoot'], anchor: 'LeftFoot' },
  { id: 'rightFoot', bones: ['RightFoot'], anchor: 'RightFoot' },
  { id: 'head', bones: ['Head'], anchor: 'Head' },
  { id: 'body', bones: ['Hips', 'Spine', 'Spine1', 'Spine2'], anchor: 'Spine2' }
]);

const AXIS_POINT_BONE_NAMES = Object.freeze([
  'Hips', 'Spine2', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftLeg', 'LeftFoot', 'RightLeg', 'RightFoot'
]);

const ROTATION_BONE_NAMES = Object.freeze([
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'
]);

const ELEMENT_IDS = NO60_ELEMENT_ANALYSIS_DEFINITIONS.map(({ id }) => id);
const ELEMENT_COLUMN_NAMES = Object.freeze({
  energy: 'energy',
  curves: 'circles_curves',
  axes: 'axis_points',
  sync: 'synchronous_limbs',
  space: 'external_body_spaces',
  relations: 'shifting_relations'
});

function printHelp() {
  console.log(`Usage: node scripts/analyze-no60-elements.mjs [options]

Analyze indexed GLB movements with the same NO.60 Element Analysis algorithm
used by the website and write one aggregate CSV row per movement.

Options:
  --input-dir <path>     GLB directory (default: glb-optim)
  --catalog <path>       Posture catalog (default: 59.ts)
  --output <path>        Output CSV (default: outputs/no60-element-analysis-1-59.csv)
  --start <number>       First pose number, inclusive (default: 1)
  --end <number>         Last pose number, inclusive (default: 59)
  --sample-rate <number> Samples per animation second (default: 8)
  --min-samples <number> Minimum samples per movement (default: 180)
  --max-samples <number> Maximum samples per movement (default: 480)
  --trim-seconds <value> Initial T-pose trim (default: 0.35)
  --body-height <value>  Normalized avatar height (default: 3)
  --precision <number>   CSV decimal places (default: 3)
  --help                 Show this help
`);
}

function parseArguments(argv) {
  const options = {
    inputDir: path.join(PROJECT_ROOT, 'glb-optim'),
    catalog: path.join(PROJECT_ROOT, '59.ts'),
    output: path.join(PROJECT_ROOT, 'outputs', 'no60-element-analysis-1-59.csv'),
    start: 1,
    end: 59,
    sampleRate: SAMPLE_RATE,
    minSamples: MIN_SAMPLES,
    maxSamples: MAX_SAMPLES,
    trimSeconds: INITIAL_POSE_TRIM_SECONDS,
    bodyHeight: DISPLAY_HEIGHT,
    precision: 3
  };
  const keys = {
    '--input-dir': 'inputDir',
    '--catalog': 'catalog',
    '--output': 'output',
    '--start': 'start',
    '--end': 'end',
    '--sample-rate': 'sampleRate',
    '--min-samples': 'minSamples',
    '--max-samples': 'maxSamples',
    '--trim-seconds': 'trimSeconds',
    '--body-height': 'bodyHeight',
    '--precision': 'precision'
  };
  const numericKeys = new Set([
    'start', 'end', 'sampleRate', 'minSamples', 'maxSamples',
    'trimSeconds', 'bodyHeight', 'precision'
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') {
      options.help = true;
      continue;
    }
    const key = keys[argument];
    if (!key) throw new Error(`Unknown option: ${argument}`);
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${argument}`);
    options[key] = numericKeys.has(key) ? Number(value) : path.resolve(PROJECT_ROOT, value);
    index += 1;
  }

  for (const key of numericKeys) {
    if (!Number.isFinite(options[key])) throw new Error(`Invalid numeric value for ${key}`);
  }
  options.start = Math.trunc(options.start);
  options.end = Math.trunc(options.end);
  options.minSamples = Math.max(2, Math.trunc(options.minSamples));
  options.maxSamples = Math.max(options.minSamples, Math.trunc(options.maxSamples));
  options.precision = Math.min(8, Math.max(0, Math.trunc(options.precision)));
  if (options.start < 1 || options.end < options.start) {
    throw new Error('Pose range must satisfy 1 <= start <= end');
  }
  if (options.sampleRate <= 0 || options.trimSeconds < 0 || options.bodyHeight <= 0) {
    throw new Error('sample-rate and body-height must be positive; trim-seconds cannot be negative');
  }
  return options;
}

async function loadPostureCatalog(catalogPath) {
  const source = await readFile(catalogPath, 'utf8');
  const executable = source.replace(
    /export\s+const\s+posture\s*:\s*\{\s*thai\s*:\s*string\s*;\s*english\s*:\s*string\s*;\s*pronounce\s*:\s*string\s*\}\s*\[\]\s*=/,
    'const posture ='
  );
  if (executable === source) {
    throw new Error(`Could not identify the posture array in ${catalogPath}`);
  }
  const catalog = vm.runInNewContext(`${executable}\nposture;`, Object.create(null), {
    filename: catalogPath,
    timeout: 1_000
  });
  if (!Array.isArray(catalog)) throw new Error(`Posture catalog is not an array: ${catalogPath}`);
  return catalog;
}

function readGlbChunks(buffer) {
  if (buffer.length < 20 || buffer.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('Input is not a valid binary glTF file');
  }
  if (buffer.readUInt32LE(4) !== 2) throw new Error('Only glTF 2.0 binary files are supported');
  const chunks = [];
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32LE(offset);
    const type = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buffer.length) throw new Error('Invalid GLB chunk length');
    chunks.push({ type, data: buffer.subarray(dataStart, dataEnd) });
    offset = dataEnd;
  }
  return chunks;
}

function nodeLocalMatrix(node = {}) {
  if (Array.isArray(node.matrix) && node.matrix.length === 16) {
    return new THREE.Matrix4().fromArray(node.matrix);
  }
  return new THREE.Matrix4().compose(
    new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1])
  );
}

function calculateMeshBounds(document) {
  const nodes = document.nodes ?? [];
  const parents = new Map();
  nodes.forEach((node, index) => {
    for (const child of node.children ?? []) parents.set(child, index);
  });
  const worldMatrices = new Map();
  const getWorldMatrix = (index) => {
    if (worldMatrices.has(index)) return worldMatrices.get(index);
    const local = nodeLocalMatrix(nodes[index]);
    const parentIndex = parents.get(index);
    const world = parentIndex === undefined
      ? local
      : getWorldMatrix(parentIndex).clone().multiply(local);
    worldMatrices.set(index, world);
    return world;
  };

  const bounds = new THREE.Box3();
  bounds.makeEmpty();
  nodes.forEach((node, nodeIndex) => {
    if (node.mesh === undefined) return;
    const mesh = document.meshes?.[node.mesh];
    const worldMatrix = getWorldMatrix(nodeIndex);
    for (const primitive of mesh?.primitives ?? []) {
      const accessor = document.accessors?.[primitive.attributes?.POSITION];
      if (!accessor?.min || !accessor?.max) continue;
      const primitiveBounds = new THREE.Box3(
        new THREE.Vector3().fromArray(accessor.min),
        new THREE.Vector3().fromArray(accessor.max)
      ).applyMatrix4(worldMatrix);
      bounds.union(primitiveBounds);
    }
  });
  if (bounds.isEmpty()) throw new Error('GLB does not expose POSITION bounds for normalization');
  return bounds;
}

function buildAnimationOnlyGlb(chunks) {
  const jsonChunk = chunks.find(({ type }) => type === 0x4e4f534a);
  if (!jsonChunk) throw new Error('GLB is missing its JSON chunk');
  const document = JSON.parse(jsonChunk.data.toString('utf8'));
  const bounds = calculateMeshBounds(document);

  for (const node of document.nodes ?? []) {
    delete node.mesh;
    delete node.skin;
  }
  delete document.meshes;
  delete document.materials;
  delete document.textures;
  delete document.images;
  delete document.samplers;
  delete document.skins;
  document.extensionsUsed = (document.extensionsUsed ?? []).filter(
    (extension) => extension !== 'KHR_draco_mesh_compression'
  );
  document.extensionsRequired = (document.extensionsRequired ?? []).filter(
    (extension) => extension !== 'KHR_draco_mesh_compression'
  );
  if (!document.extensionsUsed.length) delete document.extensionsUsed;
  if (!document.extensionsRequired.length) delete document.extensionsRequired;

  const rawJson = Buffer.from(JSON.stringify(document), 'utf8');
  const jsonPadding = (4 - (rawJson.length % 4)) % 4;
  const paddedJson = Buffer.concat([rawJson, Buffer.alloc(jsonPadding, 0x20)]);
  const retainedChunks = chunks.filter(({ type }) => type !== 0x4e4f534a);
  const totalLength = 12 + 8 + paddedJson.length
    + retainedChunks.reduce((total, chunk) => total + 8 + chunk.data.length, 0);
  const output = Buffer.alloc(totalLength);
  output.writeUInt32LE(0x46546c67, 0);
  output.writeUInt32LE(2, 4);
  output.writeUInt32LE(totalLength, 8);
  output.writeUInt32LE(paddedJson.length, 12);
  output.writeUInt32LE(0x4e4f534a, 16);
  paddedJson.copy(output, 20);
  let offset = 20 + paddedJson.length;
  for (const chunk of retainedChunks) {
    output.writeUInt32LE(chunk.data.length, offset);
    output.writeUInt32LE(chunk.type, offset + 4);
    chunk.data.copy(output, offset + 8);
    offset += 8 + chunk.data.length;
  }
  return { buffer: output, bounds };
}

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

async function loadAnimationOnlyGlb(filePath) {
  const source = await readFile(filePath);
  const { buffer, bounds } = buildAnimationOnlyGlb(readGlbChunks(source));
  const gltf = await new GLTFLoader().parseAsync(toArrayBuffer(buffer), `${path.dirname(filePath)}${path.sep}`);
  return { gltf, bounds };
}

function chooseClip(animations, poseNumber) {
  const exactName = new RegExp(`^no0*${poseNumber}(?:_|$)`, 'i');
  return animations.find((clip) => exactName.test(clip.name)) ?? animations.at(-1) ?? null;
}

function getTrimmedClipStart(clip, trimSeconds) {
  const sampledTimes = [];
  for (const track of clip.tracks) {
    const limit = Math.min(24, track.times.length);
    for (let index = 0; index < limit; index += 1) sampledTimes.push(track.times[index]);
  }
  sampledTimes.sort((first, second) => first - second);
  const uniqueTimes = sampledTimes.filter(
    (time, index) => index === 0 || Math.abs(time - sampledTimes[index - 1]) > 0.0001
  );
  const firstTime = uniqueTimes[0] ?? 0;
  const trimTarget = firstTime + trimSeconds;
  const start = uniqueTimes.find((time) => time + 0.0001 >= trimTarget)
    ?? uniqueTimes.at(-1)
    ?? firstTime;
  return THREE.MathUtils.clamp(start, 0, Math.max(0, clip.duration - 0.001));
}

function normalizeModel(root, sourceBounds, displayHeight) {
  const size = sourceBounds.getSize(new THREE.Vector3());
  const center = sourceBounds.getCenter(new THREE.Vector3());
  const scale = displayHeight / Math.max(size.y, 0.001);
  root.scale.multiplyScalar(scale);
  root.position.x -= center.x * scale;
  root.position.y -= sourceBounds.min.y * scale;
  root.position.z -= center.z * scale;
  root.updateMatrixWorld(true);
}

function indexBones(root) {
  const bones = new Map();
  root.traverse((object) => {
    if (object.name) bones.set(object.name, object);
  });
  return bones;
}

function captureFrame(bones, time) {
  const hips = bones.get('Hips');
  const hipsPosition = hips?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const anchors = { __hips: hipsPosition.toArray() };
  for (const definition of TRACK_DEFINITIONS) {
    const anchor = bones.get(definition.anchor)
      ?? definition.bones.map((name) => bones.get(name)).find(Boolean);
    if (!anchor) continue;
    anchors[definition.id] = anchor.getWorldPosition(new THREE.Vector3())
      .sub(hipsPosition)
      .toArray();
  }

  const axisPoints = {};
  for (const name of AXIS_POINT_BONE_NAMES) {
    const bone = bones.get(name);
    if (!bone) continue;
    axisPoints[name] = bone.getWorldPosition(new THREE.Vector3())
      .sub(hipsPosition)
      .toArray();
  }

  const rotations = {};
  for (const name of ROTATION_BONE_NAMES) {
    const bone = bones.get(name);
    if (bone) rotations[name] = bone.getWorldQuaternion(new THREE.Quaternion()).toArray();
  }
  return { time, anchors, axisPoints, rotations };
}

function sampleMovement(root, clip, options) {
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(clip);
  action.setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const bones = indexBones(root);
  const clipStart = getTrimmedClipStart(clip, options.trimSeconds);
  const playableDuration = Math.max(0.001, clip.duration - clipStart);
  const sampleCount = Math.round(THREE.MathUtils.clamp(
    playableDuration * options.sampleRate,
    options.minSamples,
    options.maxSamples
  ));
  const frames = [];
  for (let index = 0; index < sampleCount; index += 1) {
    const progress = index / Math.max(1, sampleCount - 1);
    const time = clipStart + playableDuration * progress;
    action.time = time;
    mixer.update(0);
    root.updateMatrixWorld(true);
    frames.push(captureFrame(bones, time - clipStart));
  }
  action.stop();
  mixer.uncacheRoot(root);
  return { frames, clipStart, playableDuration };
}

function aggregateAnalysis(analysis) {
  if (!analysis.samples.length) throw new Error('Element analysis returned no samples');
  return Object.fromEntries(ELEMENT_IDS.map((id) => {
    const values = analysis.samples.map((sample) => Number(sample[id]) || 0);
    return [id, {
      average: values.reduce((total, value) => total + value, 0) / values.length,
      maximum: Math.max(...values)
    }];
  }));
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function formatCsv(rows, precision) {
  const headers = [
    'pose_number',
    'name',
    ...ELEMENT_IDS.map((id) => `avg_${ELEMENT_COLUMN_NAMES[id]}_percentage`),
    ...ELEMENT_IDS.map((id) => `max_${ELEMENT_COLUMN_NAMES[id]}_percentage`)
  ];
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) {
    const cells = [
      row.poseNumber,
      row.name,
      ...ELEMENT_IDS.map((id) => row.elements[id].average.toFixed(precision)),
      ...ELEMENT_IDS.map((id) => row.elements[id].maximum.toFixed(precision))
    ];
    lines.push(cells.map(csvCell).join(','));
  }
  return `${lines.join('\n')}\n`;
}

async function writeCsvAtomically(outputPath, contents) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, contents, 'utf8');
  await rename(temporaryPath, outputPath);
}

async function analyzePose(poseNumber, catalogEntry, options) {
  const filePath = path.join(options.inputDir, `${poseNumber}.glb`);
  const { gltf, bounds } = await loadAnimationOnlyGlb(filePath);
  const clip = chooseClip(gltf.animations, poseNumber);
  if (!clip) throw new Error(`No animation clip found in ${filePath}`);
  normalizeModel(gltf.scene, bounds, options.bodyHeight);
  const { frames } = sampleMovement(gltf.scene, clip, options);
  const analysis = analyzeNo60ElementFrames(frames, { bodyHeight: options.bodyHeight });
  const thai = String(catalogEntry?.thai ?? '').trim();
  const english = String(catalogEntry?.english ?? '').trim();
  const name = [thai, english].filter(Boolean).join(' — ') || `Pose ${poseNumber}`;
  return {
    poseNumber,
    name,
    elements: aggregateAnalysis(analysis)
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  const catalog = await loadPostureCatalog(options.catalog);
  if (catalog.length < options.end) {
    throw new Error(`Catalog has ${catalog.length} entries but pose ${options.end} was requested`);
  }

  const rows = [];
  const total = options.end - options.start + 1;
  for (let poseNumber = options.start; poseNumber <= options.end; poseNumber += 1) {
    const row = await analyzePose(poseNumber, catalog[poseNumber - 1], options);
    rows.push(row);
    console.log(`[${rows.length}/${total}] Pose ${poseNumber}: ${row.name}`);
  }
  await writeCsvAtomically(options.output, formatCsv(rows, options.precision));
  console.log(`Wrote ${rows.length} rows to ${options.output}`);
}

main().catch((error) => {
  console.error(`NO.60 batch analysis failed: ${error.stack ?? error.message ?? error}`);
  process.exitCode = 1;
});
