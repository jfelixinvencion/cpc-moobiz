-- Split solicitante into solicitante_tm + solicitante_tt (public.control_operaciones).
-- Ejecutar en Supabase SQL Editor o psql tras backup.
-- Preserva datos: valores actuales de solicitante pasan a solicitante_tm.

BEGIN;

ALTER TABLE public.control_operaciones RENAME COLUMN solicitante TO solicitante_tm;

ALTER TABLE public.control_operaciones ADD COLUMN IF NOT EXISTS solicitante_tt text;

COMMIT;

-- Operativa
-- 1) Ejecutar este script en staging antes que producción.
-- 2) Desplegar esta versión de la app solo después de que la migración haya terminado (evita SELECT a columnas inexistentes).
-- 3) Tras RENAME, cualquier cliente antiguo que aún envíe "solicitante" en JSON fallará hasta actualizar.

-- ROLLBACK (manual, si hace falta revertir):
-- BEGIN;
-- ALTER TABLE public.control_operaciones DROP COLUMN IF EXISTS solicitante_tt;
-- ALTER TABLE public.control_operaciones RENAME COLUMN solicitante_tm TO solicitante;
-- COMMIT;
