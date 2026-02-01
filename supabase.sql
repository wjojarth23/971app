-- WARNING: This schema is for context only and is not meant to be run.
-- Table order and constraints may not be valid for execution.

CREATE TABLE public.betting_bets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL,
  user_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome = ANY (ARRAY['red'::text, 'blue'::text])),
  amount numeric NOT NULL CHECK (amount > 0::numeric),
  shares numeric NOT NULL CHECK (shares >= 0::numeric),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT betting_bets_pkey PRIMARY KEY (id),
  CONSTRAINT betting_bets_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.betting_markets(id),
  CONSTRAINT betting_bets_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.betting_market_ticks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL,
  q_red numeric NOT NULL DEFAULT 0,
  q_blue numeric NOT NULL DEFAULT 0,
  price_red numeric NOT NULL DEFAULT 0,
  price_blue numeric NOT NULL DEFAULT 0,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT betting_market_ticks_pkey PRIMARY KEY (id),
  CONSTRAINT betting_market_ticks_market_id_fkey FOREIGN KEY (market_id) REFERENCES public.betting_markets(id)
);
CREATE TABLE public.betting_markets (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  match_key text NOT NULL UNIQUE,
  event_key text,
  red_team_keys ARRAY NOT NULL DEFAULT '{}'::text[],
  blue_team_keys ARRAY NOT NULL DEFAULT '{}'::text[],
  b numeric NOT NULL DEFAULT 50,
  q_red numeric NOT NULL DEFAULT 0,
  q_blue numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open'::text CHECK (status = ANY (ARRAY['open'::text, 'settled'::text, 'cancelled'::text])),
  start_time bigint,
  winning_outcome text CHECK (winning_outcome = ANY (ARRAY['red'::text, 'blue'::text])),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT betting_markets_pkey PRIMARY KEY (id)
);
CREATE TABLE public.build_bom (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL,
  part_name character varying NOT NULL,
  part_number character varying,
  quantity integer NOT NULL DEFAULT 1,
  part_type character varying NOT NULL CHECK (part_type::text = ANY (ARRAY['COTS'::character varying::text, 'manufactured'::character varying::text, 'other'::character varying::text])),
  material character varying,
  stock_assignment character varying,
  workflow character varying,
  bounding_box_x numeric,
  bounding_box_y numeric,
  bounding_box_z numeric,
  onshape_part_id character varying,
  status character varying DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['pending'::character varying::text, 'ordered'::character varying::text, 'delivered'::character varying::text, 'manufactured'::character varying::text, 'in-progress'::character varying::text, 'cammed'::character varying::text, 'complete'::character varying::text])),
  onshape_document_id character varying,
  onshape_wvm character varying,
  onshape_wvmid character varying,
  onshape_element_id character varying,
  file_format character varying CHECK (file_format::text = ANY (ARRAY['stl'::character varying::text, 'parasolid'::character varying::text, 'step'::character varying::text, 'iges'::character varying::text])),
  is_onshape_part boolean DEFAULT false,
  file_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  stock_assignment_custom text,
  added boolean DEFAULT false,
  parts_id bigint,
  purchasing_id bigint,
  kitting_id bigint,
  CONSTRAINT build_bom_pkey PRIMARY KEY (id),
  CONSTRAINT build_bom_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.builds(id),
  CONSTRAINT build_bom_parts_id_fkey FOREIGN KEY (parts_id) REFERENCES public.parts(id),
  CONSTRAINT build_bom_purchasing_id_fkey FOREIGN KEY (purchasing_id) REFERENCES public.purchasing(id),
  CONSTRAINT build_bom_kitting_id_fkey FOREIGN KEY (kitting_id) REFERENCES public.kitting(id)
);
CREATE TABLE public.builds (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subsystem_id uuid,
  release_id character varying NOT NULL,
  release_name character varying NOT NULL,
  build_hash character varying NOT NULL UNIQUE,
  status character varying DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['pending'::character varying::text, 'manufacturing'::character varying::text, 'ready_to_assemble'::character varying::text, 'assembled'::character varying::text])),
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  assembled_at timestamp with time zone,
  assembled_by uuid,
  project_id text,
  approved boolean NOT NULL DEFAULT false,
  approver text,
  slack_channel text,
  slack_ts text,
  CONSTRAINT builds_pkey PRIMARY KEY (id),
  CONSTRAINT builds_assembled_by_fkey FOREIGN KEY (assembled_by) REFERENCES auth.users(id),
  CONSTRAINT builds_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id),
  CONSTRAINT builds_subsystem_id_fkey FOREIGN KEY (subsystem_id) REFERENCES public.subsystems(id)
);
CREATE TABLE public.gantt_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_key text NOT NULL CHECK (char_length(project_key) > 0),
  source_id uuid NOT NULL,
  target_id uuid NOT NULL,
  type text NOT NULL DEFAULT 'e2e'::text,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gantt_links_pkey PRIMARY KEY (id),
  CONSTRAINT gantt_links_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.gantt_tasks(id),
  CONSTRAINT gantt_links_target_id_fkey FOREIGN KEY (target_id) REFERENCES public.gantt_tasks(id)
);
CREATE TABLE public.gantt_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  project_key text NOT NULL CHECK (char_length(project_key) > 0),
  text text NOT NULL DEFAULT ''::text,
  start_date timestamp with time zone NOT NULL,
  end_date timestamp with time zone NOT NULL,
  progress numeric NOT NULL DEFAULT 0,
  type text NOT NULL DEFAULT 'task'::text CHECK (type = ANY (ARRAY['task'::text, 'summary'::text, 'milestone'::text])),
  parent_id uuid,
  created_by uuid NOT NULL DEFAULT auth.uid(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT gantt_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT gantt_tasks_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.gantt_tasks(id)
);
CREATE TABLE public.kitting (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  requester text NOT NULL,
  project_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  material text NOT NULL DEFAULT ''::text,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'kitted'::text])),
  workflow text NOT NULL DEFAULT 'kit'::text CHECK (workflow = 'kit'::text),
  kitting_bin text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT kitting_pkey PRIMARY KEY (id),
  CONSTRAINT kitting_kitting_bin_fkey FOREIGN KEY (kitting_bin) REFERENCES public.kitting_bins(bin_id)
);
CREATE TABLE public.kitting_bins (
  bin_id text NOT NULL,
  name text NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT kitting_bins_pkey PRIMARY KEY (bin_id)
);
CREATE TABLE public.parts (
  id bigint NOT NULL DEFAULT nextval('parts_id_seq'::regclass),
  name text NOT NULL,
  requester text NOT NULL,
  project_id text NOT NULL,
  workflow text NOT NULL CHECK (workflow = ANY (ARRAY['laser-cut'::text, 'router'::text, 'lathe'::text, 'mill'::text, '3d-print'::text, 'purchase'::text])),
  status text NOT NULL DEFAULT 'pending'::text,
  file_name text NOT NULL,
  file_url text NOT NULL,
  kitting_bin text,
  delivered boolean DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  updated_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  material text NOT NULL DEFAULT ''::text,
  gcode_file_name text,
  gcode_file_url text,
  onshape_document_id character varying,
  onshape_wvm character varying,
  onshape_wvmid character varying,
  onshape_element_id character varying,
  onshape_part_id character varying,
  file_format character varying CHECK (file_format::text = ANY (ARRAY['stl'::character varying::text, 'parasolid'::character varying::text, 'step'::character varying::text, 'iges'::character varying::text])),
  is_onshape_part boolean DEFAULT false,
  cut_date timestamp with time zone,
  layout_x numeric,
  layout_y numeric,
  layout_rotation numeric DEFAULT 0,
  onshape_drawing_element_id character varying,
  stock_assignment text,
  CONSTRAINT parts_pkey PRIMARY KEY (id)
);
CREATE TABLE public.predict_settings (
  id text NOT NULL DEFAULT 'global'::text,
  demo boolean NOT NULL DEFAULT false,
  competitions ARRAY NOT NULL DEFAULT '{}'::text[],
  tab_visible boolean NOT NULL DEFAULT false,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT predict_settings_pkey PRIMARY KEY (id)
);
CREATE TABLE public.purchasing (
  id bigint NOT NULL DEFAULT nextval('purchasing_id_seq'::regclass),
  name text NOT NULL,
  requester text NOT NULL,
  project_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  material text DEFAULT ''::text,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'approved'::text, 'ordered'::text, 'delivered'::text, 'kitted'::text, 'rejected'::text])),
  vendor text,
  url text,
  price numeric,
  final_price numeric,
  part_number text,
  kitting_bin text,
  delivered boolean DEFAULT false,
  workflow text DEFAULT 'purchase'::text CHECK (workflow = 'purchase'::text),
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  approved boolean NOT NULL DEFAULT false,
  approver text,
  notes text,
  purchaser uuid,
  slack_channel text,
  slack_ts text,
  order_id bigint,
  shipping_cost_allocated numeric DEFAULT 0,
  CONSTRAINT purchasing_pkey PRIMARY KEY (id),
  CONSTRAINT purchasing_purchaser_fkey FOREIGN KEY (purchaser) REFERENCES auth.users(id),
  CONSTRAINT purchasing_order_id_fkey FOREIGN KEY (order_id) REFERENCES public.orders(id)
);

