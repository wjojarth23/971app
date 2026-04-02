CREATE TABLE IF NOT EXISTS public.runtime_leases (
  key text PRIMARY KEY,
  lease_expires_at timestamptz,
  last_started_at timestamptz,
  last_finished_at timestamptz
);

INSERT INTO public.runtime_leases (key)
VALUES ('planner_prompt_sweep')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_runtime_lease(
  lease_key text,
  lease_seconds integer DEFAULT 120,
  min_interval_seconds integer DEFAULT 0
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_count integer := 0;
BEGIN
  INSERT INTO public.runtime_leases (key, lease_expires_at, last_started_at)
  VALUES (
    lease_key,
    now() + make_interval(secs => GREATEST(1, lease_seconds)),
    now()
  )
  ON CONFLICT (key) DO UPDATE
    SET lease_expires_at = EXCLUDED.lease_expires_at,
        last_started_at = EXCLUDED.last_started_at
    WHERE
      (runtime_leases.lease_expires_at IS NULL OR runtime_leases.lease_expires_at < now())
      AND (
        min_interval_seconds <= 0
        OR runtime_leases.last_finished_at IS NULL
        OR runtime_leases.last_finished_at < now() - make_interval(secs => min_interval_seconds)
      );

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count > 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_runtime_lease(lease_key text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row_count integer := 0;
BEGIN
  UPDATE public.runtime_leases
  SET lease_expires_at = NULL,
      last_finished_at = now()
  WHERE key = lease_key;

  GET DIAGNOSTICS row_count = ROW_COUNT;
  RETURN row_count > 0;
END;
$$;

REVOKE ALL ON TABLE public.runtime_leases FROM PUBLIC;
GRANT SELECT, INSERT, UPDATE ON TABLE public.runtime_leases TO service_role;

REVOKE ALL ON FUNCTION public.claim_runtime_lease(text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_runtime_lease(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_runtime_lease(text, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_runtime_lease(text) TO service_role;
