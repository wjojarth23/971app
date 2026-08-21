-- Material-aware default feeds/speeds for AutoCAM (turning.js/routing.js)
--
-- Real gap this closes: cam_materials had no numeric machining-parameter
-- data at all (just name/category/notes), and CamParamFields.svelte
-- (the feed/speed/step-down form) has never been material-aware - picking
-- a material was purely a label stored on the job, with zero effect on the
-- actual generated G-code's cutting parameters. Every job silently used the
-- same generic defaults (turning.js: feedRough 0.008, spindleSpeed via
-- surfaceSpeed 150 SFM; routing.js: feedRate 40, spindleSpeed 16000)
-- regardless of whether the material was aluminum, plastic, or plywood.
--
-- Mirrors cam_machines.default_params exactly (same jsonb-blob-of-
-- generator-params pattern, same "sensible default the UI applies but a
-- human can still override" philosophy) - NOT a flat merge with a machine's
-- own default_params, though: a material can apply to EITHER operation type
-- (aluminum gets both turned and routed; plywood only ever gets routed), and
-- turning.js/routing.js happen to both use the param key `stepDown` for a
-- physically different quantity (turning: radial depth per roughing pass;
-- routing: Z depth per pass) - storing one flat blob risks silently
-- colliding those under a shared key. Namespaced instead:
--   { "turning": { stepDown, feedRough, feedFinish, surfaceSpeed, maxRpm },
--     "routing": { stepDown, feedRate, plungeRate, spindleSpeed } }
-- src/routes/autocam/+page.svelte's applyMaterialDefaults() reads whichever
-- sub-object matches the job's current operation type.
--
-- VALUES ARE CONSERVATIVE PUBLISHED STARTING POINTS, NOT SHOP-VERIFIED -
-- same standing caveat this whole AutoCAM system already carries everywhere
-- (see turning.js/routing.js's own HEADER_WARNING: "NOT verified on real
-- hardware or a simulator"). Sourced from widely-published general-purpose
-- feeds-and-speeds guidance for small-shop/hobby-class CNC routers and a
-- toolroom lathe, deliberately erring toward the conservative/slower end of
-- published ranges rather than the aggressive end - a slow feed wastes time,
-- an aggressive one picked wrong can break a tool or the part. Tune against
-- this team's actual tooling before trusting these for real production
-- parts; they exist to replace "nothing at all" with a reasonable starting
-- point, not to replace real tuning.

ALTER TABLE public.cam_materials ADD COLUMN IF NOT EXISTS default_params jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Aluminum 6061 - machines on both the lathe and either router. Router
-- values assume a small/hobby-class spindle+HSS or carbide end mill (not a
-- rigid production VMC) - aluminum is gummy enough to load/weld to flutes
-- if fed too slowly or too shallow a stepdown lets the tool rub instead of
-- cut, so these favor a real chip load over a token-slow "safe" number.
-- Turning values assume carbide inserts (typical for 6061 on a toolroom
-- lathe); surface speed and feeds are within standard published ranges for
-- aluminum, at the conservative end.
UPDATE public.cam_materials
SET default_params = '{
  "turning": { "stepDown": 0.05, "feedRough": 0.010, "feedFinish": 0.004, "surfaceSpeed": 350, "maxRpm": 2500 },
  "routing": { "stepDown": 0.03, "feedRate": 25, "plungeRate": 8, "spindleSpeed": 14000 }
}'::jsonb
WHERE name = 'Aluminum 6061';

-- Polycarbonate (Lexan) - plastics need enough speed/feed to shear cleanly
-- rather than melt and re-weld to the tool/part (the real failure mode with
-- plastics run too slow or too hot) - faster feed and shallower per-pass
-- heat buildup than aluminum, lower spindle RPM than a typical router
-- default to reduce frictional heat, still comfortably above the
-- melt-and-smear range for a sharp single/two-flute plastic-cutting bit.
UPDATE public.cam_materials
SET default_params = '{
  "turning": { "stepDown": 0.05, "feedRough": 0.010, "feedFinish": 0.004, "surfaceSpeed": 200, "maxRpm": 2500 },
  "routing": { "stepDown": 0.06, "feedRate": 45, "plungeRate": 12, "spindleSpeed": 12000 }
}'::jsonb
WHERE name = 'Polycarbonate (Lexan)';

-- Baltic Birch Plywood - wood cuts far more easily than metal or plastic;
-- routing-only (nobody turns plywood on a lathe), so the turning sub-object
-- is intentionally left empty rather than populated with a meaningless
-- guess - applyMaterialDefaults() simply has nothing to apply if a plywood
-- job somehow ends up in turning mode.
UPDATE public.cam_materials
SET default_params = '{
  "routing": { "stepDown": 0.125, "feedRate": 90, "plungeRate": 25, "spindleSpeed": 16000 }
}'::jsonb
WHERE name = 'Baltic Birch Plywood';

-- Delrin (Acetal) - machines similarly to aluminum in behavior (rigid,
-- predictable chip formation) but softer and lower-friction, tolerating a
-- somewhat more aggressive feed/stepdown than aluminum at the same
-- conservative-starting-point philosophy; low friction also means less
-- heat buildup than the plastics-melting concern polycarbonate has, so
-- spindle speed isn't held down the same way.
UPDATE public.cam_materials
SET default_params = '{
  "turning": { "stepDown": 0.06, "feedRough": 0.012, "feedFinish": 0.004, "surfaceSpeed": 350, "maxRpm": 2500 },
  "routing": { "stepDown": 0.06, "feedRate": 45, "plungeRate": 12, "spindleSpeed": 14000 }
}'::jsonb
WHERE name = 'Delrin (Acetal)';
