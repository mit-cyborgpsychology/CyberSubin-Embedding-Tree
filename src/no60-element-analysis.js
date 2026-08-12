export const NO60_ELEMENT_ANALYSIS_DEFINITIONS = Object.freeze([
  {
    id: 'energy',
    label: 'ENERGY',
    dominanceLabel: 'ENERGY',
    color: '#65f3ff',
    method: 'Linear speed, acceleration, and joint angular velocity',
    analysis: {
      analyzes: 'Hip-relative motion of the hands, arms, legs, feet, head, and torso; world-space hip travel; and rotation across 17 major joints.',
      algorithm: 'The score combines mean linear speed with 0.055× linear acceleration, 0.085× joint angular velocity, and 0.20× hip travel. Linear terms are divided by body height so differently scaled avatars remain comparable.',
      scale: 'A two-pass temporal filter removes frame noise. The movement’s 98th-percentile activity maps to approximately 92%, while rarer peaks can reach 100%.',
      interpretation: 'Higher values mean more motion effort is occurring per unit time. It measures kinematic intensity, not physiological calories or muscular force.'
    }
  },
  {
    id: 'curves',
    label: 'CIRCLES + CURVES',
    shortLabel: 'CIRCLES + CURVES',
    dominanceLabel: 'CURVES',
    color: '#fb5c50',
    method: 'Direction change and curved travel at hands, feet, head, and body',
    analysis: {
      analyzes: 'Successive travel directions of the two hands, two feet, head, and torso, all measured relative to the hips.',
      algorithm: 'For each tracker, the angle between its incoming and outgoing displacement vectors estimates local path curvature. The turn angle is multiplied by a body-height-normalized speed gate so stationary jitter is not mistaken for a circle, then averaged across the six trackers.',
      scale: 'The curved-travel signal is temporally filtered and normalized against its 98th percentile within the selected movement.',
      interpretation: 'Higher values indicate sustained turning or circular trajectories. A low score means travel is straighter, nearly stationary, or reverses without enough continuous curved motion.'
    }
  },
  {
    id: 'axes',
    label: 'AXIS POINTS',
    dominanceLabel: 'AXIS',
    color: '#ffcc66',
    method: 'Spatial proximity among the movement’s axis points',
    analysis: {
      analyzes: 'The world-space positions of the hips, upper spine, head, arms, forearms, hands, lower legs, and feet—the same points displayed by the Axis Points visualization.',
      algorithm: 'At each moment, axis-point pairs from different body regions are compared by body-height-normalized distance. Permanently connected skeleton neighbors are excluded so fixed bone lengths cannot flatten the signal. The closest meaningful pair supplies 80% of the score, while average nearest-neighbor proximity supplies 20%.',
      scale: 'Distance uses a sensitive cubic falloff with half strength at 18% of body height. There is no hard cutoff: ordinary cross-region spacing retains a small score, while points moving toward one another rise quickly toward 100%. The bounded result is temporally smoothed.',
      interpretation: 'Higher values mean two or more axis points are spatially close at that moment. The score rises further when many axis points gather into the same compact region.'
    }
  },
  {
    id: 'sync',
    label: 'SYNCHRONOUS LIMBS',
    shortLabel: 'SYNC LIMBS',
    dominanceLabel: 'SYNC',
    color: '#b7ff63',
    method: 'Left/right limb activity-magnitude agreement',
    analysis: {
      analyzes: 'Speed magnitudes for four mirrored pairs: left/right hands, arms, legs, and feet.',
      algorithm: 'Each pair receives 1 − |left speed − right speed| ÷ (left speed + right speed). The four pair scores are averaged; an inactive pair is treated as synchronized. The result is then temporally smoothed.',
      scale: 'This metric is naturally bounded from 0% to 100%, so it is not percentile-normalized against the movement.',
      interpretation: '100% means the two sides have closely matched activity magnitude at that moment; lower values indicate unequal bilateral activity. It does not require mirrored direction or identical joint angles.'
    }
  },
  {
    id: 'space',
    label: 'EXTERNAL BODY SPACES',
    shortLabel: 'EXTERNAL SPACE',
    dominanceLabel: 'SPACE',
    color: '#a98bff',
    method: 'Body envelope, reach, and negative-space expansion',
    analysis: {
      analyzes: 'The hip-relative positions of the hands, arms, legs, feet, head, and torso, including the full three-dimensional body envelope and farthest reach.',
      algorithm: 'The axis-aligned pose span is weighted 0.42× width, 0.16× height, and 0.42× depth, then combined with 0.55× maximum reach. The result is divided by body height.',
      scale: 'The movement’s 3rd-to-97th-percentile spatial range is mapped to 5–95%, limiting outlier poses while preserving change over time.',
      interpretation: 'Higher values mean the pose occupies a larger external volume or produces greater reach and negative space. It describes expansion, not the exact geometric area of every opening.'
    }
  },
  {
    id: 'relations',
    label: 'SHIFTING RELATIONS',
    dominanceLabel: 'RELATIONS',
    color: '#ff6fae',
    method: 'Inverse of synchronous limb activity',
    analysis: {
      analyzes: 'The same four mirrored activity pairs used by Synchronous Limbs: left/right hands, arms, legs, and feet.',
      algorithm: 'The Synchronous Limbs score is calculated first, then Shifting Relations is defined as its exact complement: 100% − synchrony. Both metrics therefore use the same temporal smoothing and remain mathematically opposite at every sampled moment.',
      scale: 'This metric is naturally bounded from 0% to 100% and is not percentile-normalized against the movement.',
      interpretation: 'Higher values mean bilateral limb activity is more unequal and the relationship is shifting away from synchrony. Lower values mean the paired limbs are moving with similar activity magnitudes.'
    }
  }
]);

