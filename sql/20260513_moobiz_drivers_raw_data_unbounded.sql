-- Asegura que raw_data no esté limitado por varchar(n) (p. ej. 1024) en instalaciones legacy.
-- Tras aplicar, re-ejecutar sync de conductores (npm run sync:drivers o POST /api/moobiz-drivers/sync).

DO $$
DECLARE
  dt text;
BEGIN
  SELECT c.data_type INTO dt
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'moobiz_drivers'
    AND c.column_name = 'raw_data';

  IF dt IS NULL THEN
    RAISE NOTICE 'moobiz_drivers.raw_data: columna no existe (¿falta 20260426_create_moobiz_drivers.sql?)';
  ELSIF dt = 'jsonb' THEN
    RAISE NOTICE 'moobiz_drivers.raw_data: ya es jsonb (sin cambio de tipo)';
  ELSE
    -- text/json/varchar guardando JSON → jsonb sin límite de longitud por columna
    ALTER TABLE public.moobiz_drivers
      ALTER COLUMN raw_data TYPE jsonb USING raw_data::jsonb;
    RAISE NOTICE 'moobiz_drivers.raw_data: convertido a jsonb desde %', dt;
  END IF;
END $$;
