-- Añade soporte explícito de "VIP LIMA" como categoría separada de "Otros".
-- Esta migración no crea secretos ni depende de credenciales hardcodeadas.
--
-- Recomendación antes de aplicar:
-- 1) Dry-run (conteos):
--    SELECT count(*) FROM public.viajes_activos
--    WHERE upper(coalesce(producto, '')) LIKE '%VIP%LIMA%';
-- 2) Backup lógico de filas afectadas:
--    CREATE TABLE IF NOT EXISTS public.backup_vip_lima_viajes_activos_20260428 AS
--    SELECT * FROM public.viajes_activos
--    WHERE upper(coalesce(producto, '')) LIKE '%VIP%LIMA%';

BEGIN;

-- 1) Reclasificación en viajes_activos.producto (si la tabla/columna existen).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'viajes_activos'
      AND column_name = 'producto'
  ) THEN
    UPDATE public.viajes_activos
    SET producto = 'VIP LIMA'
    WHERE upper(coalesce(producto, '')) LIKE '%VIP%LIMA%';
  END IF;
END $$;

-- 2) Normalización opcional en historial usando raw_data JSON (si existe la tabla).
--    Nota: el campo exacto puede variar según origen (product / producto / service_type / tipo_servicio).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'moobiz_services_history'
  ) THEN
    UPDATE public.moobiz_services_history
    SET raw_data = jsonb_set(
      coalesce(raw_data, '{}'::jsonb),
      '{product}',
      to_jsonb('VIP LIMA'::text),
      true
    )
    WHERE
      upper(coalesce(raw_data ->> 'product', '')) LIKE '%VIP%LIMA%'
      OR upper(coalesce(raw_data ->> 'producto', '')) LIKE '%VIP%LIMA%'
      OR upper(coalesce(raw_data ->> 'service_type', '')) LIKE '%VIP%LIMA%'
      OR upper(coalesce(raw_data ->> 'tipo_servicio', '')) LIKE '%VIP%LIMA%';
  END IF;
END $$;

COMMIT;

-- Rollback orientativo:
-- 1) Restaurar desde backups creados antes del UPDATE.
-- 2) Para viajes_activos:
--    UPDATE public.viajes_activos v
--    SET producto = b.producto
--    FROM public.backup_vip_lima_viajes_activos_20260428 b
--    WHERE v.id = b.id;
