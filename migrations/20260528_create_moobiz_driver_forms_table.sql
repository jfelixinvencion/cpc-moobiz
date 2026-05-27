-- Tabla independiente: respuestas completas POST /api/admin/drivers/form.
-- NO modifica public.moobiz_drivers. Aplicar manualmente (DBA / pipeline migraciones).
--
-- Revisar tras aplicar: triggers heredados, constraints, índices en moobiz_drivers que
-- quizá no apliquen a esta tabla. Índice GIN en forms: opcional (ver docs).

BEGIN;

CREATE TABLE IF NOT EXISTS public.moobiz_driver_forms (
  LIKE public.moobiz_drivers INCLUDING ALL
);

-- JSON completo de POST /api/admin/drivers/form (ok, forms, item, etc.)
ALTER TABLE public.moobiz_driver_forms
  ADD COLUMN IF NOT EXISTS forms jsonb;

COMMENT ON TABLE public.moobiz_driver_forms IS
  'Formularios Moobiz por conductor (POST /api/admin/drivers/form). Sync: scripts/sync_moobiz_driver_forms.js';

COMMENT ON COLUMN public.moobiz_driver_forms.forms IS
  'Respuesta JSON cruda del endpoint drivers/form para este id.';

-- Opcional (evaluar en staging según consultas):
-- CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_moobiz_driver_forms_forms_gin
--   ON public.moobiz_driver_forms USING gin (forms);

COMMIT;
