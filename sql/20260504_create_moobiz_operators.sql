-- Operadores Moobiz (extracción /api/admin/operators). PK = id del operador en Moobiz.
CREATE TABLE IF NOT EXISTS public.moobiz_operators (
  id text PRIMARY KEY,
  id_branch text,
  id_role text,
  name text,
  email text,
  raw_data jsonb NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_moobiz_operators_id_branch ON public.moobiz_operators (id_branch);
CREATE INDEX IF NOT EXISTS idx_moobiz_operators_email ON public.moobiz_operators (email);

CREATE OR REPLACE FUNCTION public.set_moobiz_operators_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_moobiz_operators_updated_at ON public.moobiz_operators;
CREATE TRIGGER trg_moobiz_operators_updated_at
BEFORE UPDATE ON public.moobiz_operators
FOR EACH ROW
EXECUTE FUNCTION public.set_moobiz_operators_updated_at();
