-- Make releasing a vision run atomic.
--
-- release-run previously did three separate REST calls: insert into
-- scout_data_events, then update the run's released_at, then insert the audit
-- log. Two problems follow from that:
--
--   * A failure between the steps leaves real scouting rows behind with no
--     release state and no audit entry - invisible vision-authored data that
--     nothing records the provenance of.
--   * Two concurrent releases both pass the "already released?" read before
--     either writes, so both insert, and the match ends up with doubled fuel
--     and climb events.
--
-- Doing all three inside one function puts them in a single transaction, and
-- the compare-and-swap on released_at makes the second concurrent caller lose
-- cleanly instead of duplicating data. Rows are computed in JS (summarize,
-- climb-vocabulary validation, team attribution) and passed in already
-- vetted; this function's only job is to write them all or none of them.

CREATE OR REPLACE FUNCTION public.release_vision_run(
  p_run_id uuid,
  p_actor uuid,
  p_rows jsonb,
  p_team_count integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_event_ids uuid[];
BEGIN
  -- Claim the release first. Anything that gets past this is the sole writer.
  UPDATE public.vision_runs
     SET released_at = now(), released_by = p_actor
   WHERE id = p_run_id AND released_at IS NULL;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'already_released');
  END IF;

  WITH inserted AS (
    INSERT INTO public.scout_data_events (
      match_key, match_number, team_key, phase,
      event_type, event_value, role, on_shift, created_by, created_at
    )
    SELECT
      row_data->>'match_key',
      NULL,
      row_data->>'team_key',
      NULL,
      row_data->>'event_type',
      row_data->>'event_value',
      'vision',
      NULL,
      p_actor,
      now()
    FROM jsonb_array_elements(p_rows) AS row_data
    RETURNING id
  )
  SELECT array_agg(id) INTO v_event_ids FROM inserted;

  INSERT INTO public.vision_release_log (vision_run_id, released_by, scout_data_event_ids, team_count)
  VALUES (p_run_id, p_actor, COALESCE(v_event_ids, ARRAY[]::uuid[]), p_team_count);

  RETURN jsonb_build_object(
    'ok', true,
    'released_count', COALESCE(array_length(v_event_ids, 1), 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.release_vision_run(uuid, uuid, jsonb, integer) FROM PUBLIC, authenticated;
GRANT EXECUTE ON FUNCTION public.release_vision_run(uuid, uuid, jsonb, integer) TO service_role;
