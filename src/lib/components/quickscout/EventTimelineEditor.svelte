<script>
  import { onMount, onDestroy } from 'svelte';

  // events: raw scout_data_events rows (or session-optimistic equivalents)
  // already filtered to one match+team, containing quick_* start/end pairs.
  // startedAt: ISO string marking t=0 for the track; falls back to the
  // earliest event's timestamp if not given (e.g. when reviewing a past
  // match with no explicit "recording started" moment).
  export let events = [];
  export let startedAt = null;
  export let editable = true;
  export let onUpdate = null; // (id, newIsoTimestamp) => void

  const METRICS = [
    { key: 'quick_shooting', label: 'Shooting' },
    { key: 'quick_climbed', label: 'Climbed' },
    { key: 'quick_defense', label: 'Defense' },
    { key: 'quick_broken', label: 'Broken' }
  ];

  let nowTick = Date.now();
  let tickTimer;
  onMount(() => {
    tickTimer = setInterval(() => (nowTick = Date.now()), 1000);
  });
  onDestroy(() => clearInterval(tickTimer));

  function toMs(iso) {
    const t = new Date(iso).getTime();
    return Number.isFinite(t) ? t : null;
  }

  // Pair up chronological *_start / *_end rows per metric into intervals.
  // A trailing unmatched _start renders as "open" (extends to now).
  function buildIntervals(metricKey) {
    const rows = events
      .filter((e) => e.event_type === `${metricKey}_start` || e.event_type === `${metricKey}_end`)
      .map((e) => ({ ...e, ms: toMs(e.created_at) }))
      .filter((e) => e.ms !== null)
      .sort((a, b) => a.ms - b.ms);

    const intervals = [];
    let pending = null;
    for (const row of rows) {
      if (row.event_type.endsWith('_start')) {
        if (!pending) pending = row;
        // a second start while one is already open is a data anomaly from a
        // missed toggle-off - ignore it rather than lose the open interval
      } else if (pending) {
        intervals.push({ startEvent: pending, endEvent: row, open: false });
        pending = null;
      }
      // an _end with no pending start is ignored - nothing to close
    }
    if (pending) intervals.push({ startEvent: pending, endEvent: null, open: true });
    return intervals;
  }

  $: metricIntervals = METRICS.map((m) => ({ ...m, intervals: buildIntervals(m.key) }));

  $: earliestMs = (() => {
    if (startedAt) {
      const t = toMs(startedAt);
      if (t !== null) return t;
    }
    const all = events.map((e) => toMs(e.created_at)).filter((t) => t !== null);
    return all.length ? Math.min(...all) : nowTick;
  })();

  $: latestMs = (() => {
    const all = events.map((e) => toMs(e.created_at)).filter((t) => t !== null);
    const openNow = metricIntervals.some((m) => m.intervals.some((i) => i.open)) ? nowTick : 0;
    return Math.max(earliestMs + 30000, ...(all.length ? all : [earliestMs]), openNow);
  })();

  $: durationMs = Math.max(1000, latestMs - earliestMs);

  function pct(ms) {
    return Math.min(100, Math.max(0, ((ms - earliestMs) / durationMs) * 100));
  }

  function fmtSec(ms) {
    return `${Math.round((ms - earliestMs) / 1000)}s`;
  }

  // --- drag-to-edit ---
  // Plain (non-reactive) map keyed by each metric's stable `key` string -
  // metricIntervals itself is rebuilt by the $: block on every tick, so
  // storing element refs on those throwaway objects would be fragile.
  let trackEls = {};
  let dragState = null; // { eventId, edge, trackEl, otherBoundMs, previewMs }

  function beginDrag(e, interval, edge, trackEl) {
    if (!editable || !onUpdate || interval.open) return;
    e.preventDefault();
    const otherBoundMs =
      edge === 'start' ? toMs(interval.endEvent.created_at) : toMs(interval.startEvent.created_at);
    dragState = {
      eventId: edge === 'start' ? interval.startEvent.id : interval.endEvent.id,
      edge,
      trackEl,
      otherBoundMs
    };
  }

  function onDragMove(e) {
    if (!dragState) return;
    const rect = dragState.trackEl.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    let newMs = earliestMs + ratio * durationMs;
    // keep start strictly before end (half-second minimum gap)
    if (dragState.edge === 'start') newMs = Math.min(newMs, dragState.otherBoundMs - 500);
    else newMs = Math.max(newMs, dragState.otherBoundMs + 500);
    dragState = { ...dragState, previewMs: newMs };
  }

  function endDrag() {
    if (!dragState) return;
    if (dragState.previewMs != null && onUpdate) {
      onUpdate(dragState.eventId, new Date(dragState.previewMs).toISOString());
    }
    dragState = null;
  }

  function handleLeftPct(interval, edge) {
    if (dragState && dragState.eventId === (edge === 'start' ? interval.startEvent.id : interval.endEvent?.id)) {
      return pct(dragState.previewMs ?? (edge === 'start' ? toMs(interval.startEvent.created_at) : toMs(interval.endEvent.created_at)));
    }
    return pct(edge === 'start' ? toMs(interval.startEvent.created_at) : interval.open ? nowTick : toMs(interval.endEvent.created_at));
  }
