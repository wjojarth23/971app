import { describe, it, expect } from 'vitest';
import { RUNNER_SILENT_MS, visionRunnerAlert } from './slack_notifications.js';

const NOW = Date.parse('2026-08-29T12:00:00Z');
const agoMs = (ms) => new Date(NOW - ms).toISOString();

const healthyQwen = { qwen: { ready: true, last_latency_ms: 4200 } };

describe('visionRunnerAlert', () => {
  it('stays quiet for a runner heartbeating normally', () => {
    expect(visionRunnerAlert({
      runner_id: 'vision-runner-1', last_seen_at: agoMs(20_000), runtime_metrics: healthyQwen
    }, NOW)).toBeNull();
  });

  it('stays quiet for a runner mid-run that is slower than the dashboard cutoff', () => {
    // vision_runner.py heartbeats per Qwen clip, so a busy runner is minutes
    // stale at worst - well inside the outage threshold even though the
    // dashboard's 60s "online" cutoff would already call it offline.
    expect(visionRunnerAlert({
      runner_id: 'vision-runner-1', last_seen_at: agoMs(5 * 60 * 1000), runtime_metrics: healthyQwen
    }, NOW)).toBeNull();
  });

  it('alerts once a runner has been silent past the outage threshold', () => {
    const alert = visionRunnerAlert({
      runner_id: 'vision-runner-1', last_seen_at: agoMs(RUNNER_SILENT_MS + 60_000), runtime_metrics: healthyQwen
    }, NOW);
    expect(alert?.reason).toBe('silent');
    expect(alert.text).toContain('16 minutes');
  });

  it('reuses one entity key for a continuing outage so it alerts once, not every sweep', () => {
    const runner = { runner_id: 'vision-runner-1', last_seen_at: agoMs(30 * 60 * 1000) };
    const first = visionRunnerAlert(runner, NOW);
    const anHourLater = visionRunnerAlert(runner, NOW + 60 * 60 * 1000);
    expect(anHourLater.entityKey).toBe(first.entityKey);
  });

  it('uses a fresh entity key for a later, separate outage', () => {
    const first = visionRunnerAlert({ runner_id: 'r', last_seen_at: agoMs(30 * 60 * 1000) }, NOW);
    const second = visionRunnerAlert({ runner_id: 'r', last_seen_at: agoMs(20 * 60 * 1000) }, NOW);
    expect(second.entityKey).not.toBe(first.entityKey);
  });

  it('alerts on an up-but-Qwen-less runner, which silently claims nothing', () => {
    const alert = visionRunnerAlert({
      runner_id: 'vision-runner-1',
      last_seen_at: agoMs(15_000),
      runtime_metrics: { qwen: { ready: false, error: 'Connection refused' } }
    }, NOW);
    expect(alert?.reason).toBe('qwen-down');
    expect(alert.text).toContain('Connection refused');
  });

  it('reports a silent runner as an outage rather than a Qwen fault', () => {
    const alert = visionRunnerAlert({
      runner_id: 'vision-runner-1',
      last_seen_at: agoMs(RUNNER_SILENT_MS + 1000),
      runtime_metrics: { qwen: { ready: false, error: 'Connection refused' } }
    }, NOW);
    expect(alert?.reason).toBe('silent');
  });

  it('treats a runner that has never checked in as an outage', () => {
    const alert = visionRunnerAlert({ runner_id: 'vision-runner-1', last_seen_at: null }, NOW);
    expect(alert?.reason).toBe('silent');
    expect(alert.text).toContain('never checked in');
    expect(alert.entityKey).toContain(':never');
  });

  it('does not invent a Qwen fault when the runner reports no Qwen metrics at all', () => {
    expect(visionRunnerAlert({
      runner_id: 'vision-runner-1', last_seen_at: agoMs(20_000), runtime_metrics: {}
    }, NOW)).toBeNull();
    expect(visionRunnerAlert({
      runner_id: 'vision-runner-1', last_seen_at: agoMs(20_000), runtime_metrics: { qwen: null }
    }, NOW)).toBeNull();
  });
});