const DISTAL_IDS = ['leftHand', 'rightHand', 'leftFoot', 'rightFoot', 'head', 'body'];
const ATTENTION_IDS = ['leftHand', 'rightHand', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg', 'leftFoot', 'rightFoot', 'head', 'body'];
const ROTATION_IDS = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Head',
  'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand',
  'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'
];
const AXIS_STRUCTURAL_PAIR_KEYS = new Set([
  ['Hips', 'Spine2'],
  ['Hips', 'LeftLeg'],
  ['Hips', 'RightLeg'],
  ['Spine2', 'Head'],
  ['Spine2', 'LeftArm'],
  ['Spine2', 'RightArm'],
  ['LeftArm', 'LeftForeArm'],
  ['LeftForeArm', 'LeftHand'],
  ['RightArm', 'RightForeArm'],
  ['RightForeArm', 'RightHand'],
  ['LeftLeg', 'LeftFoot'],
  ['RightLeg', 'RightFoot']
].map((pair) => pair.sort().join('|')));

function clamp(value, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function subtract(first = [0, 0, 0], second = [0, 0, 0]) {
  return [first[0] - second[0], first[1] - second[1], first[2] - second[2]];
}

function length(vector = [0, 0, 0]) {
  return Math.hypot(vector[0], vector[1], vector[2]);
}

function dot(first, second) {
  return first[0] * second[0] + first[1] * second[1] + first[2] * second[2];
}

function quaternionAngle(first, second) {
  if (!first || !second) return 0;
  const cosine = clamp(Math.abs(
    first[0] * second[0]
      + first[1] * second[1]
      + first[2] * second[2]
      + first[3] * second[3]
  ), 0, 1);
  return 2 * Math.acos(cosine);
}

function quantile(values, ratio) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const position = clamp(ratio) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const blend = position - lower;
  return sorted[lower] * (1 - blend) + sorted[upper] * blend;
}

function smooth(values, radius = 2) {
  return values.map((_, index) => {
    let total = 0;
    let weightTotal = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const sourceIndex = Math.min(values.length - 1, Math.max(0, index + offset));
      const weight = radius + 1 - Math.abs(offset);
      total += values[sourceIndex] * weight;
      weightTotal += weight;
    }
    return weightTotal ? total / weightTotal : 0;
  });
}

function normalizeActivity(values) {
  const radius = Math.max(2, Math.min(8, Math.round(values.length / 100)));
  const smoothed = smooth(smooth(values, radius), Math.max(1, Math.floor(radius / 2)));
  const ceiling = Math.max(0.000001, quantile(smoothed, 0.98));
  return smoothed.map((value) => clamp(value * 0.92 / ceiling) * 100);
}