</script>

<svelte:window on:pointermove={onDragMove} on:pointerup={endDrag} />

<div class="et-timeline">
  {#each metricIntervals as m (m.key)}
    <div class="et-row">
      <span class="et-label">{m.label}</span>
      <div class="et-track" bind:this={trackEls[m.key]}>
        {#each m.intervals as interval, i (interval.startEvent.id)}
          {@const leftPct = handleLeftPct(interval, 'start')}
          {@const rightPct = handleLeftPct(interval, 'end')}
          <div
            class="et-interval"
            class:et-interval-open={interval.open}
            style="left:{leftPct}%; width:{Math.max(0.5, rightPct - leftPct)}%"
            title="{fmtSec(toMs(interval.startEvent.created_at))} – {interval.open ? 'now' : fmtSec(toMs(interval.endEvent.created_at))}"
          >
            {#if editable && onUpdate && !interval.open}
              <div
                class="et-handle et-handle-start"
                on:pointerdown={(e) => beginDrag(e, interval, 'start', trackEls[m.key])}
              ></div>
              <div
                class="et-handle et-handle-end"
                on:pointerdown={(e) => beginDrag(e, interval, 'end', trackEls[m.key])}
              ></div>
            {/if}
          </div>
        {/each}
      </div>
    </div>
  {/each}
</div>

<style>
  .et-timeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-2, 0.5rem);
  }
  .et-row {
    display: grid;
    grid-template-columns: 5.5rem 1fr;
    align-items: center;
    gap: var(--space-3, 0.75rem);
  }
  .et-label {
    font-size: 0.8rem;
    color: var(--text-muted, #888);
    text-align: right;
  }
  .et-track {
    position: relative;
    height: 1.6rem;
    background: var(--surface-2, #f2f2f2);
    border: 1px solid var(--border, #ddd);
    border-radius: 4px;
    overflow: visible;
  }
  .et-interval {
    position: absolute;
    top: 2px;
    bottom: 2px;
    background: var(--accent, #3a7);
    border-radius: 3px;
    min-width: 3px;
  }
  .et-interval-open {
    background: repeating-linear-gradient(
      45deg,
      var(--accent, #3a7),
      var(--accent, #3a7) 6px,
      color-mix(in srgb, var(--accent, #3a7) 60%, transparent) 6px,
      color-mix(in srgb, var(--accent, #3a7) 60%, transparent) 12px
    );
  }
  .et-handle {
    position: absolute;
    top: -2px;
    bottom: -2px;
    width: 10px;
    cursor: ew-resize;
    touch-action: none;
  }
  .et-handle-start {
    left: -5px;
  }
  .et-handle-end {
    right: -5px;
  }
</style>
