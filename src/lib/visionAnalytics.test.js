import { describe, expect, it } from 'vitest';
import { fuseObservations, reconcileVisionSources, reconcileWithReference, summarizeVision, trajectoryMetrics } from './visionAnalytics.js';

describe('vision analytics', () => {
  it('derives real-coordinate mobility metrics', () => {
    const metrics = trajectoryMetrics([{ t: 0, x: 0, y: 0 }, { t: 1000, x: 1, y: 0 }, { t: 2000, x: 1, y: 2 }]);
    expect(metrics.distanceMeters).toBe(3);
    expect(metrics.maxSpeedMps).toBe(2);
    expect(metrics.coverageMs).toBe(2000);
  });

  it('deduplicates the same event seen by multiple cameras', () => {
    const fused = fuseObservations([
      { view_id: 'a', team_key: 'frc971', observation_type: 'fuel_scored', started_ms: 1000, confidence: 0.7 },
      { view_id: 'b', team_key: 'frc971', observation_type: 'fuel_scored', started_ms: 1100, confidence: 0.9 }
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0].confidence).toBe(0.9);
    expect(fused[0].contributing_view_ids).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('does not merge simultaneous red and blue alliance actions', () => {
    const fused = fuseObservations([
      { alliance: 'red', team_key: null, observation_type: 'fuel_scored', started_ms: 1000, confidence: 0.8 },
      { alliance: 'blue', team_key: null, observation_type: 'fuel_scored', started_ms: 1000, confidence: 0.8 }
    ]);
    expect(fused).toHaveLength(2);
  });

  it('reconciles alliance-only detections before team identity is reviewed', () => {
    const summary = summarizeVision([{ alliance: 'red', team_key: null, observation_type: 'fuel_scored', value: { count: 10 }, started_ms: 1 }], []);
    const flags = reconcileWithReference(summary, { alliances: { red: { teamKeys: [], fuel: 10 }, blue: { teamKeys: [], fuel: 0 } } });
    expect(summary.alliances.red.fuelScored).toBe(10);
    expect(flags).toHaveLength(0);
  });

  it('summarizes team fuel and flags material alliance differences', () => {
    const summary = summarizeVision([{ team_key: 'frc971', observation_type: 'fuel_scored', value: { count: 8 }, started_ms: 1 }], []);
    const flags = reconcileWithReference(summary, { alliances: { red: { teamKeys: ['frc971'], fuel: 20, climbs: 0 }, blue: { teamKeys: [], fuel: 0, climbs: 0 } } });
    expect(summary.teams.frc971.fuelScored).toBe(8);
    expect(flags.some((flag) => flag.metric === 'fuel')).toBe(true);
  });

  it('flags material Qwen disagreements without mixing Qwen into pipeline totals', () => {
    const pipeline = summarizeVision([{ alliance: 'red', observation_type: 'fuel_scored', value: { count: 12 }, started_ms: 1 }], []);
    const qwen = summarizeVision([{ alliance: 'red', observation_type: 'fuel_scored', value: { count: 4 }, started_ms: 1 }], []);
    const flags = reconcileVisionSources(pipeline, qwen);
    expect(flags).toEqual(expect.arrayContaining([expect.objectContaining({ metric: 'qwen_pipeline_fuel', severity: 'critical' })]));
    expect(pipeline.alliances.red.fuelScored).toBe(12);
  });
});
