-- Conductores Moobiz (extracción /api/admin/drivers). PK = id del conductor en Moobiz.
CREATE TABLE IF NOT EXISTS public.moobiz_drivers (
  id text PRIMARY KEY,
  id_branch text,
  id_role text,
  id_company text,
  id_company_area text,
  show_data_fleets boolean,
  raw_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moobiz_drivers_id_branch ON public.moobiz_drivers (id_branch);
CREATE INDEX IF NOT EXISTS idx_moobiz_drivers_id_company ON public.moobiz_drivers (id_company);

CREATE OR REPLACE FUNCTION public.set_moobiz_drivers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moobiz_drivers_updated_at ON public.moobiz_drivers;
CREATE TRIGGER trg_moobiz_drivers_updated_at
BEFORE UPDATE ON public.moobiz_drivers
FOR EACH ROW
EXECUTE FUNCTION public.set_moobiz_drivers_updated_at();
