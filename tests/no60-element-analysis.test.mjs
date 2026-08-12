import assert from 'node:assert/strict';
import {
  NO60_ELEMENT_ANALYSIS_DEFINITIONS,
  analyzeNo60ElementFrames,
  buildNo60DominanceSegments,
  interpolateNo60ElementSample
} from '../src/no60-element-analysis.js';

assert.ok(NO60_ELEMENT_ANALYSIS_DEFINITIONS.every((definition) => (
  definition.analysis?.analyzes
  && definition.analysis?.algorithm
  && definition.analysis?.scale
  && definition.analysis?.interpretation
)), 'Every element should document its analysis method and interpretation');

function frame(time, leftHand, rightHand, leftFoot = [0, -1, 0], rightFoot = [0, -1, 0]) {
  const anchors = {
    leftHand,
    rightHand,
    leftArm: leftHand,
    rightArm: rightHand,
    leftLeg: leftFoot,
    rightLeg: rightFoot,
    leftFoot,
    rightFoot,
    head: [0, 1, 0],
    body: [0, 0, 0],
    __hips: [0, 0, 0]
  };
  return {
    time,
    anchors,
    rotations: Object.fromEntries([
      'Hips', 'Spine', 'Spine1', 'Spine2', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand',
      'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot',
      'RightUpLeg', 'RightLeg', 'RightFoot'
    ].map((id) => [id, [0, 0, 0, 1]]))
  };
}

const straightFrames = Array.from({ length: 17 }, (_, index) => {
  const x = index / 16;
  return frame(index / 8, [-0.5 + x, 0.5, 0], [0.5 - x, 0.5, 0]);
});
const curvedFrames = Array.from({ length: 17 }, (_, index) => {
  const angle = Math.PI * index / 8;
  return frame(
    index / 8,
    [-0.5 + Math.cos(angle) * 0.4, 0.5 + Math.sin(angle) * 0.4, 0],
    [0.5 - Math.cos(angle) * 0.4, 0.5 + Math.sin(angle) * 0.4, 0]
  );
});

const straight = analyzeNo60ElementFrames(straightFrames, { bodyHeight: 2 });
const curved = analyzeNo60ElementFrames(curvedFrames, { bodyHeight: 2 });
const average = (analysis, key) => analysis.samples.reduce((total, sample) => total + sample[key], 0)
  / analysis.samples.length;

assert.equal(straight.samples.length, straightFrames.length);
assert.ok(average(curved, 'curves') > average(straight, 'curves') + 10);
assert.ok(average(curved, 'sync') > 90, 'Mirrored limbs should remain synchronous');
for (const sample of curved.samples) {
  assert.ok(
    Math.abs(sample.relations - (100 - sample.sync)) < 0.000001,
    'Shifting Relations should be the exact inverse of Synchronous Limbs'
  );
}
for (const sample of curved.samples) {
  for (const key of ['energy', 'curves', 'axes', 'sync', 'space', 'relations']) {
    assert.ok(sample[key] >= 0 && sample[key] <= 100, `${key} should remain within 0–100%`);
  }
}

const separatedAxisFrames = Array.from({ length: 9 }, (_, index) => ({
  ...frame(index / 8, [-0.5, 0.5, 0], [0.5, 0.5, 0]),
  axisPoints: {
    first: [-0.8, 0, 0],
    second: [0, 0, 0],
    third: [0.8, 0, 0]
  }
}));
const clusteredAxisFrames = Array.from({ length: 9 }, (_, index) => ({
  ...frame(index / 8, [-0.5, 0.5, 0], [0.5, 0.5, 0]),
  axisPoints: {
    first: [-0.02, 0, 0],
    second: [0, 0, 0],
    third: [0.02, 0, 0]
  }
}));
const separatedAxes = analyzeNo60ElementFrames(separatedAxisFrames, { bodyHeight: 2 });
const clusteredAxes = analyzeNo60ElementFrames(clusteredAxisFrames, { bodyHeight: 2 });
assert.ok(
  average(separatedAxes, 'axes') > 1,
  'Axis Points should retain a small continuous proximity score instead of falling into a zero dead zone'
);
assert.ok(
  average(clusteredAxes, 'axes') > average(separatedAxes, 'axes') + 70,
  'Axis Points should rise when the tracked axis points move near one another'
);

const structuralNeighborFrames = Array.from({ length: 9 }, (_, index) => ({
  ...frame(index / 8, [-0.5, 0.5, 0], [0.5, 0.5, 0]),
  axisPoints: {
    Hips: [0, 0, 0],
    Spine2: [0.01, 0, 0],
    LeftHand: [1.2, 0, 0]
  }
}));
const meaningfulContactFrames = Array.from({ length: 9 }, (_, index) => ({
  ...frame(index / 8, [-0.5, 0.5, 0], [0.5, 0.5, 0]),
  axisPoints: {
    Hips: [0, 0, 0],
    Spine2: [0.8, 0, 0],
    LeftHand: [1.2, 0, 0],
    RightHand: [1.21, 0, 0]
  }
}));
const structuralNeighbors = analyzeNo60ElementFrames(structuralNeighborFrames, { bodyHeight: 2 });
const meaningfulContact = analyzeNo60ElementFrames(meaningfulContactFrames, { bodyHeight: 2 });
assert.ok(
  average(meaningfulContact, 'axes') > average(structuralNeighbors, 'axes') + 45,
  'Fixed skeleton-neighbor spacing should not overpower a meaningful cross-region axis contact'
);

const midpoint = interpolateNo60ElementSample(curved, 0.5);
assert.ok(midpoint);
assert.ok(Math.abs(midpoint.time - 1) < 0.0001);

const dominance = buildNo60DominanceSegments({
  samples: Array.from({ length: 20 }, (_, index) => ({
    time: index,
    energy: index < 10 ? 90 : 20,
    curves: index < 10 ? 25 : 88,
    axes: index === 4 ? 100 : 10,
    sync: 12,
    space: 8,
    relations: 5
  }))
}, { minimumRun: 2, switchMargin: 5 });
assert.deepEqual(dominance.map(({ id }) => id), ['energy', 'curves']);
assert.equal(dominance[0].startProgress, 0);
assert.equal(dominance.at(-1).endProgress, 1);
assert.ok(dominance.every(({ percentage }) => percentage >= 0 && percentage <= 100));

console.log('NO.60 element analysis tests passed.');
