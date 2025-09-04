-- Gantt persistence for Supabase
-- Tables: public.gantt_tasks, public.gantt_links
-- Notes:
-- - IDs use UUID (strings). wx-svelte-gantt supports string or number IDs.
-- - This script enables permissive RLS policies for all authenticated users.
--   Gate access to /admin/gantt in your app (already done) to restrict who can edit.
-- - A simple "project_key" column scopes data to a specific project/context.
--   The UI currently uses 'default' but you can extend this as needed.

begin;

create extension if not exists "pgcrypto";

-- Tasks
create table if not exists public.gantt_tasks (
  id uuid primary key default gen_random_uuid(),
  project_key text not null check (char_length(project_key) > 0),
  text text not null default '',
  start_date timestamptz not null,
  end_date timestamptz not null,
  progress numeric not null default 0,
  type text not null default 'task' check (type in ('task','summary','milestone')),
  parent_id uuid null references public.gantt_tasks(id) on delete set null,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint end_after_start check (end_date >= start_date)
);

create index if not exists idx_gantt_tasks_project on public.gantt_tasks(project_key);
create index if not exists idx_gantt_tasks_parent on public.gantt_tasks(parent_id);
create index if not exists idx_gantt_tasks_start on public.gantt_tasks(start_date);

-- Links (dependencies)
create table if not exists public.gantt_links (
  id uuid primary key default gen_random_uuid(),
  project_key text not null check (char_length(project_key) > 0),
  source_id uuid not null references public.gantt_tasks(id) on delete cascade,
  target_id uuid not null references public.gantt_tasks(id) on delete cascade,
  type text not null default 'e2e', -- keep free-form for now (e2e, s2s, etc.)
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint no_self_link check (source_id <> target_id)
);

-- Prevent duplicate links within same project
create unique index if not exists uniq_gantt_links on public.gantt_links(project_key, source_id, target_id);

-- updated_at trigger on tasks
create or replace function public.set_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at := now();
  return new;
end;
$fn$;

drop trigger if exists trg_set_updated_at_gantt_tasks on public.gantt_tasks;
create trigger trg_set_updated_at_gantt_tasks
before update on public.gantt_tasks
for each row execute function public.set_updated_at();

-- Enable RLS and add permissive policies for authenticated users
alter table public.gantt_tasks enable row level security;
alter table public.gantt_links enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_tasks' and policyname = 'gantt_tasks_select_authenticated'
  ) then
    create policy gantt_tasks_select_authenticated on public.gantt_tasks
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_tasks' and policyname = 'gantt_tasks_insert_authenticated'
  ) then
    create policy gantt_tasks_insert_authenticated on public.gantt_tasks
      for insert to authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_tasks' and policyname = 'gantt_tasks_update_authenticated'
  ) then
    create policy gantt_tasks_update_authenticated on public.gantt_tasks
      for update to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_tasks' and policyname = 'gantt_tasks_delete_authenticated'
  ) then
    create policy gantt_tasks_delete_authenticated on public.gantt_tasks
      for delete to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_links' and policyname = 'gantt_links_select_authenticated'
  ) then
    create policy gantt_links_select_authenticated on public.gantt_links
      for select to authenticated using (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_links' and policyname = 'gantt_links_insert_authenticated'
  ) then
    create policy gantt_links_insert_authenticated on public.gantt_links
      for insert to authenticated with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_links' and policyname = 'gantt_links_update_authenticated'
  ) then
    create policy gantt_links_update_authenticated on public.gantt_links
      for update to authenticated using (true) with check (true);
  end if;

  if not exists (
    select 1 from pg_policies where schemaname = 'public' and tablename = 'gantt_links' and policyname = 'gantt_links_delete_authenticated'
  ) then
    create policy gantt_links_delete_authenticated on public.gantt_links
      for delete to authenticated using (true);
  end if;
end $$;

commit;

-- Usage notes:
-- 1) Run this in Supabase SQL editor (or psql).
-- 2) Optional: enable Realtime on these tables for multi-user live sync.
-- 3) PROJECT SCOPING: the current UI uses project_key = 'default'. If you plan multiple
--    projects, add a projects table and reference its key across tasks/links.