function normalizeRange(values) {
  const radius = Math.max(2, Math.min(8, Math.round(values.length / 100)));
  const smoothed = smooth(smooth(values, radius), Math.max(1, Math.floor(radius / 2)));
  const low = quantile(smoothed, 0.03);
  const high = quantile(smoothed, 0.97);
  const range = Math.max(0.000001, high - low);
  return smoothed.map((value) => 5 + clamp((value - low) / range) * 90);
}

function frameDelta(frames, index) {
  if (frames.length < 2) return 1 / 30;
  const previous = frames[Math.max(0, index - 1)];
  const next = frames[Math.min(frames.length - 1, index + 1)];
  return Math.max(1 / 240, (next.time - previous.time) / (index === 0 || index === frames.length - 1 ? 1 : 2));
}

function velocityAt(frames, index, id) {
  const previous = frames[Math.max(0, index - 1)];
  const next = frames[Math.min(frames.length - 1, index + 1)];
  const delta = Math.max(1 / 240, next.time - previous.time);
  const first = previous.anchors?.[id] ?? [0, 0, 0];
  const second = next.anchors?.[id] ?? first;
  return subtract(second, first).map((value) => value / delta);
}

function angularVelocityAt(frames, index, id) {
  const previous = frames[Math.max(0, index - 1)];
  const next = frames[Math.min(frames.length - 1, index + 1)];
  const delta = Math.max(1 / 240, next.time - previous.time);
  return quaternionAngle(previous.rotations?.[id], next.rotations?.[id]) / delta;
}

function accelerationAt(frames, index, id) {
  if (frames.length < 3) return 0;
  const previousVelocity = velocityAt(frames, Math.max(0, index - 1), id);
  const nextVelocity = velocityAt(frames, Math.min(frames.length - 1, index + 1), id);
  return length(subtract(nextVelocity, previousVelocity)) / Math.max(1 / 240, frameDelta(frames, index) * 2);
}

function curveOpportunityAt(frames, index, id, bodyHeight) {
  if (index <= 0 || index >= frames.length - 1) return 0;
  const previous = subtract(
    frames[index].anchors?.[id],
    frames[index - 1].anchors?.[id]
  );
  const next = subtract(
    frames[index + 1].anchors?.[id],
    frames[index].anchors?.[id]
  );
  const previousLength = length(previous);
  const nextLength = length(next);
  if (previousLength < 0.00001 || nextLength < 0.00001) return 0;
  const cosine = clamp(dot(previous, next) / (previousLength * nextLength), -1, 1);
  const turn = Math.acos(cosine) / Math.PI;
  const speedGate = clamp(((previousLength + nextLength) * 0.5) / Math.max(0.0001, bodyHeight * 0.015));
  return turn * speedGate;
}

function synchronousPairScore(firstSpeed, secondSpeed) {
  const activity = firstSpeed + secondSpeed;
  if (activity < 0.00001) return 1;
  return 1 - Math.abs(firstSpeed - secondSpeed) / activity;
}

function axisPointProximityAt(frame, bodyHeight) {
  const explicitPoints = Object.entries(frame.axisPoints ?? {}).filter(
    ([, point]) => Array.isArray(point) && point.length >= 3
  );
  const points = explicitPoints.length >= 2
    ? explicitPoints
    : ATTENTION_IDS.map((id) => [id, frame.anchors?.[id]]).filter(([, point]) => point);
  if (points.length < 2) return 0;

  const proximityScale = bodyHeight * 0.18;
  const nearestScores = new Array(points.length).fill(0);
  let strongestProximity = 0;
  for (let firstIndex = 0; firstIndex < points.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < points.length; secondIndex += 1) {
      const [firstId, firstPoint] = points[firstIndex];
      const [secondId, secondPoint] = points[secondIndex];
      const pairKey = [firstId, secondId].sort().join('|');
      if (AXIS_STRUCTURAL_PAIR_KEYS.has(pairKey)) continue;
      const distance = length(subtract(firstPoint, secondPoint));
      const distanceRatio = distance / Math.max(0.000001, proximityScale);
      const proximity = 1 / (1 + distanceRatio * distanceRatio * distanceRatio);
      strongestProximity = Math.max(strongestProximity, proximity);
      nearestScores[firstIndex] = Math.max(nearestScores[firstIndex], proximity);
      nearestScores[secondIndex] = Math.max(nearestScores[secondIndex], proximity);
    }
  }
  const coverage = nearestScores.reduce((total, score) => total + score, 0) / nearestScores.length;
  return clamp(strongestProximity * 0.8 + coverage * 0.2);
}

