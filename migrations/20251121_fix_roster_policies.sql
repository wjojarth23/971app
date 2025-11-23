BEGIN;

-- Drop outdated policies that only allowed general leads
DROP POLICY IF EXISTS "Rosters are editable by Leads and Subsystem Leads" ON public.rosters;
DROP POLICY IF EXISTS "Roster keys are editable by Leads and Subsystem Leads" ON public.roster_keys;
DROP POLICY IF EXISTS "Roster entries are editable by Leads and Subsystem Leads" ON public.roster_entries;

-- Helper condition: admins, general leads, or anyone with a lead-level team role can modify rosters
CREATE POLICY "Rosters are editable by leadership" ON public.rosters
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                role = 'admin'
                OR general_role IN ('lead', 'subsystem_lead')
                OR team_role ILIKE '%Lead'
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                role = 'admin'
                OR general_role IN ('lead', 'subsystem_lead')
                OR team_role ILIKE '%Lead'
              )
        )
    );

CREATE POLICY "Roster keys are editable by leadership" ON public.roster_keys
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                role = 'admin'
                OR general_role IN ('lead', 'subsystem_lead')
                OR team_role ILIKE '%Lead'
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                role = 'admin'
                OR general_role IN ('lead', 'subsystem_lead')
                OR team_role ILIKE '%Lead'
              )
        )
    );

CREATE POLICY "Roster entries are editable by leadership" ON public.roster_entries
    FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                role = 'admin'
                OR general_role IN ('lead', 'subsystem_lead')
                OR team_role ILIKE '%Lead'
              )
        )
    )
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid()
              AND (
                role = 'admin'
                OR general_role IN ('lead', 'subsystem_lead')
                OR team_role ILIKE '%Lead'
              )
        )
    );

COMMIT;
