<script>
  export let alliance = 'blue';
  export let path = [];

  let drawing = false;
  const fieldWidth = 1000;
  const fieldHeight = 487;

  $: ownColor = alliance === 'red' ? '#d12c36' : '#2468c7';
  $: opponentColor = alliance === 'red' ? '#2468c7' : '#d12c36';
  $: pathPoints = path.map(([x, y]) => `${x * 10},${y * 4.87}`).join(' ');

  function pointFromEvent(event) {
    const rect = event.currentTarget.getBoundingClientRect();
    return [
      Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100)),
      Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100))
    ];
  }

  function beginPath(event) {
    drawing = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    path = [pointFromEvent(event)];
  }

  function extendPath(event) {
    if (!drawing) return;
    const point = pointFromEvent(event);
    const last = path[path.length - 1];
    if (!last || Math.hypot(point[0] - last[0], point[1] - last[1]) > 0.8) {
      path = [...path, point];
    }
  }

  function completePath() {
    drawing = false;
  }
</script>

<div
  class="field-board"
  role="application"
  aria-label={`Draw the optional autonomous path on an alliance-relative 2026 REBUILT field. The ${alliance} alliance wall is on the left.`}
  on:pointerdown={beginPath}
  on:pointermove={extendPath}
  on:pointerup={completePath}
  on:pointercancel={completePath}
  on:pointerleave={completePath}
>
  <svg viewBox={`0 0 ${fieldWidth} ${fieldHeight}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    <rect class="carpet" x="8" y="8" width="984" height="471" />
    <path class="guardrail" d="M8 8H992V479H8Z" />
    <line class="center-line" x1="500" y1="8" x2="500" y2="479" />

    <!-- Alliance walls and starting lines. The map is alliance-relative: the
         scout's own wall is always left, matching AdvantageScope's selectable
         orientation while making red and blue paths directly comparable. -->
    <line class="alliance-wall" style={`stroke:${ownColor}`} x1="8" y1="8" x2="8" y2="479" />
    <line class="alliance-wall" style={`stroke:${opponentColor}`} x1="992" y1="8" x2="992" y2="479" />
    <line class="starting-line" style={`stroke:${ownColor}`} x1="258" y1="8" x2="258" y2="479" />
    <line class="starting-line" style={`stroke:${opponentColor}`} x1="742" y1="8" x2="742" y2="479" />

    <!-- Bumps and trenches, simplified from the WPILib/AdvantageScope 2026
         flat field so the important driveable geometry remains readable on a
         phone instead of becoming a photographic blur. -->
    <g style={`--alliance:${ownColor}`}>
      <rect class="bump" x="260" y="76" width="65" height="105" />
      <rect class="bump" x="260" y="306" width="65" height="105" />
      <rect class="trench" x="260" y="14" width="34" height="55" />
      <rect class="trench" x="260" y="418" width="34" height="55" />
    </g>
    <g style={`--alliance:${opponentColor}`}>
      <rect class="bump" x="675" y="76" width="65" height="105" />
      <rect class="bump" x="675" y="306" width="65" height="105" />
      <rect class="trench" x="706" y="14" width="34" height="55" />
      <rect class="trench" x="706" y="418" width="34" height="55" />
    </g>

    <!-- Hubs -->
    <g class="hub" style={`--alliance:${ownColor}`} transform="translate(292 244)">
      <rect x="-46" y="-46" width="92" height="92" />
      <polygon points="-24,-40 24,-40 40,-24 40,24 24,40 -24,40 -40,24 -40,-24" />
      <circle r="19" />
    </g>
    <g class="hub" style={`--alliance:${opponentColor}`} transform="translate(708 244)">
      <rect x="-46" y="-46" width="92" height="92" />
      <polygon points="-24,-40 24,-40 40,-24 40,24 24,40 -24,40 -40,24 -40,-24" />
      <circle r="19" />
    </g>

    <!-- Towers / outposts and fuel depots -->
    <path class="tower" style={`stroke:${ownColor}`} d="M8 211H68L91 244L68 277H8Z" />
    <path class="tower" style={`stroke:${opponentColor}`} d="M992 211H932L909 244L932 277H992Z" />
    <g class="depot" style={`--alliance:${ownColor}`}>
      <rect x="10" y="42" width="45" height="54" />
      <rect x="10" y="391" width="45" height="54" />
    </g>
    <g class="depot" style={`--alliance:${opponentColor}`}>
      <rect x="945" y="42" width="45" height="54" />
      <rect x="945" y="391" width="45" height="54" />
    </g>

    <rect class="neutral-fuel" x="455" y="117" width="90" height="253" />
    <g class="field-labels">
      <text x="35" y="466">{alliance} wall / start</text>
      <text x="500" y="466" text-anchor="middle">neutral zone</text>
      <text x="965" y="466" text-anchor="end">opponent wall</text>
      <text x="292" y="249" text-anchor="middle">hub</text>
      <text x="708" y="249" text-anchor="middle">hub</text>
    </g>

    {#if path.length > 1}
      <polyline class="robot-path-shadow" points={pathPoints} />
      <polyline class="robot-path" points={pathPoints} />
    {/if}
    {#if path.length}
      <circle class="path-start" cx={path[0][0] * 10} cy={path[0][1] * 4.87} r="9" />
      <circle class="path-end" cx={path[path.length - 1][0] * 10} cy={path[path.length - 1][1] * 4.87} r="7" />
    {/if}
  </svg>
</div>

<style>
  .field-board { position:relative; width:100%; aspect-ratio:2.053; overflow:hidden; border:1px solid var(--border); background:#5e605f; cursor:crosshair; touch-action:none; user-select:none; }
  svg { display:block; width:100%; height:100%; }
  .carpet { fill:#666866; }
  .guardrail { fill:none; stroke:#202221; stroke-width:7; }
  .center-line { stroke:#d9dad8; stroke-width:2; opacity:.8; }
  .alliance-wall { stroke-width:8; }
  .starting-line { stroke-width:3; opacity:.95; }
  .bump { fill:color-mix(in srgb, var(--alliance) 80%, #222); stroke:#151515; stroke-width:3; }
  .trench { fill:color-mix(in srgb, var(--alliance) 72%, #161616); stroke:#111; stroke-width:3; }
  .hub rect { fill:color-mix(in srgb, var(--alliance) 24%, #b9bab8); stroke:#171817; stroke-width:5; }
  .hub polygon { fill:#b9bab8; stroke:var(--alliance); stroke-width:7; }
  .hub circle { fill:#6d706d; stroke:#202220; stroke-width:3; }
  .tower { fill:#242625; stroke-width:4; }
  .depot rect { fill:#d6b52c; stroke:var(--alliance); stroke-width:4; }
  .neutral-fuel { fill:#d8b832; opacity:.55; stroke:#302b14; stroke-width:2; stroke-dasharray:5 5; }
  .field-labels { pointer-events:none; fill:#f5f5f0; font-family:var(--font-mono-stack); font-size:13px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; }
  .field-labels text:nth-last-child(-n+2) { fill:#181918; font-size:11px; }
  .robot-path-shadow { fill:none; stroke:#111; stroke-width:12; stroke-linecap:round; stroke-linejoin:round; opacity:.5; }
  .robot-path { fill:none; stroke:#ffd34e; stroke-width:7; stroke-linecap:round; stroke-linejoin:round; }
  .path-start { fill:#fff; stroke:#151515; stroke-width:4; }
  .path-end { fill:#ffd34e; stroke:#151515; stroke-width:3; }
</style>