CREATE TABLE public.orders (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  order_number text NOT NULL UNIQUE,
  vendor text,
  total_items integer NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  shipping_cost numeric NOT NULL DEFAULT 0,
  placed_by uuid,
  placed_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_placed_by_fkey FOREIGN KEY (placed_by) REFERENCES auth.users(id)
);
CREATE TABLE public.router_group_parts (
  group_id uuid NOT NULL,
  part_id bigint NOT NULL,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT router_group_parts_pkey PRIMARY KEY (part_id, group_id),
  CONSTRAINT router_group_parts_group_id_fkey FOREIGN KEY (group_id) REFERENCES public.router_groups(id),
  CONSTRAINT router_group_parts_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id)
);
CREATE TABLE public.router_groups (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT ''::text,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT router_groups_pkey PRIMARY KEY (id)
);
CREATE TABLE public.subsystem_members (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  subsystem_id uuid,
  user_id uuid,
  joined_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subsystem_members_pkey PRIMARY KEY (id),
  CONSTRAINT subsystem_members_unique_membership UNIQUE (subsystem_id, user_id),
  CONSTRAINT subsystem_members_subsystem_id_fkey FOREIGN KEY (subsystem_id) REFERENCES public.subsystems(id),
  CONSTRAINT subsystem_members_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.subsystems (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name character varying NOT NULL,
  description text,
  lead_user_id uuid,
  onshape_url text,
  onshape_document_id character varying,
  onshape_workspace_id character varying,
  onshape_element_id character varying,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT subsystems_pkey PRIMARY KEY (id),
  CONSTRAINT subsystems_lead_user_id_fkey FOREIGN KEY (lead_user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_balances (
  user_id uuid NOT NULL,
  balance numeric NOT NULL DEFAULT 100,
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_balances_pkey PRIMARY KEY (user_id),
  CONSTRAINT user_balances_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id)
);
CREATE TABLE public.user_profiles (
  id uuid NOT NULL,
  email character varying,
  full_name character varying,
  role character varying DEFAULT 'member'::character varying,
  permissions ARRAY,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  banned boolean DEFAULT false,
  notification_settings jsonb DEFAULT '{}'::jsonb,
  slack_user_id text,
  slack_dm_channel text,
  CONSTRAINT user_profiles_pkey PRIMARY KEY (id),
  CONSTRAINT user_profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id)
);

CREATE TABLE public.vendors (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  url_base text NOT NULL,
  free_shipping boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT vendors_pkey PRIMARY KEY (id),
  CONSTRAINT vendors_name_unique UNIQUE (name)
);

-- Migration: add profile customization columns
-- Run the SQL below against your Supabase/Postgres database to add support for header_tabs and dashboard_layout
-- This migration is additive and preserves existing data.
-- Example: psql 'postgresql://...'

-- ALTER TABLE public.user_profiles
--   ADD COLUMN header_tabs jsonb DEFAULT NULL,
--   ADD COLUMN dashboard_layout text DEFAULT 'grid';

-- Scouting notes table for simple text notes per match/team
CREATE TABLE public.scout_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  match_key text NOT NULL,
  match_number integer,
  team_key text NOT NULL,
  notes text,
  created_by uuid,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT scout_notes_pkey PRIMARY KEY (id)
);

CREATE TABLE public.user_notification_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_key text NOT NULL,
  sent_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT user_notification_logs_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX user_notification_logs_key ON public.user_notification_logs (user_id, event_type, entity_key);