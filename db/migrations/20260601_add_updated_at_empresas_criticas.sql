-- 20260601_add_updated_at_empresas_criticas.sql
ALTER TABLE public."Empresas_Criticas"
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

UPDATE public."Empresas_Criticas"
SET updated_at = COALESCE(updated_at, created_at);

-- Trigger para mantener updated_at actualizado en INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER AS }
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
} LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_empresas_criticas_updated_at ON public."Empresas_Criticas";

CREATE TRIGGER trg_empresas_criticas_updated_at
BEFORE INSERT OR UPDATE ON public."Empresas_Criticas"
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();
