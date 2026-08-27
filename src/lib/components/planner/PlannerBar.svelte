<script>
  let { data } = $props();

  function criticalLabel(level) {
    if (level === 1) return 'L1';
    if (level === 2) return 'L2';
    if (level === 3) return 'L3';
    return 'L4';
  }
</script>

{#if data?.kind === 'milestone'}
  <div
    class={`planner-milestone planner-milestone--${data.status || 'green'} planner-milestone-tone--${data.status_tone || data.status || 'green'}`}
    title={`${data.text} - ${criticalLabel(data.critical_level)}`}
  >
    <div class="planner-milestone-fill"></div>
    <div class="planner-milestone-text">
      <span class="planner-milestone-title">{data.text}</span>
    </div>
  </div>
{:else}
  <div
    class={`planner-task planner-task--${data.status || 'green'} planner-task-tone--${data.status_tone || data.status || 'green'}`}
    title={`${data.text} - ${criticalLabel(data.critical_level)}`}
  >
    <span class="planner-task-title">{data.text}</span>
  </div>
{/if}

<style>
  .planner-task,
  .planner-milestone {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .planner-task {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    padding: 0 0.45rem;
    color: var(--planner-status-text, #f8fafc);
    font-size: 0.7rem;
    font-weight: 600;
    border-radius: 4px;
    border: 1px solid transparent;
    box-shadow: none;
    overflow: hidden;
    background-image: none;
  }

  .planner-task--green {
    background: var(--planner-green-solid, #15803d);
    border-color: var(--planner-green-border, var(--green-strong));
  }

  .planner-task--not_started {
    background-image: repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.2) 0,
      rgba(255, 255, 255, 0.2) 0.45rem,
      transparent 0.45rem,
      transparent 0.9rem
    );
  }

  .planner-task--not_started.planner-task-tone--green {
    background-color: var(--planner-green-solid, #15803d);
    border-color: var(--planner-green-border, var(--green-strong));
  }

  .planner-task--not_started.planner-task-tone--yellow {
    background-color: var(--planner-yellow-solid, #eab308);
    border-color: var(--planner-yellow-border, #ca8a04);
    color: var(--planner-yellow-text, #422006);
  }

  .planner-task--not_started.planner-task-tone--red {
    background-color: var(--planner-red-solid, #be123c);
    border-color: var(--planner-red-border, #9f1239);
  }

  .planner-task--yellow {
    background: var(--planner-yellow-solid, #eab308);
    border-color: var(--planner-yellow-border, #ca8a04);
    color: var(--planner-yellow-text, #422006);
  }

  .planner-task--red {
    background: var(--planner-red-solid, #be123c);
    border-color: var(--planner-red-border, #9f1239);
  }

  .planner-task--completed {
    background: var(--planner-completed-solid, #0f766e);
    border-color: var(--planner-completed-border, #115e59);
  }

  .planner-task-title,
  .planner-milestone-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .planner-milestone-fill {
    position: absolute;
    inset: 0;
    transform: rotate(45deg) scale(0.72);
    border-radius: 4px;
    border: 1px solid transparent;
    box-shadow: none;
    background-image: none;
  }

  .planner-milestone--green .planner-milestone-fill {
    background: var(--planner-green-solid, #15803d);
    border-color: var(--planner-green-border, var(--green-strong));
  }

  .planner-milestone--not_started .planner-milestone-fill {
    background-image: repeating-linear-gradient(
      -45deg,
      rgba(255, 255, 255, 0.2) 0,
      rgba(255, 255, 255, 0.2) 0.45rem,
      transparent 0.45rem,
      transparent 0.9rem
    );
  }

  .planner-milestone--not_started.planner-milestone-tone--green .planner-milestone-fill {
    background-color: var(--planner-green-solid, #15803d);
    border-color: var(--planner-green-border, var(--green-strong));
  }

  .planner-milestone--not_started.planner-milestone-tone--yellow .planner-milestone-fill {
    background-color: var(--planner-yellow-solid, #eab308);
    border-color: var(--planner-yellow-border, #ca8a04);
  }

  .planner-milestone--not_started.planner-milestone-tone--red .planner-milestone-fill {
    background-color: var(--planner-red-solid, #be123c);
    border-color: var(--planner-red-border, #9f1239);
  }

  .planner-milestone--yellow .planner-milestone-fill {
    background: var(--planner-yellow-solid, #eab308);
    border-color: var(--planner-yellow-border, #ca8a04);
  }

  .planner-milestone--red .planner-milestone-fill {
    background: var(--planner-red-solid, #be123c);
    border-color: var(--planner-red-border, #9f1239);
  }

  .planner-milestone--completed .planner-milestone-fill {
    background: var(--planner-completed-solid, #0f766e);
    border-color: var(--planner-completed-border, #115e59);
  }

  .planner-milestone-text {
    position: absolute;
    left: calc(100% + 0.3rem);
    top: 50%;
    display: inline-block;
    transform: translateY(-50%);
    max-width: 12rem;
    color: #334155;
    font-size: 0.62rem;
    font-weight: 600;
    white-space: nowrap;
  }
</style>
