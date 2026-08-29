-- Named auto start zones per camera view.
--
-- datascout records auto_start_position as one of five named field regions
-- ("left trench", "left mound", "center", "right mound", "right trench").
-- Vision has always known where a robot was sitting when auto began - it is
-- the first point of that robot's trajectory - but geometry alone can't name
-- the region, so the value was simply never produced.
--
-- Drawing the regions once per venue per camera (in the Calibrate panel,
-- alongside the field mask and goal zones) closes that gap. Same shape as
-- goal_zones: [{ "label": "center", "polygon": [[x,y], ...] }] with polygon
-- points normalized 0-1. With nothing calibrated the release simply omits
-- auto_start_position rather than guessing.

ALTER TABLE public.vision_views
  ADD COLUMN IF NOT EXISTS start_zones jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN public.vision_views.start_zones IS
  'Named auto start regions, normalized 0-1 polygons. Labels must match datascout auto_start_position values.';