function computeSpaceEnvelope(frame, bodyHeight) {
  const points = ATTENTION_IDS.map((id) => frame.anchors?.[id]).filter(Boolean);
  if (!points.length) return 0;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  let maximumReach = 0;
  for (const point of points) {
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis], point[axis]);
      maximum[axis] = Math.max(maximum[axis], point[axis]);
    }
    maximumReach = Math.max(maximumReach, length(point));
  }
  const span = subtract(maximum, minimum);
  return (span[0] * 0.42 + span[1] * 0.16 + span[2] * 0.42 + maximumReach * 0.55) / Math.max(0.0001, bodyHeight);
}

export function analyzeNo60ElementFrames(frames, options = {}) {
  const safeFrames = Array.isArray(frames) ? frames.filter((frame) => Number.isFinite(frame?.time)) : [];
  const bodyHeight = Math.max(0.0001, Number(options.bodyHeight) || 3);
  if (!safeFrames.length) return { duration: 0, samples: [] };

  const energyRaw = [];
  const curvesRaw = [];
  const axesScores = [];
  const syncScores = [];
  const spaceRaw = [];

  safeFrames.forEach((frame, index) => {
    const speeds = Object.fromEntries(ATTENTION_IDS.map((id) => [
      id,
      length(velocityAt(safeFrames, index, id))
    ]));
    const meanSpeed = ATTENTION_IDS.reduce((total, id) => total + speeds[id], 0) / ATTENTION_IDS.length;
    const meanAcceleration = ATTENTION_IDS.reduce(
      (total, id) => total + accelerationAt(safeFrames, index, id),
      0
    ) / ATTENTION_IDS.length;
    const angularVelocities = ROTATION_IDS.map((id) => angularVelocityAt(safeFrames, index, id));
    const meanAngularVelocity = angularVelocities.reduce((total, value) => total + value, 0)
      / Math.max(1, angularVelocities.length);
    const hipTravel = length(velocityAt(safeFrames, index, '__hips'));
    energyRaw.push(
      meanSpeed / bodyHeight
        + meanAcceleration / bodyHeight * 0.055
        + meanAngularVelocity * 0.085
        + hipTravel / bodyHeight * 0.2
    );

    curvesRaw.push(DISTAL_IDS.reduce(
      (total, id) => total + curveOpportunityAt(safeFrames, index, id, bodyHeight),
      0
    ) / DISTAL_IDS.length);

    axesScores.push(axisPointProximityAt(frame, bodyHeight) * 100);

    const pairs = [
      ['leftHand', 'rightHand'],
      ['leftArm', 'rightArm'],
      ['leftLeg', 'rightLeg'],
      ['leftFoot', 'rightFoot']
    ];
    const pairAgreement = pairs.reduce(
      (total, [left, right]) => total + synchronousPairScore(speeds[left], speeds[right]),
      0
    ) / pairs.length;
    syncScores.push(pairAgreement * 100);

    spaceRaw.push(computeSpaceEnvelope(frame, bodyHeight));
  });

  const smoothedSync = smooth(syncScores, 2).map((value) => clamp(value, 0, 100));

  const normalized = {
    energy: normalizeActivity(energyRaw),
    curves: normalizeActivity(curvesRaw),
    axes: smooth(axesScores, 2).map((value) => clamp(value, 0, 100)),
    sync: smoothedSync,
    space: normalizeRange(spaceRaw),
    relations: smoothedSync.map((value) => 100 - value)
  };

  const samples = safeFrames.map((frame, index) => ({
    time: frame.time,
    ...Object.fromEntries(
      NO60_ELEMENT_ANALYSIS_DEFINITIONS.map(({ id }) => [id, normalized[id][index]])
    )
  }));
  return {
    duration: Math.max(0, safeFrames.at(-1).time - safeFrames[0].time),
    samples
  };
}

