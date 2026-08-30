-- Track which match recordings have had their video file reclaimed.
--
-- Match video is by far the largest thing this feature stores and nothing
-- ever removed it, so an event's worth of multi-camera recordings would grow
-- without bound. The retention sweep
-- (api/notifications/vision-recording-retention) deletes only the file from
-- the vision-recordings bucket and stamps this column; the view row, its
-- tracks, observations, discrepancies and the release audit trail all stay,
-- so a released scouting number keeps its provenance after the video behind
-- it is gone.
--
-- Deletion is opt-in: with VISION_RECORDING_RETENTION_DAYS unset the sweep is
-- a no-op, and it never touches a recording whose run has not been released.

ALTER TABLE public.vision_views
  ADD COLUMN IF NOT EXISTS recording_deleted_at timestamptz;

COMMENT ON COLUMN public.vision_views.recording_deleted_at IS
  'Set when the video file was reclaimed by the retention sweep. The analysis derived from it is retained.';
