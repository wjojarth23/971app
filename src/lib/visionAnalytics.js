const finite = (value) => Number.isFinite(Number(value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const percentile = (values, p) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * p)))];
};

export function trajectoryMetrics(points, { minConfidence = 0.5 } = {}) {
  const clean = (points || []).filter((point) => finite(point?.t) && finite(point?.x) && finite(point?.y) && (point.confidence ?? 1) >= minConfidence).sort((a, b) => a.t - b.t);
  const speeds = [];
  const accelerations = [];
  const turnRates = [];
  let distance = 0;
  let movingMs = 0;
  let stationaryMs = 0;
  let priorSpeed = null;
  let priorHeading = null;
  for (let i = 1; i < clean.length; i += 1) {
    const previous = clean[i - 1];
    const current = clean[i];
    const dt = (current.t - previous.t) / 1000;
    if (dt <= 0 || dt > 1) continue;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    const segment = Math.hypot(dx, dy);
    const speed = segment / dt;
    distance += segment;
    speeds.push(speed);
    if (speed >= 0.25) movingMs += dt * 1000;
    else stationaryMs += dt * 1000;
    if (priorSpeed != null) accelerations.push(Math.abs(speed - priorSpeed) / dt);
    const heading = Math.atan2(dy, dx);
    if (priorHeading != null && speed >= 0.25) {
      const delta = Math.atan2(Math.sin(heading - priorHeading), Math.cos(heading - priorHeading));
      turnRates.push(Math.abs(delta) / dt);
    }
    priorSpeed = speed;
    priorHeading = heading;
  }
  return {
    sampleCount: clean.length,
    distanceMeters: distance,
    medianSpeedMps: percentile(speeds, 0.5),
    p90SpeedMps: percentile(speeds, 0.9),
    maxSpeedMps: speeds.length ? Math.max(...speeds) : null,
    meanAccelerationMps2: mean(accelerations),
    p90TurnRateRadS: percentile(turnRates, 0.9),
    movingMs,
    stationaryMs,
    coverageMs: movingMs + stationaryMs
  };
}

export function fuseObservations(observations, { dedupeWindowMs = 350 } = {}) {
  const sorted = [...(observations || [])].sort((a, b) => a.started_ms - b.started_ms);
  const fused = [];
  for (const observation of sorted) {
    const duplicate = fused.findLast((candidate) =>
      candidate.observation_type === observation.observation_type &&
      candidate.team_key === observation.team_key &&
      candidate.alliance === observation.alliance &&
      Math.abs(candidate.started_ms - observation.started_ms) <= dedupeWindowMs
    );
    if (!duplicate) fused.push({ ...observation, contributing_view_ids: observation.view_id ? [observation.view_id] : [] });
    else {
      if ((observation.confidence || 0) > (duplicate.confidence || 0)) Object.assign(duplicate, observation);
      if (observation.view_id && !duplicate.contributing_view_ids.includes(observation.view_id)) duplicate.contributing_view_ids.push(observation.view_id);
    }
  }
  return fused;
}

export function summarizeVision(observations, tracks) {
  const fused = fuseObservations(observations);
  const teams = {};
  const alliances = { red: { fuelScored: 0, climbs: 0 }, blue: { fuelScored: 0, climbs: 0 } };
  const ensure = (teamKey) => teams[teamKey] ||= { fuelScored: 0, fuelObservations: 0, climb: null, observations: 0, mobility: null };
  for (const observation of fused) {
    if (!observation.team_key) {
      const alliance = alliances[observation.alliance];
      if (alliance && observation.observation_type === 'fuel_scored') alliance.fuelScored += Number(observation.value?.count) || 1;
      if (alliance && observation.observation_type === 'climb_success') alliance.climbs += 1;
      continue;
    }
    const team = ensure(observation.team_key);
    team.observations += 1;
    if (observation.observation_type === 'fuel_scored') {
      team.fuelScored += Number(observation.value?.count) || 1;
      team.fuelObservations += 1;
    }
    if (observation.observation_type === 'climb_success') team.climb = observation.value?.level || 'success';
  }
  for (const track of tracks || []) {
    if (!track.team_key) continue;
    const team = ensure(track.team_key);
    const metrics = track.metrics && Object.keys(track.metrics).length ? track.metrics : trajectoryMetrics(track.trajectory);
    if (!team.mobility || (metrics.coverageMs || 0) > (team.mobility.coverageMs || 0)) team.mobility = metrics;
  }
  return { teams, alliances, fusedObservations: fused };
}

