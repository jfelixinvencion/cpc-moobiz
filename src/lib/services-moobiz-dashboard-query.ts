import type { Pool } from "pg";

import { V31 } from "@/lib/services-moobiz-31cols";
import { V31_PARSED_CTE } from "@/lib/services-moobiz-fragments";
import type { ServicesMoobizParsedParams } from "@/lib/services-moobiz-dashboard-params";
import { ymToMmmYy } from "@/lib/services-moobiz-dashboard-params";

export type { ServicesMoobizGranularity, ServicesMoobizParsedParams } from "@/lib/services-moobiz-dashboard-params";
export { parseServicesMoobizParams } from "@/lib/services-moobiz-dashboard-params";

function nullIfEmpty(a: string[]): string[] | null {
  return a.length === 0 ? null : a;
}
function getFilterWhereSql(): string {
  return `
  p.scheduled_ts IS NOT NULL
  AND p.scheduled_ts >= COALESCE(
    ($1::date::timestamp AT TIME ZONE 'America/Lima'),
    CASE WHEN $3::boolean THEN
      ((date_trunc('month', CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima') - interval '11 months')
        AT TIME ZONE 'America/Lima')
    ELSE
      (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - interval '30 days')::timestamp
        AT TIME ZONE 'America/Lima')
    END
  )
  AND p.scheduled_ts < COALESCE(
    (($2::date + interval '1 day')::timestamp AT TIME ZONE 'America/Lima'),
    (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date + interval '1 day')::timestamp
      AT TIME ZONE 'America/Lima')
  )
  AND ($4::text[] IS NULL OR trim(COALESCE(p.${V31.estado}, '')) = ANY($4))
  AND ($5::text[] IS NULL OR trim(COALESCE(p.${V31.creadoPor}, '')) = ANY($5))
  AND ($6::text[] IS NULL OR trim(COALESCE(p.${V31.producto}, '')) = ANY($6))
  AND ($7::text[] IS NULL OR trim(COALESCE(p.${V31.empresa}, '')) = ANY($7))
  AND ($8::text[] IS NULL OR p.sucursal_group = ANY($8))
  AND ($9::text[] IS NULL OR p.conductor_category = ANY($9))
  AND ($10::text[] IS NULL OR p.month_key_lima = ANY($10))
`;
}

export type SeriesRow = { period: string; count: number };

export type ServicesMoobizOptionsPayload = {
  estados: string[];
  creados_por: string[];
  productos: string[];
  empresas: string[];
  sucursales: string[];
  conductor_categories: string[];
  months: { key: string; label: string }[];
};

const OPT_RANGE_DAYS = 730;
const OPT_LIMIT_STRINGS = 400;
const OPT_LIMIT_MONTHS = 48;

/** DISTINCT opciones de filtro (sin filtros de usuario); cacheable aparte de la serie. */
export async function runServicesMoobizFilterOptions(pool: Pool): Promise<ServicesMoobizOptionsPayload> {
  const optEstados = `
${V31_PARSED_CTE}
SELECT DISTINCT trim(COALESCE(p.${V31.estado}, '')) AS v
FROM p
WHERE p.scheduled_ts IS NOT NULL
  AND trim(COALESCE(p.${V31.estado}, '')) <> ''
  AND p.scheduled_ts >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - ${OPT_RANGE_DAYS})::timestamp AT TIME ZONE 'America/Lima')
ORDER BY 1
LIMIT ${OPT_LIMIT_STRINGS}
`;

  const optCreados = `
${V31_PARSED_CTE}
SELECT DISTINCT trim(COALESCE(p.${V31.creadoPor}, '')) AS v
FROM p
WHERE p.scheduled_ts IS NOT NULL
  AND trim(COALESCE(p.${V31.creadoPor}, '')) <> ''
  AND p.scheduled_ts >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - ${OPT_RANGE_DAYS})::timestamp AT TIME ZONE 'America/Lima')
ORDER BY 1
LIMIT ${OPT_LIMIT_STRINGS}
`;

  const optProductos = `
${V31_PARSED_CTE}
SELECT DISTINCT trim(COALESCE(p.${V31.producto}, '')) AS v
FROM p
WHERE p.scheduled_ts IS NOT NULL
  AND trim(COALESCE(p.${V31.producto}, '')) <> ''
  AND p.scheduled_ts >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - ${OPT_RANGE_DAYS})::timestamp AT TIME ZONE 'America/Lima')
ORDER BY 1
LIMIT ${OPT_LIMIT_STRINGS}
`;

  const optEmpresas = `
${V31_PARSED_CTE}
SELECT DISTINCT trim(COALESCE(p.${V31.empresa}, '')) AS v
FROM p
WHERE p.scheduled_ts IS NOT NULL
  AND trim(COALESCE(p.${V31.empresa}, '')) <> ''
  AND p.scheduled_ts >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - ${OPT_RANGE_DAYS})::timestamp AT TIME ZONE 'America/Lima')
ORDER BY 1
LIMIT ${OPT_LIMIT_STRINGS}
`;

  const monthsSql = `
${V31_PARSED_CTE}
SELECT DISTINCT p.month_key_lima AS v
FROM p
WHERE p.scheduled_ts IS NOT NULL
  AND p.month_key_lima IS NOT NULL
  AND trim(p.month_key_lima) <> ''
  AND p.scheduled_ts >= (((CURRENT_TIMESTAMP AT TIME ZONE 'America/Lima')::date - ${OPT_RANGE_DAYS})::timestamp AT TIME ZONE 'America/Lima')
ORDER BY 1 DESC
LIMIT ${OPT_LIMIT_MONTHS}
`;

  const [eEst, eCr, ePr, eEm, eMo] = await Promise.all([
    pool.query<{ v: string }>(optEstados),
    pool.query<{ v: string }>(optCreados),
    pool.query<{ v: string }>(optProductos),
    pool.query<{ v: string }>(optEmpresas),
    pool.query<{ v: string }>(monthsSql),
  ]);

  const mapV = (rows: { v: string }[]) =>
    rows.map((r) => r.v).filter((s) => typeof s === "string" && s.trim());

  const monthsRaw = mapV(eMo.rows);
  const sucursales = ["LIMA", "PROVINCIA"];
  const conductor_categories = ["APOYO LIMA", "APOYO PROVINCIA", "AFILIADO"];

  return {
    estados: mapV(eEst.rows),
    creados_por: mapV(eCr.rows),
    productos: mapV(ePr.rows),
    empresas: mapV(eEm.rows),
    sucursales,
    conductor_categories,
    months: monthsRaw.map((key) => ({ key, label: ymToMmmYy(key) })),
  };
}

