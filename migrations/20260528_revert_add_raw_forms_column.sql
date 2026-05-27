-- REVERT OPCIONAL (solo DBA, tras validación y backup).
-- Si en algún entorno se aplicó migrations/20260527_add_raw_forms_column.sql
-- y el equipo decide eliminar la columna raw_forms en public.moobiz_drivers:
--
-- NO ejecutar automáticamente desde CI ni desde scripts del repo.

-- ALTER TABLE public.moobiz_drivers DROP COLUMN IF EXISTS raw_forms;
