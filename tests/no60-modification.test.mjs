import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  applyNo60Modifications,
  createDefaultNo60ModificationValues,
  createNo60ModificationRuntime,
  getNo60BoneRegionTags,
  resolveNo60ModificationValue
} from '../src/no60-modification.js';

function createRig() {
  const root = new THREE.Group();
  const bones = {};
  const add = (name, parent = root) => {
    const bone = new THREE.Bone();
    bone.name = name;
    parent.add(bone);
    bones[name] = bone;
    return bone;
  };

  const hips = add('Hips');
  const spine = add('Spine', hips);
  add('Head', spine);
  const leftArm = add('LeftArm', spine);
  add('LeftForeArm', leftArm);
  const rightArm = add('RightArm', spine);
  add('RightForeArm', rightArm);
  const leftUpLeg = add('LeftUpLeg', hips);
  add('LeftLeg', leftUpLeg);
  const rightUpLeg = add('RightUpLeg', hips);
  add('RightLeg', rightUpLeg);
  return { root, bones };
}

function angleAroundX(radians) {
  return new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), radians);
}

function assertNear(actual, expected, tolerance = 0.001, message = '') {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message} (${actual} vs ${expected})`);
}

function testRegionTags() {
  assert.deepEqual(new Set(getNo60BoneRegionTags('mixamorig:Hips')), new Set(['whole', 'torso']));
  assert.deepEqual(
    new Set(getNo60BoneRegionTags('mixamorig:Spine')),
    new Set(['whole', 'upper', 'torso'])
  );
  assert.deepEqual(
    new Set(getNo60BoneRegionTags('mixamorig:LeftArm')),
    new Set(['whole', 'upper', 'arms', 'leftArm'])
  );
  assert.deepEqual(
    new Set(getNo60BoneRegionTags('mixamorig:RightUpLeg')),
    new Set(['whole', 'lower', 'legs', 'rightLeg'])
  );
}

function testRegionalResolver() {
  const cases = [
    ['energy', 'upper', 'Spine', 'LeftUpLeg', 200],
    ['energy', 'lower', 'LeftUpLeg', 'Spine', 200],
    ['energy', 'leftArm', 'LeftArm', 'RightArm', 200],
    ['energy', 'rightArm', 'RightArm', 'LeftArm', 200],
    ['energy', 'leftLeg', 'LeftUpLeg', 'RightUpLeg', 200],
    ['energy', 'rightLeg', 'RightUpLeg', 'LeftUpLeg', 200],
    ['curves', 'leftArm', 'LeftArm', 'RightArm', 200],
    ['curves', 'rightArm', 'RightArm', 'LeftArm', 200],
    ['curves', 'leftLeg', 'LeftUpLeg', 'RightUpLeg', 200],
    ['curves', 'rightLeg', 'RightUpLeg', 'LeftUpLeg', 200],
    ['axes', 'arms', 'LeftArm', 'LeftUpLeg', 200],
    ['axes', 'legs', 'LeftUpLeg', 'LeftArm', 200],
    ['sync', 'arms', 'LeftArm', 'LeftUpLeg', 200],
    ['sync', 'legs', 'LeftUpLeg', 'LeftArm', 200],
    ['space', 'arms', 'LeftArm', 'LeftUpLeg', 200],
    ['space', 'legs', 'LeftUpLeg', 'LeftArm', 200],
    ['body', 'torso', 'Spine', 'LeftArm', 90],
    ['body', 'arms', 'LeftArm', 'LeftUpLeg', 90],
    ['body', 'legs', 'LeftUpLeg', 'LeftArm', 90]
  ];

  for (const [element, region, targetBone, controlBone, changedValue] of cases) {
    const values = createDefaultNo60ModificationValues();
    values[element][region] = changedValue;
    const target = resolveNo60ModificationValue(
      values,
      element,
      getNo60BoneRegionTags(targetBone)
    );
    const control = resolveNo60ModificationValue(
      values,
      element,
      getNo60BoneRegionTags(controlBone)
    );
    assert.equal(target, changedValue, `${element}.${region} should reach ${targetBone}`);
    assert.equal(
      control,
      element === 'body' ? 0 : 100,
      `${element}.${region} should not leak into ${controlBone}`
    );
  }
}

function testRegionalEnergyClocks() {
  const { root, bones } = createRig();
  const times = [0, 1, 2];
  const values = times.flatMap((time) => angleAroundX(time * 0.6).toArray());
  const tracks = Object.keys(bones).map(
    (name) => new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, times, values)
  );
  const clip = new THREE.AnimationClip('regional-energy', 2, tracks);
  const runtime = createNo60ModificationRuntime(root, clip, 0);
  const settings = createDefaultNo60ModificationValues();
  settings.energy.upper = 200;

  applyNo60Modifications({
    runtime,
    values: settings,
    actionTime: 0,
    delta: 0.1,
    advanceEnergy: false
  });
  for (const bone of Object.values(bones)) bone.quaternion.copy(angleAroundX(0.06));
  applyNo60Modifications({
    runtime,
    values: settings,
    actionTime: 0.1,
    delta: 0.1,
    advanceEnergy: true
  });

  const byName = Object.fromEntries(runtime.entries.map((entry) => [entry.name, entry]));
  assertNear(byName.Spine.energyTime, 0.2, 0.0001, 'Upper-body clock should run at 2x');
  assertNear(byName.LeftArm.energyTime, 0.2, 0.0001, 'Arm should inherit Upper Body');
  assertNear(byName.LeftUpLeg.energyTime, 0.1, 0.0001, 'Leg should stay on Full Body clock');
  assertNear(byName.Hips.energyTime, 0.1, 0.0001, 'Pelvis should stay on Full Body clock');
}

function applySingleEffect(element, region, value, setup = () => {}) {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values[element][region] = value;
  setup(bones, runtime);
  applyNo60Modifications({ runtime, values, delta: 0.1 });
  return bones;
}

function testDeterministicRegionalApplications() {
  const curves = applySingleEffect('curves', 'leftArm', 0, (bones) => {
    bones.LeftArm.quaternion.copy(angleAroundX(1));
    bones.RightArm.quaternion.copy(angleAroundX(1));
  });
  assertNear(
    curves.LeftArm.quaternion.angleTo(new THREE.Quaternion()),
    1,
    0.001,
    'Straightening should preserve a held source pose rather than collapsing toward rest'
  );
  assertNear(curves.RightArm.quaternion.angleTo(new THREE.Quaternion()), 1, 0.001);

  const axes = applySingleEffect('axes', 'arms', 0, (bones) => {
    bones.LeftArm.quaternion.copy(angleAroundX(1));
    bones.LeftUpLeg.quaternion.copy(angleAroundX(1));
  });
  assert.ok(axes.LeftArm.quaternion.angleTo(new THREE.Quaternion()) < 0.4);
  assertNear(axes.LeftUpLeg.quaternion.angleTo(new THREE.Quaternion()), 1, 0.001);

  const space = applySingleEffect('space', 'arms', 0, (bones) => {
    bones.LeftArm.quaternion.copy(angleAroundX(1));
    bones.LeftUpLeg.quaternion.copy(angleAroundX(1));
  });
  assertNear(space.LeftArm.quaternion.angleTo(new THREE.Quaternion()), 0.32, 0.01);
  assertNear(space.LeftUpLeg.quaternion.angleTo(new THREE.Quaternion()), 1, 0.001);

  const body = applySingleEffect('body', 'arms', 90);
  assert.ok(body.LeftArm.quaternion.angleTo(new THREE.Quaternion()) > 1.5);
  assertNear(body.LeftUpLeg.quaternion.angleTo(new THREE.Quaternion()), 0, 0.001);
}

function testCircularTravelSmoothsReversalsAndBoundaries() {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.curves.leftArm = 200;
  const delta = 1 / 60;
  const sourceAxis = new THREE.Vector3(1, 0, 0);
  let sourceAngle = 0;
  let previousOutput = bones.LeftArm.quaternion.clone();
  let maximumContinuousStep = 0;
  let maximumCurveMomentum = 0;
  let curveBeforeBoundary = null;
  let curveAfterBoundary = null;

  for (let frame = 0; frame < 150; frame += 1) {
    const direction = frame < 72 ? 1 : -1;
    sourceAngle += frame === 105 ? 2.15 : direction * 0.045;
    sourceAxis.set(
      1,
      Math.sin(frame * 0.07) * 0.18,
      Math.cos(frame * 0.053) * 0.12
    ).normalize();
    bones.LeftArm.quaternion.setFromAxisAngle(sourceAxis, sourceAngle);
    if (frame === 105) {
      const entry = runtime.entries.find(({ name }) => name === 'LeftArm');
      curveBeforeBoundary = entry.curveRotation.clone();
    }
    applyNo60Modifications({ runtime, values, delta });
    const currentEntry = runtime.entries.find(({ name }) => name === 'LeftArm');
    if (frame > 12 && frame < 105) {
      maximumCurveMomentum = Math.max(
        maximumCurveMomentum,
        currentEntry.curveRotation.angleTo(new THREE.Quaternion())
      );
    }
    const outputStep = previousOutput.angleTo(bones.LeftArm.quaternion);
    if (frame > 8 && frame !== 105) maximumContinuousStep = Math.max(maximumContinuousStep, outputStep);
    if (frame === 105) {
      const entry = runtime.entries.find(({ name }) => name === 'LeftArm');
      curveAfterBoundary = entry.curveRotation.clone();
    }
    previousOutput.copy(bones.LeftArm.quaternion);
  }

  const leftArm = runtime.entries.find(({ name }) => name === 'LeftArm');
  assert.ok(leftArm.curveAxisReady, 'A coherent curved path should retain a filtered axis');
  assert.ok(
    maximumContinuousStep < 0.55,
    `Curved motion should not create a large frame-to-frame rotation (${maximumContinuousStep})`
  );
  assert.ok(
    maximumCurveMomentum > 0.15,
    'Higher curvature should accumulate visible circular momentum'
  );
  assert.ok(
    curveBeforeBoundary.angleTo(curveAfterBoundary) < 0.12,
    'A seek or loop-sized source jump should not clear the accumulated curve'
  );
}

function testCircularTravelPreservesSkeletonStructure() {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.curves.whole = 200;
  const curveRoots = new Set(['LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg']);
  const originalPositions = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, bone.position.clone()])
  );
  const originalScales = Object.fromEntries(
    Object.entries(bones).map(([name, bone]) => [name, bone.scale.clone()])
  );
  const previousOutputs = Object.fromEntries(
    [...curveRoots].map((name) => [name, bones[name].quaternion.clone()])
  );
  let maximumAddedRotation = 0;
  let maximumContinuousStep = 0;
  let maximumSecondaryComponent = 0;

  for (let frame = 0; frame < 300; frame += 1) {
    const sourceAngle = Math.sin(frame * 0.052) * 0.92;
    const sources = {};
    for (const [index, [name, bone]] of Object.entries(bones).entries()) {
      const source = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          sourceAngle * (0.72 + index * 0.025),
          Math.sin(frame * 0.031 + index * 0.2) * 0.08,
          0,
          'XYZ'
        )
      );
      bone.quaternion.copy(source);
      sources[name] = source;
    }
    applyNo60Modifications({ runtime, values, delta: 1 / 60 });

    for (const [name, bone] of Object.entries(bones)) {
      assert.ok(
        bone.position.equals(originalPositions[name]),
        `${name} position must not be changed by Circle + Curve`
      );
      assert.ok(
        bone.scale.equals(originalScales[name]),
        `${name} scale must not be changed by Circle + Curve`
      );
      if (!curveRoots.has(name)) {
        assertNear(
          bone.quaternion.angleTo(sources[name]),
          0,
          0.0001,
          `${name} local rotation should remain on the source animation`
        );
        continue;
      }
      maximumAddedRotation = Math.max(
        maximumAddedRotation,
        bone.quaternion.angleTo(sources[name])
      );
      if (frame > 30) {
        maximumContinuousStep = Math.max(
          maximumContinuousStep,
          previousOutputs[name].angleTo(bone.quaternion)
        );
      }
      previousOutputs[name].copy(bone.quaternion);
    }

    const leftArm = runtime.entries.find(({ name }) => name === 'LeftArm');
    maximumSecondaryComponent = Math.max(
      maximumSecondaryComponent,
      Math.abs(leftArm.curveRotation.y),
      Math.abs(leftArm.curveRotation.z)
    );
  }

  assert.ok(
    maximumAddedRotation < 0.55,
    `Circular travel must remain bounded instead of twisting the limb (${maximumAddedRotation})`
  );
  assert.ok(
    maximumContinuousStep < 0.18,
    `Circular travel should stay smooth through reversals (${maximumContinuousStep})`
  );
  assert.ok(
    maximumSecondaryComponent > 0.04,
    'The bounded modifier should use a second axis to create a genuinely round path'
  );
}

function measureCircularResponse(value) {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.curves.leftArm = value;
  let maximumAmplitude = 0;
  let accumulatedPhaseTravel = 0;
  let accumulatedMicroPhaseTravel = 0;
  let accumulatedOpportunity = 0;
  let opportunitySamples = 0;
  let previousPhase = 0;
  let previousMicroPhase = 0;

  for (let frame = 0; frame < 300; frame += 1) {
    bones.LeftArm.quaternion.copy(angleAroundX(Math.sin(frame * 0.052) * 0.92));
    applyNo60Modifications({ runtime, values, delta: 1 / 60 });
    const entry = runtime.entries.find(({ name }) => name === 'LeftArm');
    if (frame > 60) {
      maximumAmplitude = Math.max(maximumAmplitude, entry.curveOrbitAmplitude);
      accumulatedPhaseTravel += THREE.MathUtils.euclideanModulo(
        entry.curvePhase - previousPhase,
        Math.PI * 2
      );
      accumulatedMicroPhaseTravel += THREE.MathUtils.euclideanModulo(
        entry.curveMicroPhase - previousMicroPhase,
        Math.PI * 2
      );
      accumulatedOpportunity += entry.curveOpportunity;
      opportunitySamples += 1;
    }
    previousPhase = entry.curvePhase;
    previousMicroPhase = entry.curveMicroPhase;
  }
  return {
    maximumAmplitude,
    accumulatedPhaseTravel,
    accumulatedMicroPhaseTravel,
    averageOpportunity: opportunitySamples ? accumulatedOpportunity / opportunitySamples : 0
  };
}

function testCircularTravelHasPerceptuallyProgressiveStrength() {
  const subtle = measureCircularResponse(109);
  const medium = measureCircularResponse(150);
  const maximum = measureCircularResponse(200);

  assert.ok(
    subtle.maximumAmplitude > 0.07,
    `109% should already create a visible circular radius (${subtle.maximumAmplitude})`
  );
  assert.ok(
    medium.maximumAmplitude > subtle.maximumAmplitude * 1.35,
    '150% should be clearly more circular than 109%'
  );
  assert.ok(
    maximum.maximumAmplitude > medium.maximumAmplitude * 1.18,
    '200% should be clearly more circular than 150%'
  );
  assert.ok(
    maximum.accumulatedPhaseTravel > subtle.accumulatedPhaseTravel * 1.55,
    'Higher values should complete substantially more primary circles'
  );
  assert.ok(
    maximum.accumulatedMicroPhaseTravel > maximum.accumulatedPhaseTravel * 2.4,
    'At 200%, a broad orbit should subdivide into multiple smaller circular loops'
  );
  assert.ok(
    maximum.averageOpportunity > 0.42,
    'A nearly single-axis source passage should become a usable circular opportunity'
  );
}

function measureStraightenedAxisTurning(value) {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.curves.leftArm = value;
  const previousOutput = new THREE.Quaternion();
  const previousAxis = new THREE.Vector3();
  const currentAxis = new THREE.Vector3();
  const deltaQuaternion = new THREE.Quaternion();
  let axisReady = false;
  let accumulatedAxisTurn = 0;
  let axisSamples = 0;
  let accumulatedTravel = 0;

  for (let frame = 0; frame < 420; frame += 1) {
    const time = frame * 0.032;
    const source = new THREE.Quaternion().setFromEuler(new THREE.Euler(
      Math.sin(time) * 0.78,
      Math.cos(time * 0.63) * 0.46,
      Math.sin(time * 0.41 + 0.6) * 0.3,
      'XYZ'
    ));
    bones.LeftArm.quaternion.copy(source);
    applyNo60Modifications({ runtime, values, delta: 1 / 60 });

    if (frame > 20) {
      deltaQuaternion.copy(previousOutput).invert().multiply(bones.LeftArm.quaternion).normalize();
      if (deltaQuaternion.w < 0) {
        deltaQuaternion.set(
          -deltaQuaternion.x,
          -deltaQuaternion.y,
          -deltaQuaternion.z,
          -deltaQuaternion.w
        );
      }
      const angle = 2 * Math.acos(THREE.MathUtils.clamp(deltaQuaternion.w, -1, 1));
      const sine = Math.sqrt(Math.max(0, 1 - deltaQuaternion.w ** 2));
      if (angle > 0.0001 && sine > 0.00001) {
        currentAxis.set(
          deltaQuaternion.x / sine,
          deltaQuaternion.y / sine,
          deltaQuaternion.z / sine
        ).normalize();
        if (axisReady) {
          accumulatedAxisTurn += Math.acos(THREE.MathUtils.clamp(
            Math.abs(previousAxis.dot(currentAxis)),
            0,
            1
          ));
          axisSamples += 1;
        }
        previousAxis.copy(currentAxis);
        axisReady = true;
        accumulatedTravel += angle;
      }
    }
    previousOutput.copy(bones.LeftArm.quaternion);
  }
  return {
    averageAxisTurn: axisSamples ? accumulatedAxisTurn / axisSamples : 0,
    accumulatedTravel
  };
}

function testLowerCircleValuesRemoveCurvatureWithoutCollapsingPoses() {
  const linear = measureStraightenedAxisTurning(0);
  const softened = measureStraightenedAxisTurning(50);
  const source = measureStraightenedAxisTurning(100);
  assert.ok(
    linear.averageAxisTurn < source.averageAxisTurn * 0.68,
    `0% should remove most changes in the source motion axis (${linear.averageAxisTurn} vs ${source.averageAxisTurn})`
  );
  assert.ok(
    softened.averageAxisTurn > linear.averageAxisTurn
      && softened.averageAxisTurn < source.averageAxisTurn,
    `50% should retain an intermediate amount of source curvature (${linear.averageAxisTurn}, ${softened.averageAxisTurn}, ${source.averageAxisTurn})`
  );
  assert.ok(
    linear.accumulatedTravel > source.accumulatedTravel * 0.35,
    `Straightening should retain meaningful travel instead of freezing the limb (${linear.accumulatedTravel} vs ${source.accumulatedTravel})`
  );

  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.curves.leftArm = 0;
  const heldPose = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.72, 0.34, -0.18));
  for (let frame = 0; frame < 45; frame += 1) {
    bones.LeftArm.quaternion.copy(heldPose);
    applyNo60Modifications({ runtime, values, delta: 1 / 60 });
  }
  assert.ok(
    bones.LeftArm.quaternion.angleTo(heldPose) < 0.015,
    'Removing curvature must keep held source poses intact'
  );
}

function runSynchronicExtreme(value) {
  const { root, bones } = createRig();
  const clipDuration = 2;
  const times = Array.from({ length: 17 }, (_, index) => index * clipDuration / 16);
  const quaternionValues = times.flatMap((time) => (
    angleAroundX(Math.sin(time / clipDuration * Math.PI * 2) * 0.82).toArray()
  ));
  const tracks = Object.keys(bones).map(
    (name) => new THREE.QuaternionKeyframeTrack(
      `${name}.quaternion`,
      times,
      quaternionValues
    )
  );
  const clip = new THREE.AnimationClip('smooth-synchronic-loop', clipDuration, tracks);
  const sourceInterpolant = tracks[0].createInterpolant();
  const runtime = createNo60ModificationRuntime(root, clip, 0);
  const values = createDefaultNo60ModificationValues();
  values.sync.whole = value;
  const frameCount = 360;
  const delta = 1 / 60;
  const trackedNames = ['Spine', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg'];
  const previous = Object.fromEntries(
    trackedNames.map((name) => [name, bones[name].quaternion.clone()])
  );
  const maximumSteps = Object.fromEntries(trackedNames.map((name) => [name, 0]));
  let settledOffsets = null;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const actionTime = (frame * delta) % clipDuration;
    const sample = sourceInterpolant.evaluate(actionTime);
    const source = new THREE.Quaternion(sample[0], sample[1], sample[2], sample[3]).normalize();
    for (const bone of Object.values(bones)) bone.quaternion.copy(source);
    applyNo60Modifications({ runtime, values, delta, actionTime });

    for (const name of trackedNames) {
      if (frame > 180) {
        maximumSteps[name] = Math.max(
          maximumSteps[name],
          previous[name].angleTo(bones[name].quaternion)
        );
      }
      previous[name].copy(bones[name].quaternion);
    }
    if (frame === 240) {
      settledOffsets = Object.fromEntries(
        runtime.entries.map((entry) => [entry.name, entry.syncPhaseOffset])
      );
    }
  }

  const offsets = Object.fromEntries(
    runtime.entries.map((entry) => [entry.name, entry.syncPhaseOffset])
  );
  return {
    offsets,
    settledOffsets,
    maximumSteps
  };
}

function testSynchronicScaleUsesSmoothLoopingPhaseOffsets() {
  const asynchronous = runSynchronicExtreme(0);
  const neutral = runSynchronicExtreme(100);
  const rightBehind = runSynchronicExtreme(200);

  const asynchronousOffsets = [
    asynchronous.offsets.Spine,
    asynchronous.offsets.LeftArm,
    asynchronous.offsets.RightArm,
    asynchronous.offsets.LeftUpLeg,
    asynchronous.offsets.RightUpLeg
  ];
  assert.ok(
    asynchronousOffsets.every((offset) => offset > 0.1),
    `0% should give every major body region a looping phase offset (${asynchronousOffsets.join(', ')})`
  );
  assert.ok(
    new Set(asynchronousOffsets.map((offset) => offset.toFixed(2))).size === 5,
    `0% should give the five major regions different start times (${asynchronousOffsets.join(', ')})`
  );
  for (const name of ['Spine', 'LeftArm', 'RightArm', 'LeftUpLeg', 'RightUpLeg']) {
    assert.ok(
      asynchronous.maximumSteps[name] < 0.12,
      `The ${name} track should run smoothly through its independent loop (${asynchronous.maximumSteps[name]})`
    );
    assertNear(
      asynchronous.offsets[name],
      asynchronous.settledOffsets[name],
      0.003,
      `The ${name} phase should stay fixed instead of drifting`
    );
    assertNear(neutral.offsets[name], 0, 0.001, `100% should preserve ${name} timing`);
  }
  assertNear(rightBehind.offsets.Spine, 0, 0.001, '200% should leave the torso current');
  assertNear(rightBehind.offsets.LeftArm, 0, 0.001, '200% should leave the left arm current');
  assertNear(rightBehind.offsets.LeftUpLeg, 0, 0.001, '200% should leave the left leg current');
  assert.ok(rightBehind.offsets.RightArm > 0.6, '200% should place the right arm behind');
  assert.ok(rightBehind.offsets.RightUpLeg > 0.6, '200% should place the right leg behind');
  assert.ok(
    rightBehind.maximumSteps.RightArm < 0.12
      && rightBehind.maximumSteps.RightUpLeg < 0.12,
    'The 200% right-side lag should also loop smoothly'
  );
}

function testShiftingRelationCrossfade() {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.relations.whole = 200;
  const delta = 1 / 60;
  let leftSourceAngle = 0;
  let rightSourceAngle = 0;
  let previousFocus = null;
  let previousRightOutput = bones.RightArm.quaternion.clone();
  let switchDelta = Infinity;
  let switched = false;

  for (let frame = 0; frame < 150; frame += 1) {
    if (frame < 55) {
      leftSourceAngle += 0.045;
      rightSourceAngle += 0.005;
    } else {
      leftSourceAngle += 0.002;
      rightSourceAngle += 0.055;
    }
    bones.LeftArm.quaternion.copy(angleAroundX(leftSourceAngle));
    bones.RightArm.quaternion.copy(angleAroundX(rightSourceAngle));
    applyNo60Modifications({ runtime, values, delta });

    if (
      previousFocus === 'leftArm'
      && runtime.relationFocusRegion === 'rightArm'
    ) {
      switched = true;
      switchDelta = previousRightOutput.angleTo(bones.RightArm.quaternion);
      break;
    }
    previousFocus = runtime.relationFocusRegion;
    previousRightOutput.copy(bones.RightArm.quaternion);
  }

  assert.ok(switched, 'Sustained right-arm motion should eventually receive attention');
  assert.ok(
    switchDelta < 0.2,
    `Attention handoff should crossfade instead of snapping (${switchDelta} radians)`
  );
  const entries = Object.fromEntries(runtime.entries.map((entry) => [entry.name, entry]));
  assert.ok(entries.LeftArm.relationDrag > 0 && entries.LeftArm.relationDrag < 1);
  assert.ok(entries.RightArm.relationDrag > 0 && entries.RightArm.relationDrag < 1);
}

function testShiftingRelationUsesDifferentialRates() {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.relations.whole = 200;
  const delta = 1 / 60;
  const leftSourceStep = 0.06;
  const rightSourceStep = 0.02;
  let leftSourceAngle = 0;
  let rightSourceAngle = 0;
  let previousLeftOutput = bones.LeftArm.quaternion.clone();
  let previousRightOutput = bones.RightArm.quaternion.clone();
  const leftOutputSteps = [];
  const rightOutputSteps = [];

  for (let frame = 0; frame < 180; frame += 1) {
    leftSourceAngle += leftSourceStep;
    rightSourceAngle += rightSourceStep;
    bones.LeftArm.quaternion.copy(angleAroundX(leftSourceAngle));
    bones.RightArm.quaternion.copy(angleAroundX(rightSourceAngle));
    applyNo60Modifications({ runtime, values, delta });

    if (frame >= 150) {
      leftOutputSteps.push(previousLeftOutput.angleTo(bones.LeftArm.quaternion));
      rightOutputSteps.push(previousRightOutput.angleTo(bones.RightArm.quaternion));
    }
    previousLeftOutput.copy(bones.LeftArm.quaternion);
    previousRightOutput.copy(bones.RightArm.quaternion);
  }

  const average = (samples) => samples.reduce((sum, sample) => sum + sample, 0) / samples.length;
  const leftRate = average(leftOutputSteps) / leftSourceStep;
  const rightRate = average(rightOutputSteps) / rightSourceStep;
  const entries = Object.fromEntries(runtime.entries.map((entry) => [entry.name, entry]));

  assert.equal(runtime.relationFocusRegion, 'leftArm');
  assertNear(leftRate, 1.5, 0.03, 'Focused region should move at 1.5x');
  assertNear(rightRate, 0.5, 0.03, 'Non-focused region should move at 0.5x');
  assertNear(entries.LeftArm.relationSpeedScale, 1.5, 0.01);
  assertNear(entries.RightArm.relationSpeedScale, 0.5, 0.01);
}

function testExtendedSpaceHoldDuration() {
  const { root, bones } = createRig();
  const runtime = createNo60ModificationRuntime(root);
  const values = createDefaultNo60ModificationValues();
  values.space.arms = 200;
  const delta = 1 / 60;
  let sourceAngle = 0;

  // Move decisively into an extended arm pose so the endpoint detector is armed.
  for (let frame = 0; frame < 14; frame += 1) {
    sourceAngle += 0.07;
    bones.LeftArm.quaternion.copy(angleAroundX(sourceAngle));
    applyNo60Modifications({ runtime, values, delta });
  }
  // The first low-velocity frame at the extended pose should begin the stop.
  bones.LeftArm.quaternion.copy(angleAroundX(sourceAngle));
  applyNo60Modifications({ runtime, values, delta });

  const leftArm = runtime.entries.find((entry) => entry.name === 'LeftArm');
  const rightArm = runtime.entries.find((entry) => entry.name === 'RightArm');
  assert.ok(leftArm.spaceHoldWeight > 0, 'Extended arm should ease into a held pose');
  assert.ok(
    leftArm.spaceHoldRemaining > 3.5,
    `External-space endpoint stop should use a long staged duration (${leftArm.spaceHoldRemaining})`
  );
  assertNear(
    leftArm.spaceHoldRemaining,
    rightArm.spaceHoldRemaining,
    0.0001,
    'External-space stops should hold the affected pose as one synchronized shape'
  );

  // A static endpoint must not repeatedly restart the hold after it finishes.
  for (let frame = 0; frame < 260; frame += 1) {
    bones.LeftArm.quaternion.copy(angleAroundX(sourceAngle));
    applyNo60Modifications({ runtime, values, delta });
  }
  assert.equal(leftArm.spaceHoldRemaining, 0);
}

testRegionTags();
testRegionalResolver();
testRegionalEnergyClocks();
testDeterministicRegionalApplications();
testCircularTravelSmoothsReversalsAndBoundaries();
testCircularTravelPreservesSkeletonStructure();
testCircularTravelHasPerceptuallyProgressiveStrength();
testLowerCircleValuesRemoveCurvatureWithoutCollapsingPoses();
testSynchronicScaleUsesSmoothLoopingPhaseOffsets();
testShiftingRelationCrossfade();
testShiftingRelationUsesDifferentialRates();
testExtendedSpaceHoldDuration();
console.log('NO.60 regional modification tests passed.');