/** Solo agregación serie + total (sin DISTINCT de opciones). */
export async function runServicesMoobizDashboard(pool: Pool, parsed: ServicesMoobizParsedParams) {
  const monthly = parsed.granularity === "monthly";
  const trunc = monthly ? "month" : "day";
  const periodFmt = monthly ? "YYYY-MM" : "YYYY-MM-DD";

  const filterWhere = getFilterWhereSql();
  const params: (string | string[] | boolean | null)[] = [
    parsed.fromDate,
    parsed.toDate,
    monthly,
    nullIfEmpty(parsed.estados),
    nullIfEmpty(parsed.creadosPor),
    nullIfEmpty(parsed.productos),
    nullIfEmpty(parsed.empresas),
    nullIfEmpty(parsed.sucursales),
    nullIfEmpty(parsed.conductorCategories),
    nullIfEmpty(parsed.months),
  ];

  const seriesSql = `
${V31_PARSED_CTE}
SELECT
  to_char(date_trunc('${trunc}', p.scheduled_ts AT TIME ZONE 'America/Lima'), '${periodFmt}') AS period,
  COUNT(*)::int AS count
FROM p
WHERE ${filterWhere}
GROUP BY 1
ORDER BY 1
`;

  const totalSql = `
${V31_PARSED_CTE}
SELECT COUNT(*)::int AS total
FROM p
WHERE ${filterWhere}
`;

  const [seriesRes, totalRes] = await Promise.all([
    pool.query<SeriesRow>(seriesSql, params),
    pool.query<{ total: number }>(totalSql, params),
  ]);

  const series: SeriesRow[] = seriesRes.rows.map((r) => ({
    period: String(r.period ?? "").trim(),
    count: typeof r.count === "number" ? r.count : Number(r.count) || 0,
  }));

  const total = totalRes.rows[0]?.total ?? 0;

  return { series, total };
}

export async function runServicesMoobizData(pool: Pool, parsed: ServicesMoobizParsedParams) {
  const filterWhere = getFilterWhereSql();
  const params: (string | string[] | boolean | null)[] = [
    parsed.fromDate,
    parsed.toDate,
    parsed.granularity === "monthly",
    nullIfEmpty(parsed.estados),
    nullIfEmpty(parsed.creadosPor),
    nullIfEmpty(parsed.productos),
    nullIfEmpty(parsed.empresas),
    nullIfEmpty(parsed.sucursales),
    nullIfEmpty(parsed.conductorCategories),
    nullIfEmpty(parsed.months),
  ];

  const sql = `
${V31_PARSED_CTE}
SELECT
  p.${V31.fProgramada} AS f_programada,
  p.${V31.idServicio}::text AS id_servicio,
  trim(COALESCE(p.${V31.estado}, '')) AS estado,
  trim(COALESCE(p.${V31.producto}, '')) AS producto,
  trim(COALESCE(p.${V31.empresa}, '')) AS empresa,
  p.sucursal_group,
  p.conductor_category
FROM p
WHERE ${filterWhere}
ORDER BY p.scheduled_ts DESC NULLS LAST
LIMIT 200
`;

  const { rows } = await pool.query(sql, params);
  return rows;
}
