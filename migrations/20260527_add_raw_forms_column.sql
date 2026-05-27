-- Almacena la respuesta completa de POST /api/admin/drivers/form por conductor.
-- Poblado por scripts/update_raw_forms_job.js (independiente del sync de raw_data).

ALTER TABLE public.moobiz_drivers
  ADD COLUMN IF NOT EXISTS raw_forms jsonb;

COMMENT ON COLUMN public.moobiz_drivers.raw_forms IS
  'JSON completo devuelto por POST /api/admin/drivers/form para este conductor. No modifica raw_data del sync.';

-- Índice opcional (descomentar solo si hay consultas frecuentes por claves dentro de raw_forms):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_moobiz_drivers_raw_forms_gin
--   ON public.moobiz_drivers USING gin (raw_forms);
