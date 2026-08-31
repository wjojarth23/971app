<script>
  // 3D toolpath simulation for ROUTING jobs - see
  // docs/toolpath-simulation-plan.md for why turning is excluded and why
  // material removal (a later phase) uses a heightmap.
  //
  // three.js is loaded dynamically, matching CadViewer.svelte, so it stays out
  // of the SSR bundle and off the critical path for anyone who never opens a
  // toolpath.
  import { onMount, onDestroy } from 'svelte';
  import { parseToolpath3D, toolpathBounds3D } from '../toolpathPreview.js';

  export let gcode = '';
  /** Cutter diameter in program units. Used from Phase 3; accepted now so the
   *  mount points do not need changing again later. */
  export let toolDiameter = null;

  let container;
  let renderer, scene, camera, controls, frameId, resizeObserver, grid, axes;
  let disposed = false;
  let loading = true;
  let error = '';

  // Fusion colours a move by what it is, and CAM users read that scheme
  // fluently: yellow rapid, blue cutting, red ramp/plunge. Deliberately not
  // theme tokens - these carry domain meaning, not brand identity, and
  // recolouring them would make the view harder to read for anyone who has
  // used a CAM package.
  const MOVE_STYLES = {
    rapid: { color: 0xd8b400, label: 'Rapid', opacity: 0.55 },
    cut: { color: 0x2f6fd0, label: 'Cutting', opacity: 1 },
    ramp: { color: 0xd0342c, label: 'Ramp / plunge', opacity: 1 }
  };
  const KINDS = ['rapid', 'cut', 'ramp'];

  let visible = { rapid: true, cut: true, ramp: true };
  const lineObjects = {};

  $: parsed = parseToolpath3D(gcode || '');
  $: moves = parsed.moves;
  $: bounds = toolpathBounds3D(moves);
  $: moveCounts = KINDS.reduce((counts, kind) => {
    counts[kind] = moves.filter((move) => move.kind === kind).length;
    return counts;
  }, {});

  // Rebuild whenever the program changes, but only once the scene exists.
  $: if (scene && moves) rebuildToolpath();
  $: if (scene) applyVisibility(visible);

  function applyVisibility(state) {
    for (const kind of KINDS) {
      if (lineObjects[kind]) lineObjects[kind].visible = !!state[kind];
    }
  }

  let THREE_NS = null;

  function disposeToolpath() {
    for (const kind of KINDS) {
      const object = lineObjects[kind];
      if (!object) continue;
      scene.remove(object);
      object.geometry?.dispose?.();
      object.material?.dispose?.();
      lineObjects[kind] = null;
    }
  }

  function rebuildToolpath() {
    if (!THREE_NS || !scene) return;
    const THREE = THREE_NS;
    disposeToolpath();

    // One flat Float32Array per move class rather than an object per segment -
    // a real program is thousands of moves and this runs on every reparse.
    const buffers = {};
    for (const kind of KINDS) buffers[kind] = [];
    for (const move of moves) {
      const target = buffers[move.kind] || buffers.cut;
      target.push(move.from.x, move.from.y, move.from.z, move.to.x, move.to.y, move.to.z);
    }

    for (const kind of KINDS) {
      const points = buffers[kind];
      if (!points.length) continue;
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
      const style = MOVE_STYLES[kind];
      const material = new THREE.LineBasicMaterial({
        color: style.color,
        transparent: style.opacity < 1,
        opacity: style.opacity
      });
      const object = new THREE.LineSegments(geometry, material);
      object.visible = !!visible[kind];
      lineObjects[kind] = object;
      scene.add(object);
    }
    sizeReferenceGeometry();
    frameCamera();
  }

  function frameCamera() {
    if (!camera || !controls || !THREE_NS) return;
    const { min, max } = bounds;
    const center = {
      x: (min.x + max.x) / 2,
      y: (min.y + max.y) / 2,
      z: (min.z + max.z) / 2
    };
    const span = Math.max(max.x - min.x, max.y - min.y, max.z - min.z, 1);
    controls.target.set(center.x, center.y, center.z);
    camera.position.set(center.x + span * 1.1, center.y - span * 1.3, center.z + span * 1.1);
    camera.near = span / 500;
    camera.far = span * 100;
    camera.updateProjectionMatrix();
    controls.update();
  }

  export function resetView() {
    frameCamera();
  }

  onMount(() => {
    let cancelled = false;
    (async () => {
      try {
        const THREE = await import('three');
        const { OrbitControls } = await import('three/examples/jsm/controls/OrbitControls.js');
        if (cancelled || disposed) return;
        THREE_NS = THREE;

        const width = container.clientWidth || 600;
        const height = container.clientHeight || 400;
        const isDark = typeof document !== 'undefined'
          && document.documentElement.getAttribute('data-theme') === 'modern-dark';

        scene = new THREE.Scene();
        scene.background = new THREE.Color(isDark ? 0x131109 : 0xf3f4f6);

        camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 10000);
        // G-code is Z-up: Z is depth, negative into the material. Telling
        // three.js that directly is far less error-prone than transforming
        // every coordinate into its Y-up default and then reasoning in two
        // frames at once.
        camera.up.set(0, 0, 1);

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(renderer.domElement);

        // Grid sits on the stock's top surface (Z0), which is where a router
        // touches off, so it reads as the material rather than a floor.
        grid = new THREE.GridHelper(1, 1);
        grid.rotation.x = Math.PI / 2;
        scene.add(grid);
        axes = new THREE.AxesHelper(1);
        scene.add(axes);

        controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;

        rebuildToolpath();

        const animate = () => {
          if (disposed) return;
          frameId = requestAnimationFrame(animate);
          controls.update();
          renderer.render(scene, camera);
        };
        animate();

        resizeObserver = new ResizeObserver(() => {
          if (!renderer || !camera || !container) return;
          const w = container.clientWidth;
          const h = container.clientHeight;
          if (w === 0 || h === 0) return;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setSize(w, h);
        });
        resizeObserver.observe(container);

        loading = false;
      } catch (e) {
        console.error('Toolpath simulator error:', e);
        error = e?.message || 'Could not start the 3D simulation.';
        loading = false;
      }
    })();

    return () => { cancelled = true; };
  });

  function sizeReferenceGeometry() {
    if (!grid || !axes) return;
    const { min, max } = bounds;
    const span = Math.max(max.x - min.x, max.y - min.y, 1);
    grid.scale.setScalar(span * 1.5);
    grid.position.set((min.x + max.x) / 2, (min.y + max.y) / 2, 0);
    axes.scale.setScalar(Math.max(span * 0.12, 0.25));
    axes.position.set(min.x, min.y, 0);
  }

  onDestroy(() => {
    disposed = true;
    if (frameId) cancelAnimationFrame(frameId);
    resizeObserver?.disconnect();
    if (scene) disposeToolpath();
    controls?.dispose?.();
    renderer?.dispose?.();
    if (renderer?.domElement?.parentNode) {
      renderer.domElement.parentNode.removeChild(renderer.domElement);
    }
  });