export function reconcileWithReference(summary, reference, thresholds = {}) {
  const fuelAbsolute = thresholds.fuelAbsolute ?? 3;
  const fuelPercent = thresholds.fuelPercent ?? 0.15;
  const discrepancies = [];
  for (const alliance of ['red', 'blue']) {
    const teamKeys = reference?.alliances?.[alliance]?.teamKeys || [];
    const visionFuel = (summary.alliances?.[alliance]?.fuelScored || 0) + teamKeys.reduce((sum, key) => sum + (summary.teams[key]?.fuelScored || 0), 0);
    const referenceFuel = reference?.alliances?.[alliance]?.fuel;
    if (finite(referenceFuel)) {
      const difference = Math.abs(visionFuel - Number(referenceFuel));
      const percent = difference / Math.max(1, Number(referenceFuel));
      if (difference > fuelAbsolute && percent > fuelPercent) discrepancies.push({
        alliance, metric: 'fuel', vision_value: visionFuel, reference_value: Number(referenceFuel),
        absolute_difference: difference, percent_difference: percent,
        severity: percent >= 0.35 ? 'critical' : 'warning',
        reason: 'Vision alliance fuel differs materially from the official match breakdown.'
      });
    }
    const visionClimbs = (summary.alliances?.[alliance]?.climbs || 0) + teamKeys.filter((key) => summary.teams[key]?.climb).length;
    const referenceClimbs = reference?.alliances?.[alliance]?.climbs;
    if (finite(referenceClimbs) && visionClimbs !== Number(referenceClimbs)) discrepancies.push({
      alliance, metric: 'climb_count', vision_value: visionClimbs, reference_value: Number(referenceClimbs),
      absolute_difference: Math.abs(visionClimbs - Number(referenceClimbs)), percent_difference: null,
      severity: 'critical', reason: 'Vision and the official breakdown disagree on successful climbs.'
    });
  }
  return discrepancies;
}

export function reconcileVisionSources(primary, qwen, thresholds = {}) {
  const fuelAbsolute = thresholds.sourceFuelAbsolute ?? 3;
  const discrepancies = [];
  for (const alliance of ['red', 'blue']) {
    const primaryFuel = Number(primary?.alliances?.[alliance]?.fuelScored || 0);
    const qwenFuel = Number(qwen?.alliances?.[alliance]?.fuelScored || 0);
    const fuelDifference = Math.abs(primaryFuel - qwenFuel);
    if (fuelDifference > fuelAbsolute) discrepancies.push({
      alliance, metric: 'qwen_pipeline_fuel', vision_value: { pipeline: primaryFuel, qwen: qwenFuel },
      reference_value: null, absolute_difference: fuelDifference,
      percent_difference: fuelDifference / Math.max(1, primaryFuel),
      severity: fuelDifference >= Math.max(8, primaryFuel * 0.35) ? 'critical' : 'warning',
      reason: 'Qwen and the deterministic vision pipeline disagree materially on scored fuel.',
      evidence: { sources: ['qwen3_vl', 'classical_cv'] }
    });
    const primaryClimbs = Number(primary?.alliances?.[alliance]?.climbs || 0);
    const qwenClimbs = Number(qwen?.alliances?.[alliance]?.climbs || 0);
    if (primaryClimbs !== qwenClimbs) discrepancies.push({
      alliance, metric: 'qwen_pipeline_climb_count', vision_value: { pipeline: primaryClimbs, qwen: qwenClimbs },
      reference_value: null, absolute_difference: Math.abs(primaryClimbs - qwenClimbs),
      percent_difference: null, severity: 'critical',
      reason: 'Qwen and the deterministic vision pipeline disagree on completed climbs.',
      evidence: { sources: ['qwen3_vl', 'yolo'] }
    });
  }
  return discrepancies;
}
