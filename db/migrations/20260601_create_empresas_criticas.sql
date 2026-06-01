-- Migration: bolsas (Nivel 1/2/3) para subpestaña Clientes
-- NO ejecutar en producción sin revisión DBA / pipeline aprobado.

CREATE TABLE IF NOT EXISTS public."Empresas_Criticas" (
  co_id         TEXT PRIMARY KEY,
  co_name       TEXT NOT NULL,
  bucket_level  SMALLINT NOT NULL CHECK (bucket_level IN (1, 2, 3)),
  created_by    TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_empresas_criticas_bucket_level
  ON public."Empresas_Criticas" (bucket_level);

COMMENT ON TABLE public."Empresas_Criticas" IS
  'Asignación de empresas a bolsas N1/N2/N3 (Clientes). Una empresa solo puede estar en una bolsa (PK co_id).';