</script>

<div class="simulator" data-tool-diameter={toolDiameter ?? undefined}>
  <div class="viewport" bind:this={container}>
    {#if loading}
      <div class="overlay"><div class="spinner"></div><span>Starting simulation...</span></div>
    {:else if error}
      <div class="overlay overlay-error"><span>⚠️ {error}</span></div>
    {:else if !moves.length}
      <div class="overlay"><span>No toolpath moves could be read from this program.</span></div>
    {/if}
  </div>

  <div class="legend">
    {#each KINDS as kind}
      <label class="legend-item" class:empty={!moveCounts[kind]}>
        <input type="checkbox" bind:checked={visible[kind]} disabled={!moveCounts[kind]} />
        <span class="swatch" style={`background:#${MOVE_STYLES[kind].color.toString(16).padStart(6, '0')}`}></span>
        <span class="legend-label">{MOVE_STYLES[kind].label}</span>
        <span class="legend-count">{moveCounts[kind]}</span>
      </label>
    {/each}
    <button class="btn btn-sm" type="button" on:click={resetView} disabled={loading || !!error}>Reset view</button>
  </div>
</div>

<style>
  .simulator { display: grid; gap: var(--space-2); }
  .viewport {
    position: relative;
    width: 100%;
    height: 60vh;
    min-height: 320px;
    border-radius: var(--radius-sm, 4px);
    overflow: hidden;
    background: var(--surface-2, #f3f4f6);
  }
  .overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.75rem;
    color: var(--text-muted, #6b7280);
    font-size: 0.9rem;
    text-align: center;
    padding: 1rem;
  }
  .overlay-error { color: var(--red-strong, #991b1b); }
  .spinner {
    width: 32px;
    height: 32px;
    border: 3px solid var(--border, #d1d5db);
    border-top-color: var(--accent, #f1c331);
    border-radius: 50%;
    animation: sim-spin 0.8s linear infinite;
  }
  @keyframes sim-spin { to { transform: rotate(360deg); } }

  .legend { display: flex; flex-wrap: wrap; align-items: center; gap: var(--gap-3); }
  .legend-item { display: flex; align-items: center; gap: var(--gap-2); font-size: 0.82rem; cursor: pointer; }
  .legend-item.empty { opacity: 0.45; cursor: default; }
  .swatch { width: 0.85rem; height: 0.85rem; border-radius: 2px; }
  .legend-label { color: var(--text); }
  .legend-count { color: var(--text-muted); font-variant-numeric: tabular-nums; }
  .legend button { margin-left: auto; }
  @media (max-width: 560px) {
    .viewport { height: 45vh; }
    .legend button { margin-left: 0; }
  }
</style>
