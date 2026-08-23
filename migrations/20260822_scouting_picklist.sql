-- Shared, collaboratively-maintained alliance-selection pick list per event.
-- The whole payoff of a comparison table (src/routes/scouting) is turning
-- data into a decision - this is that decision, persisted and shared with
-- the whole team rather than living in one person's head or a scratch doc.
--
-- Idempotent (IF NOT EXISTS everywhere) - safe to re-run, matching this
-- repo's established migration convention.

CREATE TABLE IF NOT EXISTS public.scouting_picklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  team_key text NOT NULL,
  team_number integer,
  nickname text,
  position integer NOT NULL,
  note text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, team_key)
);

CREATE INDEX IF NOT EXISTS scouting_picklist_event_key_idx ON public.scouting_picklist (event_key, position);

ALTER TABLE public.scouting_picklist ENABLE ROW LEVEL SECURITY;

-- Deliberately more open than scout_notes' creator-or-admin write pattern:
-- a pick list is a single shared document the whole scouting/strategy group
-- edits together in real time during alliance selection, not a set of
-- individual observations worth protecting from other people's edits.
-- Restricting UPDATE to "creator only" (the scout_notes pattern) would break
-- reordering, since moving one team up the list touches every row's
-- `position` regardless of who added each one. Any approved user can
-- add/reorder/annotate/remove any entry.
DROP POLICY IF EXISTS "scouting_picklist_select_authenticated" ON public.scouting_picklist;
CREATE POLICY "scouting_picklist_select_authenticated" ON public.scouting_picklist
  FOR SELECT TO authenticated USING (public.approved_user());

DROP POLICY IF EXISTS "scouting_picklist_insert_authenticated" ON public.scouting_picklist;
CREATE POLICY "scouting_picklist_insert_authenticated" ON public.scouting_picklist
  FOR INSERT TO authenticated WITH CHECK (public.approved_user());

DROP POLICY IF EXISTS "scouting_picklist_update_authenticated" ON public.scouting_picklist;
CREATE POLICY "scouting_picklist_update_authenticated" ON public.scouting_picklist
  FOR UPDATE TO authenticated USING (public.approved_user()) WITH CHECK (public.approved_user());

DROP POLICY IF EXISTS "scouting_picklist_delete_authenticated" ON public.scouting_picklist;
CREATE POLICY "scouting_picklist_delete_authenticated" ON public.scouting_picklist
  FOR DELETE TO authenticated USING (public.approved_user());

DROP POLICY IF EXISTS "scouting_picklist_service_all" ON public.scouting_picklist;
CREATE POLICY "scouting_picklist_service_all" ON public.scouting_picklist
  TO service_role USING (true) WITH CHECK (true);
