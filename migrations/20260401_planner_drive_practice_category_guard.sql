ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_category_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_category_check
  CHECK (
    category IS NULL
    OR category IN ('assembly', 'electrical', 'software', 'manufacturing', 'cad', 'drive_practice')
  );
