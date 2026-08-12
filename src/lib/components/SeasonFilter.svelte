<script>
  // Dropdown to filter a list by FRC season/offseason year-bucket. Pass the
  // options from getAllSeasonBuckets() in $lib/frcSeason.js and bind:value
  // in the parent; use passesSeasonFilter() from the same module to apply it.
  export let options = [];
  export let value = '';
  export let allLabel = 'All Seasons';
</script>

<div class="form-group">
  <label class="form-label" for="season-filter">Season</label>
  <select id="season-filter" class="form-select" bind:value>
    <option value="">{allLabel}</option>
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>
