-- Attendance overhaul introducing schedules, locations, and per-user logs
BEGIN;

-- Core locations table describing trusted networks
CREATE TABLE IF NOT EXISTS attendance_locations (
  id            BIGSERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  network_cidr  CIDR NOT NULL,
  description   TEXT,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES user_profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Repeating schedule definition (day-of-week + time window)
CREATE TABLE IF NOT EXISTS attendance_schedules (
  id            BIGSERIAL PRIMARY KEY,
  label         TEXT NOT NULL,
  day_of_week   SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time    TIME NOT NULL,
  end_time      TIME NOT NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID REFERENCES user_profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

-- Join table connecting schedules to one or more approved locations
CREATE TABLE IF NOT EXISTS attendance_schedule_locations (
  schedule_id BIGINT NOT NULL REFERENCES attendance_schedules(id) ON DELETE CASCADE,
  location_id BIGINT NOT NULL REFERENCES attendance_locations(id) ON DELETE CASCADE,
  PRIMARY KEY (schedule_id, location_id)
);

-- Per-user attendance log (one row per successful check-in)
CREATE TABLE IF NOT EXISTS user_attendance_logs (
  id           BIGSERIAL PRIMARY KEY,
  user_id      UUID NOT NULL REFERENCES user_profiles(id),
  location_id  BIGINT REFERENCES attendance_locations(id),
  schedule_id  BIGINT REFERENCES attendance_schedules(id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address   INET NOT NULL,
  notes        TEXT
);

-- Prevent duplicate attendance entries per Pacific-day
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'user_attendance_logs_one_per_day_idx'
  ) THEN
    EXECUTE $$
CREATE UNIQUE INDEX user_attendance_logs_one_per_day_idx
ON user_attendance_logs (user_id, (timezone('America/Los_Angeles', recorded_at))::date);
$$;
  END IF;
END$$;

-- Convenience materialized leaderboard (30-day rolling window)
CREATE OR REPLACE VIEW attendance_leaderboard_30_days AS
SELECT
  up.id AS user_id,
  up.full_name,
  up.email,
  COUNT(DISTINCT (timezone('America/Los_Angeles', logs.recorded_at))::date) AS days_attended,
  COUNT(logs.id) AS total_check_ins,
  MAX(logs.recorded_at) AS last_attended_at
FROM user_profiles up
LEFT JOIN user_attendance_logs logs
  ON logs.user_id = up.id
  AND logs.recorded_at >= NOW() - INTERVAL '30 days'
WHERE COALESCE(up.banned, FALSE) = FALSE
GROUP BY up.id, up.full_name, up.email;

-- Helper to normalize existing allowed_external_ips entries (if table exists)
DO $$
DECLARE
  rec RECORD;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'allowed_external_ips'
      AND table_schema = 'public'
  ) THEN
    FOR rec IN (
      SELECT location_name, ip_address, description
      FROM allowed_external_ips
    ) LOOP
      BEGIN
        INSERT INTO attendance_locations (name, network_cidr, description)
        VALUES (
          COALESCE(NULLIF(rec.location_name, ''), 'Imported Location'),
          (rec.ip_address || '/32')::cidr,
          COALESCE(rec.description, 'Imported from allowed_external_ips')
        )
        ON CONFLICT DO NOTHING;
      EXCEPTION WHEN invalid_text_representation THEN
        -- Skip malformed addresses silently
        NULL;
      END;
    END LOOP;
  END IF;
END$$;

-- Attendance logging function
CREATE OR REPLACE FUNCTION log_user_attendance(p_user_id UUID, p_external_ip TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
DECLARE
  v_now           TIMESTAMPTZ := NOW();
  v_today_pst     DATE := (timezone('America/Los_Angeles', v_now))::date;
  v_current_time  TIME := (timezone('America/Los_Angeles', v_now))::time;
  v_dow           SMALLINT := EXTRACT(DOW FROM timezone('America/Los_Angeles', v_now));
  v_location_id   BIGINT;
  v_schedule_id   BIGINT;
BEGIN
  IF p_user_id IS NULL OR p_external_ip IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Already recorded today (Pacific time)?
  IF EXISTS (
    SELECT 1
    FROM user_attendance_logs
    WHERE user_id = p_user_id
      AND (timezone('America/Los_Angeles', recorded_at))::date = v_today_pst
  ) THEN
    RETURN FALSE;
  END IF;

  -- Find an active schedule/location pair that matches IP + time window
  SELECT l.id, s.id
  INTO v_location_id, v_schedule_id
  FROM attendance_locations l
  JOIN attendance_schedule_locations sl ON sl.location_id = l.id
  JOIN attendance_schedules s ON s.id = sl.schedule_id
  WHERE l.active = TRUE
    AND s.active = TRUE
    AND p_external_ip::inet <<= l.network_cidr
    AND s.day_of_week = v_dow
    AND v_current_time BETWEEN s.start_time AND s.end_time
  ORDER BY s.start_time
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  INSERT INTO user_attendance_logs (user_id, location_id, schedule_id, recorded_at, ip_address)
  VALUES (p_user_id, v_location_id, v_schedule_id, v_now, p_external_ip::inet);

  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

COMMIT;
