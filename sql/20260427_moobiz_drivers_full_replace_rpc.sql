-- Reemplazo atómico de conductores: TRUNCATE + INSERT en una sola transacción (función).
-- Si el INSERT falla, el TRUNCATE se revierte y la tabla conserva los datos anteriores.
-- Ejecutar en Supabase: el sync de conductores (app + CLI) llama a esta función.

CREATE OR REPLACE FUNCTION public.moobiz_drivers_full_replace(p_rows jsonb)
RETURNS integer
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  inserted int := 0;
BEGIN
  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION 'p_rows must be a JSON array';
  END IF;
  IF jsonb_array_length(p_rows) = 0 THEN
    RAISE EXCEPTION 'p_rows must not be empty';
  END IF;

  TRUNCATE TABLE public.moobiz_drivers;

  -- Insert desde elementos del array JSON (evita jsonb_to_recordset → conversiones que en algunos
  -- despliegues truncaban sub-cadenas largas dentro de raw_data, p. ej. fv_items).
  INSERT INTO public.moobiz_drivers (id, id_branch, id_role, id_company, id_company_area, show_data_fleets, raw_data)
  SELECT
    NULLIF(trim(both elem->>'id'), ''),
    NULLIF(trim(both elem->>'id_branch'), ''),
    NULLIF(trim(both elem->>'id_role'), ''),
    NULLIF(trim(both elem->>'id_company'), ''),
    NULLIF(trim(both elem->>'id_company_area'), ''),
    (elem->'show_data_fleets')::boolean,
    COALESCE(elem->'raw_data', '{}'::jsonb)
  FROM jsonb_array_elements(p_rows) AS elem
  WHERE NULLIF(trim(both elem->>'id'), '') IS NOT NULL;

  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN inserted;
END;
$$;

REVOKE ALL ON FUNCTION public.moobiz_drivers_full_replace(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moobiz_drivers_full_replace(jsonb) TO service_role;
