ALTER TABLE public.quality_audits
ADD COLUMN IF NOT EXISTS driver_name text;