function getDominantElementId(sample, ids) {
  return ids.reduce(
    (best, id) => (Number(sample?.[id]) || 0) > (Number(sample?.[best]) || 0) ? id : best,
    ids[0]
  );
}

function collectDominanceRuns(labels) {
  const runs = [];
  labels.forEach((id, index) => {
    const previous = runs.at(-1);
    if (previous?.id === id) previous.endIndex = index;
    else runs.push({ id, startIndex: index, endIndex: index });
  });
  return runs;
}

export function buildNo60DominanceSegments(analysis, options = {}) {
  const samples = analysis?.samples ?? [];
  if (!samples.length) return [];
  const knownIds = new Set(NO60_ELEMENT_ANALYSIS_DEFINITIONS.map(({ id }) => id));
  const ids = Array.isArray(options.ids)
    ? options.ids.filter((id) => knownIds.has(id))
    : [...knownIds];
  if (!ids.length) return [];
  const switchMargin = Math.max(0, Number(options.switchMargin) || 6);
  const minimumRun = Math.max(
    1,
    Math.round(Number(options.minimumRun) || Math.max(2, samples.length * 0.012))
  );

  let activeId = getDominantElementId(samples[0], ids);
  const labels = samples.map((sample) => {
    const candidateId = getDominantElementId(sample, ids);
    const candidateScore = Number(sample[candidateId]) || 0;
    const activeScore = Number(sample[activeId]) || 0;
    if (candidateId !== activeId && candidateScore >= activeScore + switchMargin) {
      activeId = candidateId;
    }
    return activeId;
  });

  // Absorb short-lived winners into the stronger neighboring section. This
  // keeps the summary readable without hiding sustained element changes.
  for (let pass = 0; pass < 3; pass += 1) {
    const runs = collectDominanceRuns(labels);
    let changed = false;
    runs.forEach((run, runIndex) => {
      const length = run.endIndex - run.startIndex + 1;
      if (length >= minimumRun || runs.length === 1) return;
      const previousId = runs[runIndex - 1]?.id;
      const nextId = runs[runIndex + 1]?.id;
      let replacementId = previousId ?? nextId;
      if (previousId && nextId && previousId !== nextId) {
        const mean = (id) => {
          let total = 0;
          for (let index = run.startIndex; index <= run.endIndex; index += 1) {
            total += Number(samples[index]?.[id]) || 0;
          }
          return total / length;
        };
        replacementId = mean(previousId) >= mean(nextId) ? previousId : nextId;
      }
      if (!replacementId) return;
      for (let index = run.startIndex; index <= run.endIndex; index += 1) {
        labels[index] = replacementId;
      }
      changed = true;
    });
    if (!changed) break;
  }

  const denominator = Math.max(1, samples.length - 1);
  return collectDominanceRuns(labels).map((run) => {
    let total = 0;
    for (let index = run.startIndex; index <= run.endIndex; index += 1) {
      total += Number(samples[index]?.[run.id]) || 0;
    }
    const count = run.endIndex - run.startIndex + 1;
    return {
      ...run,
      startProgress: run.startIndex === 0 ? 0 : (run.startIndex - 0.5) / denominator,
      endProgress: run.endIndex === samples.length - 1 ? 1 : (run.endIndex + 0.5) / denominator,
      percentage: clamp(total / Math.max(1, count), 0, 100)
    };
  });
}

export function interpolateNo60ElementSample(analysis, progress) {
  const samples = analysis?.samples ?? [];
  if (!samples.length) return null;
  const position = clamp(progress) * (samples.length - 1);
  const firstIndex = Math.floor(position);
  const secondIndex = Math.min(samples.length - 1, firstIndex + 1);
  const blend = position - firstIndex;
  const first = samples[firstIndex];
  const second = samples[secondIndex];
  return {
    time: first.time * (1 - blend) + second.time * blend,
    ...Object.fromEntries(NO60_ELEMENT_ANALYSIS_DEFINITIONS.map(({ id }) => [
      id,
      first[id] * (1 - blend) + second[id] * blend
    ]))
  };
}
