-- Tighten schema relationships, remove unused tables, and enforce RLS
BEGIN;

-- Drop legacy row-level security policies that either allowed full access or targeted removed tables
DROP POLICY IF EXISTS "Allow all operations on parts" ON public.parts;
DROP POLICY IF EXISTS "Subsystem leads can create builds" ON public.builds;
DROP POLICY IF EXISTS "Subsystem leads can delete their subsystems" ON public.subsystems;
DROP POLICY IF EXISTS "Subsystem leads can update their subsystems" ON public.subsystems;
DROP POLICY IF EXISTS "Subsystem members can update builds" ON public.builds;
DROP POLICY IF EXISTS "Users can access purchasing" ON public.purchasing;
DROP POLICY IF EXISTS "Users can create subsystems" ON public.subsystems;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can join subsystems" ON public.subsystem_members;
DROP POLICY IF EXISTS "Users can leave subsystems" ON public.subsystem_members;
DROP POLICY IF EXISTS "Users can update own profile" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view all profiles" ON public.user_profiles;
DROP POLICY IF EXISTS "Users can view all subsystem memberships" ON public.subsystem_members;
DROP POLICY IF EXISTS "Users can view all subsystems" ON public.subsystems;
DROP POLICY IF EXISTS "Users can view builds for subsystems they're in" ON public.builds;
DROP POLICY IF EXISTS "gantt_links_delete_authenticated" ON public.gantt_links;
DROP POLICY IF EXISTS "gantt_links_insert_authenticated" ON public.gantt_links;
DROP POLICY IF EXISTS "gantt_links_select_authenticated" ON public.gantt_links;
DROP POLICY IF EXISTS "gantt_links_update_authenticated" ON public.gantt_links;
DROP POLICY IF EXISTS "gantt_tasks_delete_authenticated" ON public.gantt_tasks;
DROP POLICY IF EXISTS "gantt_tasks_insert_authenticated" ON public.gantt_tasks;
DROP POLICY IF EXISTS "gantt_tasks_select_authenticated" ON public.gantt_tasks;
DROP POLICY IF EXISTS "gantt_tasks_update_authenticated" ON public.gantt_tasks;

-- Remove unused helper functions, triggers, and RPC entry points
DROP FUNCTION IF EXISTS public.frcbet_leaderboard();
DROP FUNCTION IF EXISTS public.add_part_to_build(uuid, integer);
DROP FUNCTION IF EXISTS public.add_purchasing_to_build(uuid, integer);
DROP FUNCTION IF EXISTS public.get_build_with_all_items(uuid);
DROP FUNCTION IF EXISTS public.get_build_with_parts(uuid);
DROP FUNCTION IF EXISTS public.get_onshape_download_url(text, text, text, text, text, text);

-- Drop legacy tables that no longer have any callers in the application
DROP TABLE IF EXISTS public.betting_bets;
DROP TABLE IF EXISTS public.betting_market_ticks;
DROP TABLE IF EXISTS public.betting_markets;
DROP TABLE IF EXISTS public.predict_settings;
DROP TABLE IF EXISTS public.gantt_links;
DROP TABLE IF EXISTS public.gantt_tasks;
DROP TABLE IF EXISTS public.user_balances;

-- Clean up kitting_bin references before adding foreign keys
UPDATE public.parts p
SET kitting_bin = NULL
WHERE kitting_bin IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.kitting_bins kb WHERE kb.bin_id = p.kitting_bin
  );

UPDATE public.purchasing pr
SET kitting_bin = NULL
WHERE kitting_bin IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.kitting_bins kb WHERE kb.bin_id = pr.kitting_bin
  );

-- Strengthen relationships with new foreign keys
ALTER TABLE public.parts
  ADD CONSTRAINT parts_kitting_bin_fkey
  FOREIGN KEY (kitting_bin) REFERENCES public.kitting_bins(bin_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.purchasing
  ADD CONSTRAINT purchasing_kitting_bin_fkey
  FOREIGN KEY (kitting_bin) REFERENCES public.kitting_bins(bin_id)
  ON UPDATE CASCADE ON DELETE SET NULL;

ALTER TABLE public.scout_data_events
  ADD CONSTRAINT scout_data_events_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id)
  ON DELETE SET NULL;

