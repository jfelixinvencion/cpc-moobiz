-- Volcado masivo Moobiz: GET /api/admin/live/vehicles?query=&show_destinations=true
-- → public.driver_live_raw (reemplazo atómico vía RPC).
--
-- NO ejecutar desde CI/Cursor sin revisión: aplicar manualmente en Supabase (SQL Editor).

CREATE TABLE IF NOT EXISTS public.driver_live_raw (
  driver_key TEXT PRIMARY KEY,
  raw JSONB NOT NULL,
  availability TEXT NULL,
  last_checked TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_driver_live_raw_availability
  ON public.driver_live_raw (availability)
  WHERE availability IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_driver_live_raw_last_checked
  ON public.driver_live_raw (last_checked DESC);

COMMENT ON TABLE public.driver_live_raw IS
  'Snapshot de Moobiz live/vehicles; reemplazo total atómico mediante refresh_driver_live_raw().';

-- items: jsonb array de objetos { "driver_key": "...", "raw": { ... }, "availability": "online"|"busy"|"offline" }
CREATE OR REPLACE FUNCTION public.refresh_driver_live_raw(items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  inserted_count integer := 0;
  total_count integer;
BEGIN
  IF items IS NULL OR jsonb_typeof(items) <> 'array' THEN
    RAISE EXCEPTION 'refresh_driver_live_raw: items debe ser un array JSON';
  END IF;

  total_count := jsonb_array_length(items);

  TRUNCATE TABLE public.driver_live_raw;

  INSERT INTO public.driver_live_raw (driver_key, raw, availability, last_checked)
  SELECT
    trim(elem->>'driver_key'),
    COALESCE(elem->'raw', '{}'::jsonb),
    NULLIF(trim(elem->>'availability'), ''),
    NOW()
  FROM jsonb_array_elements(items) AS t(elem)
  WHERE length(trim(COALESCE(elem->>'driver_key', ''))) > 0;

  GET DIAGNOSTICS inserted_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'total', total_count,
    'inserted', inserted_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_driver_live_raw(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_driver_live_raw(jsonb) TO service_role;
