const STRING_PARAMETERS = [
  'avatarColor',
  'avatarGradientTop',
  'avatarGradientMiddle',
  'avatarGradientBottom',
  'surfaceMode',
  'lightingPreset',
  'lightingColor',
  'lightingCustomColor',
  'traceMode',
  'traceParts',
  'traceRegion',
  'floorLight',
  'graphMode',
  'flowFieldGradient',
  'flowFieldColorStart',
  'flowFieldColorMiddle',
  'flowFieldColorEnd',
  'sequence',
  'sequenceTransitionEasing',
  'sequenceTransitionDurations',
  'sequenceTransitionEasings',
  'sequencePlaybackSpeeds',
  'sequenceLoopMode',
  'mixUpSources',
  'mixUpMode',
  'no60ModificationValues',
  'no60ModificationMasters',
  'no60VisualizationTargets',
  'no60ElementAnalysisSeries',
  'physicsConstants'
];

const NUMBER_PARAMETERS = [
  'traceWidth',
  'traceSampleRate',
  'avatarOffsetX',
  'avatarOffsetY',
  'cameraOrbitSpeed',
  'cameraOrbitDirection',
  'analysisWidth',
  'lightingIntensity',
  'avatarOpacity',
  'flowFieldSpeed',
  'flowFieldCount',
  'flowFieldThickness',
  'flowFieldOpacity',
  'flowFieldTrailLength',
  'flowFieldTrailFade',
  'flowFieldStrokeLength',
  'flowFieldCurvature',
  'flowFieldColorVariation',
  'flowFieldInfluence',
  'flowFieldBodyFlow',
  'flowFieldRecovery',
  'flowFieldProximityFade',
  'flowFieldConcentration',
  'sequenceTransitionDuration'
];

const BOOLEAN_PARAMETERS = [
  'traceVisible',
  'bodyPointsVisible',
  'traceDots',
  'traceSmoothing',
  'bodyCenterLocked',
  'cameraOrbit',
  'analysisVisible',
  'avatarStyleOpen',
  'cameraControlsOpen',
  'lineControlsOpen',
  'visualizationMenuOpen',
  'flowFieldEnabled',
  'flowFieldMenuOpen',
  'sequenceActive',
  'sequenceTimelineOpen',
  'mixUpActive',
  'mixUpPanelOpen',
  'no60ModificationMode',
  'no60ModificationPanelOpen',
  'no60ElementAnalysisOpen',
  'physicsConstantsOpen',
  'controlsHidden',
  'interfaceHidden'
];

const VECTOR_PARAMETERS = ['cameraPosition', 'cameraTarget'];

function formatNumber(value, precision = 4) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return null;
  return String(Number(numericValue.toFixed(precision)));
}

function readBoolean(value) {
  return !['0', 'false', 'off', 'no'].includes(String(value).toLowerCase());
}

export function readViewStateFromParams(params) {
  const view = {};

  if (params.has('experiments')) {
    const experiments = params.get('experiments');
    view.experiments = experiments && experiments !== 'off'
      ? experiments.split(',').filter(Boolean)
      : [];
  }

  for (const key of STRING_PARAMETERS) {
    if (params.has(key)) view[key] = params.get(key);
  }

  for (const key of NUMBER_PARAMETERS) {
    if (!params.has(key)) continue;
    const value = Number(params.get(key));
    if (Number.isFinite(value)) view[key] = value;
  }

  for (const key of BOOLEAN_PARAMETERS) {
    if (params.has(key)) view[key] = readBoolean(params.get(key));
  }

  for (const key of VECTOR_PARAMETERS) {
    if (!params.has(key)) continue;
    const values = params.get(key).split(',').map(Number);
    if (values.length === 3 && values.every(Number.isFinite)) view[key] = values;
  }

  return Object.keys(view).length ? view : null;
}

export function writeViewStateToParams(params, view) {
  const experiments = Array.isArray(view?.experiments) ? view.experiments : [];
  params.set('experiments', experiments.length ? experiments.join(',') : 'off');

  for (const key of STRING_PARAMETERS) {
    if (typeof view?.[key] === 'string') params.set(key, view[key]);
  }

  for (const key of NUMBER_PARAMETERS) {
    const value = formatNumber(view?.[key]);
    if (value !== null) params.set(key, value);
  }

  for (const key of BOOLEAN_PARAMETERS) {
    if (typeof view?.[key] === 'boolean') params.set(key, view[key] ? '1' : '0');
  }

  for (const key of VECTOR_PARAMETERS) {
    if (!Array.isArray(view?.[key]) || view[key].length !== 3) continue;
    const values = view[key].map((value) => formatNumber(value));
    if (values.every((value) => value !== null)) params.set(key, values.join(','));
  }

  return params;
}
