import { V31 } from "@/lib/services-moobiz-31cols";

/**
 * CTE `p`: filas con scheduled_ts parseado, sucursal_group y conductor_category.
 * month_key_lima = YYYY-MM en zona America/Lima (para filtro por mes).
 */
export const V31_PARSED_CTE = `
WITH base AS (
  SELECT * FROM vista.vw_moobiz_31cols_pe
),
p0 AS (
  SELECT
    base.*,
    trim(both FROM COALESCE(base.${V31.fProgramada}::text, '')) AS fp_raw,
    COALESCE(
      to_timestamp(NULLIF(trim(both FROM COALESCE(base.${V31.fProgramada}::text, '')), ''), 'DD/MM/YYYY HH24:MI'),
      to_timestamp(NULLIF(trim(both FROM COALESCE(base.${V31.fProgramada}::text, '')), ''), 'DD/MM/YYYY HH12:MI AM'),
      to_timestamp(NULLIF(trim(both FROM COALESCE(base.${V31.fProgramada}::text, '')), ''), 'DD/MM/YYYY'),
      CASE
        WHEN trim(both FROM COALESCE(base.${V31.fProgramada}::text, '')) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          THEN trim(both FROM COALESCE(base.${V31.fProgramada}::text, ''))::timestamptz
        ELSE NULL
      END
    ) AS scheduled_ts,
    CASE
      WHEN upper(trim(COALESCE(base.${V31.sucursal}, ''))) = 'LIMA' THEN 'LIMA'
      ELSE 'PROVINCIA'
    END AS sucursal_group,
    CASE
      WHEN trim(COALESCE(base.${V31.idConductor}::text, '')) = '83320' THEN 'APOYO LIMA'
      WHEN trim(COALESCE(base.${V31.idConductor}::text, '')) = '124779' THEN 'APOYO PROVINCIA'
      ELSE 'AFILIADO'
    END AS conductor_category
  FROM base
),
p AS (
  SELECT
    p0.*,
    to_char(date_trunc('month', p0.scheduled_ts AT TIME ZONE 'America/Lima'), 'YYYY-MM') AS month_key_lima
  FROM p0
)`;
