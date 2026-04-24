CREATE TABLE IF NOT EXISTS public.quality_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id text,
  driver_name text,
  vehicle_plate text,
  auditor_id uuid NOT NULL,
  auditor_name text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  status text DEFAULT 'draft',
  fotos_count int DEFAULT 0,
  foto_paths text[] DEFAULT '{}',
  estado text,
  usuario_estado text,
  resultado text,
  score int,
  checklist jsonb,
  raw_data jsonb,
  notes text,
  created_by uuid NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_quality_audits_driver_id
  ON public.quality_audits (driver_id);

CREATE INDEX IF NOT EXISTS idx_quality_audits_created_at
  ON public.quality_audits (created_at DESC);

CREATE OR REPLACE FUNCTION public.set_quality_audits_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quality_audits_updated_at ON public.quality_audits;
CREATE TRIGGER trg_quality_audits_updated_at
BEFORE UPDATE ON public.quality_audits
FOR EACH ROW
EXECUTE FUNCTION public.set_quality_audits_updated_at();

ALTER TABLE public.quality_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quality_insert ON public.quality_audits;
CREATE POLICY quality_insert ON public.quality_audits
  FOR INSERT
  TO authenticated
  WITH CHECK (
    COALESCE((auth.jwt() ->> 'is_quality')::boolean, false) = true
    OR lower(COALESCE(auth.jwt() ->> 'role', '')) = 'quality'
  );

DROP POLICY IF EXISTS quality_update ON public.quality_audits;
CREATE POLICY quality_update ON public.quality_audits
  FOR UPDATE
  TO authenticated
  USING (
    COALESCE((auth.jwt() ->> 'is_quality')::boolean, false) = true
    OR lower(COALESCE(auth.jwt() ->> 'role', '')) = 'quality'
  )
  WITH CHECK (
    COALESCE((auth.jwt() ->> 'is_quality')::boolean, false) = true
    OR lower(COALESCE(auth.jwt() ->> 'role', '')) = 'quality'
  );

DROP POLICY IF EXISTS quality_select ON public.quality_audits;
CREATE POLICY quality_select ON public.quality_audits
  FOR SELECT
  TO authenticated
  USING (true);
