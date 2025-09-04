<script>
  import { onMount } from 'svelte';
  import { Gantt, Willow } from 'wx-svelte-gantt';
  import { supabase } from '$lib/supabase.js';

  // Basic Gantt setup
  let tasks = [];
  let links = [];
  let api;
  const PROJECT_KEY = 'default';

  const scales = [
    { unit: 'month', step: 1, format: 'MMMM yyy' },
    { unit: 'day', step: 1, format: 'd' }
  ];

  function toGanttTask(row) {
    return {
      id: row.id,
      text: row.text,
      start: new Date(row.start_date),
      end: new Date(row.end_date),
      progress: row.progress ?? 0,
      type: row.type,
      parent: row.parent_id ?? undefined
    };
  }

  function startOfDay(d) {
    const dt = d instanceof Date ? new Date(d) : new Date(d || Date.now());
    dt.setHours(0, 0, 0, 0);
    return dt;
  }

  function toRowPayload(task) {
    const s = startOfDay(task?.start);
    const durationDays = Number.isFinite(task?.duration) ? Math.max(1, task.duration) : 1;
    let e = task?.end ? startOfDay(task.end) : new Date(s.getTime() + durationDays * 24 * 60 * 60 * 1000);
    if (e < s) e = new Date(s.getTime() + 24 * 60 * 60 * 1000);
    return {
      text: task?.text ?? '',
      start_date: s,
      end_date: e,
      progress: task?.progress ?? 0,
      type: task?.type ?? 'task',
      parent_id: task?.parent ?? null,
      project_key: PROJECT_KEY
    };
  }

  async function load() {
    const { data: t, error: et } = await supabase
      .from('gantt_tasks')
      .select('*')
      .eq('project_key', PROJECT_KEY)
      .order('id', { ascending: true });
    if (!et && Array.isArray(t)) tasks = t.map(toGanttTask);

    const { data: l, error: el } = await supabase
      .from('gantt_links')
      .select('*')
      .eq('project_key', PROJECT_KEY);
    if (!el && Array.isArray(l))
      links = l.map((r) => ({ id: r.id, source: r.source_id, target: r.target_id, type: r.type }));
  }

  function init(_api) {
    api = _api;

    // TASKS CRUD
    api.intercept('add-task', async (data) => {
      const task = data.task || {};
      if (!task.text) task.text = 'New Task';
      const payload = toRowPayload(task);
      const { data: row, error } = await supabase.from('gantt_tasks').insert(payload).select().single();
      if (error) {
        console.error('Insert task failed', error);
        return false; // cancel add in UI
      }
      data.id = row.id;
      task.id = row.id;
      task.start = payload.start_date;
      task.end = payload.end_date;
      data.task = task;
    });

    api.on('update-task', async ({ id, task }) => {
      const payload = toRowPayload(task);
      const { error } = await supabase.from('gantt_tasks').update(payload).eq('id', id);
      if (error) console.error('Update task failed', error);
    });

    api.on('delete-task', async ({ id }) => {
      const { error } = await supabase.from('gantt_tasks').delete().eq('id', id);
      if (error) console.error('Delete task failed', error);
      // Links are removed by FK cascade
    });

    // Update parent when moving to child of another task
    api.on('move-task', async ({ id, target, mode }) => {
      if (mode === 'child' && target) {
        const { error } = await supabase.from('gantt_tasks').update({ parent_id: target }).eq('id', id);
        if (error) console.error('Move task failed', error);
      }
    });

    // LINKS CRUD
    api.intercept('add-link', async (data) => {
      const payload = {
        source_id: data.source,
        target_id: data.target,
        type: data.type || 'e2e',
        project_key: PROJECT_KEY
      };
      const { data: row, error } = await supabase.from('gantt_links').insert(payload).select().single();
      if (error) {
        console.error('Insert link failed', error);
        return false; // cancel add in UI
      }
      data.id = row.id;
    });

    api.on('update-link', async ({ id, link }) => {
      const { error } = await supabase
        .from('gantt_links')
        .update({ source_id: link.source, target_id: link.target, type: link.type })
        .eq('id', id);
      if (error) console.error('Update link failed', error);
    });

    api.on('delete-link', async ({ id }) => {
      const { error } = await supabase.from('gantt_links').delete().eq('id', id);
      if (error) console.error('Delete link failed', error);
    });
  }

  onMount(load);
</script>

<h2>Admin Gantt</h2>
<p class="muted">Use the grid or chart to add/edit tasks and dependencies. All changes sync to Supabase.</p>

<Willow>
  <Gantt {tasks} {links} {scales} {init} />
</Willow>

<style>
  .muted { color: var(--secondary); }
</style>