ALTER TABLE public.scout_match_assignments
  ADD CONSTRAINT scout_match_assignments_assigned_user_fkey
  FOREIGN KEY (assigned_user) REFERENCES auth.users(id)
  ON DELETE SET NULL;

ALTER TABLE public.scout_notes
  ADD CONSTRAINT scout_notes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id)
  ON DELETE SET NULL;

-- Reset privileges so only authenticated and service roles retain access
REVOKE ALL ON public.user_profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.subsystems FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.subsystem_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.builds FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.build_bom FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.parts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.purchasing FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.purchasing_budgets FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.orders FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.vendors FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kitting FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kitting_bins FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.router_groups FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.router_group_parts FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.scout_notes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.scout_data_events FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.scout_match_assignments FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subsystems TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.subsystem_members TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.builds TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.build_bom TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.parts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchasing TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchasing_budgets TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kitting TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.kitting_bins TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.router_groups TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.router_group_parts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scout_notes TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scout_data_events TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.scout_match_assignments TO authenticated;

GRANT ALL ON public.user_profiles TO service_role;
GRANT ALL ON public.subsystems TO service_role;
GRANT ALL ON public.subsystem_members TO service_role;
GRANT ALL ON public.builds TO service_role;
GRANT ALL ON public.build_bom TO service_role;
GRANT ALL ON public.parts TO service_role;
GRANT ALL ON public.purchasing TO service_role;
GRANT ALL ON public.purchasing_budgets TO service_role;
GRANT ALL ON public.orders TO service_role;
GRANT ALL ON public.vendors TO service_role;
GRANT ALL ON public.kitting TO service_role;
GRANT ALL ON public.kitting_bins TO service_role;
GRANT ALL ON public.router_groups TO service_role;
GRANT ALL ON public.router_group_parts TO service_role;
GRANT ALL ON public.scout_notes TO service_role;
GRANT ALL ON public.scout_data_events TO service_role;
GRANT ALL ON public.scout_match_assignments TO service_role;

