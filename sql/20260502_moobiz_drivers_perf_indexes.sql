-- Pending DB-ops: ejecutar en Supabase (SQL editor o psql) con rol que pueda crear índices en public.moobiz_drivers.
-- Objetivo: acelerar filtros / búsquedas usadas por vistas de conductores (GLOBAL, nombre, sucursal desde raw_data).
-- Revertir: DROP INDEX IF EXISTS public.idx_moobiz_drivers_sucursal_expr;
--           DROP INDEX IF EXISTS public.idx_moobiz_drivers_name_expr;
--           DROP INDEX IF EXISTS public.idx_moobiz_drivers_name_trgm;  (si se creó)
--           (opcional) DROP EXTENSION IF EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_moobiz_drivers_sucursal_expr
ON public.moobiz_drivers (
  (COALESCE(
     raw_data ->> 'br_name',
     raw_data ->> 'branch_name',
     raw_data ->> 'sucursal',
     raw_data ->> 'sucursal_name',
     raw_data ->> 'branch'
  ))
);

CREATE INDEX IF NOT EXISTS idx_moobiz_drivers_name_expr
ON public.moobiz_drivers (
  (COALESCE(raw_data ->> 'label', raw_data ->> 'name', raw_data ->> 'full_name'))
);

-- Opcional (requiere extensión y permisos CREATE): mejora ILIKE '%texto%'
-- CREATE EXTENSION IF NOT EXISTS pg_trgm;
-- CREATE INDEX IF NOT EXISTS idx_moobiz_drivers_name_trgm
-- ON public.moobiz_drivers
-- USING gin (
--   (COALESCE(raw_data ->> 'label', raw_data ->> 'name', raw_data ->> 'full_name')) gin_trgm_ops
-- );

-- Evidencia EXPLAIN (ejecutar en prod/staging sustituyendo valores):
-- EXPLAIN ANALYZE
-- SELECT * FROM vista.vw_moobiz_drivers_pendientes
-- WHERE "GLOBAL" = 'LIMA'
-- ORDER BY "N Servicios <30" DESC
-- LIMIT 50 OFFSET 0;
