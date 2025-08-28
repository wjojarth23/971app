-- Adds storage for Onshape drawing EID so lathe/mill parts can fetch PDFs on the manufacturing route
ALTER TABLE public.parts
  ADD COLUMN IF NOT EXISTS onshape_drawing_element_id character varying;

COMMENT ON COLUMN public.parts.onshape_drawing_element_id IS 'Onshape Drawing element ID (24-char hex) used to translate to PDF for lathe/mill workflows';