-- Helper functions for permission-aware RLS predicates
CREATE OR REPLACE FUNCTION public.has_permission(required text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (up.role = 'admin')
             OR (COALESCE(up.permissions, '{}'::text[]) @> ARRAY[required])
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.has_any_permission(required text[])
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (up.role = 'admin')
             OR (required IS NOT NULL AND COALESCE(up.permissions, '{}'::text[]) && required)
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
    ),
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.approved_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT (up.role = 'admin')
             OR (COALESCE(up.permissions, '{}'::text[]) @> ARRAY['CAN_SEE_ROUTES'])
      FROM public.user_profiles up
      WHERE up.id = auth.uid()
    ),
    FALSE
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_permission(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_any_permission(text[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approved_user() TO authenticated, service_role;

-- Enable RLS and add policies for user_profiles
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY user_profiles_select_authenticated ON public.user_profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id OR approved_user());

CREATE POLICY user_profiles_insert_self ON public.user_profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

CREATE POLICY user_profiles_update_self ON public.user_profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY user_profiles_admin_manage ON public.user_profiles
FOR UPDATE
TO authenticated
USING (has_any_permission(ARRAY['VIEW_ADMIN_PANEL','EDIT_PERMISSIONS','BAN_USERS','PROMOTE_USERS','APPROVE_USERS']))
WITH CHECK (has_any_permission(ARRAY['VIEW_ADMIN_PANEL','EDIT_PERMISSIONS','BAN_USERS','PROMOTE_USERS','APPROVE_USERS']));

CREATE POLICY user_profiles_delete_admin ON public.user_profiles
FOR DELETE
TO authenticated
USING (has_any_permission(ARRAY['BAN_USERS','PROMOTE_USERS']));

CREATE POLICY user_profiles_service_all ON public.user_profiles
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Subsystems
ALTER TABLE public.subsystems ENABLE ROW LEVEL SECURITY;
CREATE POLICY subsystems_select_authenticated ON public.subsystems
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY subsystems_insert_manage ON public.subsystems
FOR INSERT TO authenticated
WITH CHECK (has_permission('CREATE_SUBSYSTEMS'));

CREATE POLICY subsystems_update_manage ON public.subsystems
FOR UPDATE TO authenticated
USING (has_permission('CREATE_SUBSYSTEMS') OR auth.uid() = lead_user_id)
WITH CHECK (has_permission('CREATE_SUBSYSTEMS') OR auth.uid() = lead_user_id);

CREATE POLICY subsystems_delete_manage ON public.subsystems
FOR DELETE TO authenticated
USING (has_permission('CREATE_SUBSYSTEMS') OR auth.uid() = lead_user_id);

CREATE POLICY subsystems_service_all ON public.subsystems
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Subsystem members
ALTER TABLE public.subsystem_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY subsystem_members_select_authenticated ON public.subsystem_members
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY subsystem_members_insert_self ON public.subsystem_members
FOR INSERT TO authenticated
WITH CHECK (auth.uid() = user_id OR has_permission('CREATE_SUBSYSTEMS'));

CREATE POLICY subsystem_members_delete_self ON public.subsystem_members
FOR DELETE TO authenticated
USING (auth.uid() = user_id OR has_permission('CREATE_SUBSYSTEMS'));

CREATE POLICY subsystem_members_service_all ON public.subsystem_members
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Builds
ALTER TABLE public.builds ENABLE ROW LEVEL SECURITY;
CREATE POLICY builds_select_authenticated ON public.builds
FOR SELECT TO authenticated
USING (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1 FROM public.subsystem_members sm
    WHERE sm.subsystem_id = builds.subsystem_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY builds_insert_manage ON public.builds
FOR INSERT TO authenticated
WITH CHECK (has_permission('CREATE_BUILDS'));

CREATE POLICY builds_update_manage ON public.builds
FOR UPDATE TO authenticated
USING (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1 FROM public.subsystem_members sm
    WHERE sm.subsystem_id = builds.subsystem_id AND sm.user_id = auth.uid()
  )
)
WITH CHECK (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1 FROM public.subsystem_members sm
    WHERE sm.subsystem_id = builds.subsystem_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY builds_delete_manage ON public.builds
FOR DELETE TO authenticated
USING (has_permission('CREATE_BUILDS'));

CREATE POLICY builds_service_all ON public.builds
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Build BOM rows follow parent build access
ALTER TABLE public.build_bom ENABLE ROW LEVEL SECURITY;
CREATE POLICY build_bom_select_authenticated ON public.build_bom
FOR SELECT TO authenticated
USING (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1
    FROM public.builds b
    JOIN public.subsystem_members sm ON sm.subsystem_id = b.subsystem_id
    WHERE b.id = public.build_bom.build_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY build_bom_insert_authenticated ON public.build_bom
FOR INSERT TO authenticated
WITH CHECK (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1
    FROM public.builds b
    JOIN public.subsystem_members sm ON sm.subsystem_id = b.subsystem_id
    WHERE b.id = public.build_bom.build_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY build_bom_update_authenticated ON public.build_bom
FOR UPDATE TO authenticated
USING (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1
    FROM public.builds b
    JOIN public.subsystem_members sm ON sm.subsystem_id = b.subsystem_id
    WHERE b.id = public.build_bom.build_id AND sm.user_id = auth.uid()
  )
)
WITH CHECK (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1
    FROM public.builds b
    JOIN public.subsystem_members sm ON sm.subsystem_id = b.subsystem_id
    WHERE b.id = public.build_bom.build_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY build_bom_delete_authenticated ON public.build_bom
FOR DELETE TO authenticated
USING (
  has_permission('CREATE_BUILDS')
  OR EXISTS (
    SELECT 1
    FROM public.builds b
    JOIN public.subsystem_members sm ON sm.subsystem_id = b.subsystem_id
    WHERE b.id = public.build_bom.build_id AND sm.user_id = auth.uid()
  )
);

CREATE POLICY build_bom_service_all ON public.build_bom
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Parts
ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY parts_select_authenticated ON public.parts
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY parts_insert_authenticated ON public.parts
FOR INSERT TO authenticated
WITH CHECK (approved_user());

CREATE POLICY parts_update_authenticated ON public.parts
FOR UPDATE TO authenticated
USING (approved_user())
WITH CHECK (approved_user());

CREATE POLICY parts_delete_authenticated ON public.parts
FOR DELETE TO authenticated
USING (approved_user());

CREATE POLICY parts_service_all ON public.parts
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Purchasing
ALTER TABLE public.purchasing ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchasing_select_authenticated ON public.purchasing
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY purchasing_insert_authenticated ON public.purchasing
FOR INSERT TO authenticated
WITH CHECK (approved_user());

CREATE POLICY purchasing_update_authenticated ON public.purchasing
FOR UPDATE TO authenticated
USING (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']))
WITH CHECK (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY purchasing_delete_authenticated ON public.purchasing
FOR DELETE TO authenticated
USING (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY purchasing_service_all ON public.purchasing
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Purchasing budgets remain active for purchasing admin workflows
ALTER TABLE public.purchasing_budgets ENABLE ROW LEVEL SECURITY;
CREATE POLICY purchasing_budgets_select_authenticated ON public.purchasing_budgets
FOR SELECT TO authenticated
USING (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY purchasing_budgets_insert_authenticated ON public.purchasing_budgets
FOR INSERT TO authenticated
WITH CHECK (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY purchasing_budgets_update_authenticated ON public.purchasing_budgets
FOR UPDATE TO authenticated
USING (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']))
WITH CHECK (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY purchasing_budgets_delete_authenticated ON public.purchasing_budgets
FOR DELETE TO authenticated
USING (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY purchasing_budgets_service_all ON public.purchasing_budgets
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Orders
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY orders_authenticated_manage ON public.orders
FOR ALL TO authenticated
USING (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']))
WITH CHECK (has_any_permission(ARRAY['PLACE_ORDERS_MISC','APPROVE_PURCHASES']));

CREATE POLICY orders_service_all ON public.orders
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Vendors
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY vendors_select_authenticated ON public.vendors
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY vendors_insert_authenticated ON public.vendors
FOR INSERT TO authenticated
WITH CHECK (has_permission('PLACE_ORDERS_MISC'));

CREATE POLICY vendors_update_authenticated ON public.vendors
FOR UPDATE TO authenticated
USING (has_permission('PLACE_ORDERS_MISC'))
WITH CHECK (has_permission('PLACE_ORDERS_MISC'));

CREATE POLICY vendors_delete_authenticated ON public.vendors
FOR DELETE TO authenticated
USING (has_permission('PLACE_ORDERS_MISC'));

CREATE POLICY vendors_service_all ON public.vendors
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Kitting bins
ALTER TABLE public.kitting_bins ENABLE ROW LEVEL SECURITY;
CREATE POLICY kitting_bins_select_authenticated ON public.kitting_bins
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY kitting_bins_insert_authenticated ON public.kitting_bins
FOR INSERT TO authenticated
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY kitting_bins_update_authenticated ON public.kitting_bins
FOR UPDATE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'))
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY kitting_bins_delete_authenticated ON public.kitting_bins
FOR DELETE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY kitting_bins_service_all ON public.kitting_bins
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Kitting
ALTER TABLE public.kitting ENABLE ROW LEVEL SECURITY;
CREATE POLICY kitting_select_authenticated ON public.kitting
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY kitting_insert_authenticated ON public.kitting
FOR INSERT TO authenticated
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY kitting_update_authenticated ON public.kitting
FOR UPDATE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'))
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY kitting_delete_authenticated ON public.kitting
FOR DELETE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY kitting_service_all ON public.kitting
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Router groups
ALTER TABLE public.router_groups ENABLE ROW LEVEL SECURITY;
CREATE POLICY router_groups_select_authenticated ON public.router_groups
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY router_groups_insert_authenticated ON public.router_groups
FOR INSERT TO authenticated
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY router_groups_update_authenticated ON public.router_groups
FOR UPDATE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'))
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY router_groups_delete_authenticated ON public.router_groups
FOR DELETE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY router_groups_service_all ON public.router_groups
FOR ALL TO service_role
USING (true) WITH CHECK (true);

ALTER TABLE public.router_group_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY router_group_parts_select_authenticated ON public.router_group_parts
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY router_group_parts_insert_authenticated ON public.router_group_parts
FOR INSERT TO authenticated
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY router_group_parts_update_authenticated ON public.router_group_parts
FOR UPDATE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'))
WITH CHECK (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY router_group_parts_delete_authenticated ON public.router_group_parts
FOR DELETE TO authenticated
USING (has_permission('CAN_SEE_ROUTES'));

CREATE POLICY router_group_parts_service_all ON public.router_group_parts
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Scout notes
ALTER TABLE public.scout_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_notes_select_authenticated ON public.scout_notes
FOR SELECT TO authenticated
USING (approved_user());

CREATE POLICY scout_notes_insert_authenticated ON public.scout_notes
FOR INSERT TO authenticated
WITH CHECK (approved_user());

CREATE POLICY scout_notes_modify_authenticated ON public.scout_notes
FOR UPDATE TO authenticated
USING (has_permission('NOTE_SCOUT_ADMIN') OR auth.uid() = created_by)
WITH CHECK (has_permission('NOTE_SCOUT_ADMIN') OR auth.uid() = created_by);

CREATE POLICY scout_notes_delete_authenticated ON public.scout_notes
FOR DELETE TO authenticated
USING (has_permission('NOTE_SCOUT_ADMIN') OR auth.uid() = created_by);

CREATE POLICY scout_notes_service_all ON public.scout_notes
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Scout data events (data scouting logs)
ALTER TABLE public.scout_data_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_data_events_select_members ON public.scout_data_events
FOR SELECT TO authenticated
USING (has_any_permission(ARRAY['DATA_SCOUT_ADMIN','DATA_SCOUT_MEMBER']));

CREATE POLICY scout_data_events_insert_members ON public.scout_data_events
FOR INSERT TO authenticated
WITH CHECK (has_any_permission(ARRAY['DATA_SCOUT_ADMIN','DATA_SCOUT_MEMBER']));

CREATE POLICY scout_data_events_update_admin ON public.scout_data_events
FOR UPDATE TO authenticated
USING (has_permission('DATA_SCOUT_ADMIN'))
WITH CHECK (has_permission('DATA_SCOUT_ADMIN'));

CREATE POLICY scout_data_events_delete_admin ON public.scout_data_events
FOR DELETE TO authenticated
USING (has_permission('DATA_SCOUT_ADMIN'));

CREATE POLICY scout_data_events_service_all ON public.scout_data_events
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Scout match assignments
ALTER TABLE public.scout_match_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY scout_assignments_select ON public.scout_match_assignments
FOR SELECT TO authenticated
USING (
  assigned_user = auth.uid()
  OR (scouting_type = 'data' AND has_permission('DATA_SCOUT_ADMIN'))
  OR (scouting_type = 'note' AND has_permission('NOTE_SCOUT_ADMIN'))
);

CREATE POLICY scout_assignments_insert ON public.scout_match_assignments
FOR INSERT TO authenticated
WITH CHECK (
  (scouting_type = 'data' AND has_permission('DATA_SCOUT_ADMIN'))
  OR (scouting_type = 'note' AND has_permission('NOTE_SCOUT_ADMIN'))
);

CREATE POLICY scout_assignments_update ON public.scout_match_assignments
FOR UPDATE TO authenticated
USING (
  (scouting_type = 'data' AND has_permission('DATA_SCOUT_ADMIN'))
  OR (scouting_type = 'note' AND has_permission('NOTE_SCOUT_ADMIN'))
)
WITH CHECK (
  (scouting_type = 'data' AND has_permission('DATA_SCOUT_ADMIN'))
  OR (scouting_type = 'note' AND has_permission('NOTE_SCOUT_ADMIN'))
);

CREATE POLICY scout_assignments_delete ON public.scout_match_assignments
FOR DELETE TO authenticated
USING (
  (scouting_type = 'data' AND has_permission('DATA_SCOUT_ADMIN'))
  OR (scouting_type = 'note' AND has_permission('NOTE_SCOUT_ADMIN'))
);

CREATE POLICY scout_assignments_service_all ON public.scout_match_assignments
FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Final helper grants
COMMIT;
