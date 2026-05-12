import { V31 } from "@/lib/services-moobiz-31cols";
import { scheduledTsFromFpRawExpr } from "@/lib/services-moobiz-scheduled-ts-sql";

/**
 * CTE `p`: filas con scheduled_ts parseado, sucursal_group y conductor_category.
 * month_key_lima = YYYY-MM en zona America/Lima (para filtro por mes).
 */
export const V31_PARSED_CTE = `
WITH base AS (
  SELECT * FROM vista.vw_moobiz_31cols_pe
),
fp AS (
  SELECT
    base.*,
    trim(both FROM COALESCE(base.${V31.fProgramada}::text, '')) AS fp_raw
  FROM base
),
p0 AS (
  SELECT
    fp.*,
    ${scheduledTsFromFpRawExpr("fp.fp_raw")} AS scheduled_ts,
    CASE
      WHEN upper(trim(COALESCE(fp.${V31.sucursal}, ''))) = 'LIMA' THEN 'LIMA'
      ELSE 'PROVINCIA'
    END AS sucursal_group,
    CASE
      WHEN trim(COALESCE(fp.${V31.idConductor}::text, '')) = '83320' THEN 'APOYO LIMA'
      WHEN trim(COALESCE(fp.${V31.idConductor}::text, '')) = '124779' THEN 'APOYO PROVINCIA'
      ELSE 'AFILIADO'
    END AS conductor_category
  FROM fp
),
p AS (
  SELECT
    p0.*,
    to_char(date_trunc('month', p0.scheduled_ts AT TIME ZONE 'America/Lima'), 'YYYY-MM') AS month_key_lima
  FROM p0
)`;
