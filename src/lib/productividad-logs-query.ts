import type { Pool } from "pg";

import {
  PRODUCTIVIDAD_IMPLICIT_TYPE_USER,
  PRODUCTIVIDAD_LOG_TYPES,
  type ProductividadFilterField,
  type ProductividadParsedParams,
} from "./productividad-logs-params.ts";

const TABLE = "reportes.moobiz_logs_enriched";

export type FilterSql = {
  sql: string;
  params: unknown[];
};

function productividadImplicitWhereParts(): string[] {
  const logTypesSql = PRODUCTIVIDAD_LOG_TYPES.map(
    (t) => `'${t.replace(/'/g, "''")}'`,
  ).join(", ");
  const operador = PRODUCTIVIDAD_IMPLICIT_TYPE_USER.replace(/'/g, "''");
  return [
    `type_user::text = '${operador}'`,
    `type_log_name::text = ANY(ARRAY[${logTypesSql}]::text[])`,
  ];
}

/** WHERE compartido; `omit` excluye un filtro al poblar opciones en cascada. */
export function buildProductividadWhere(
  parsed: ProductividadParsedParams,
  omit?: ProductividadFilterField,
): FilterSql {
  const params: unknown[] = [];
  const parts: string[] = [...productividadImplicitWhereParts()];

  const addArray = (col: string, values: string[] | null, field: ProductividadFilterField) => {
    if (omit === field) return;
    if (values == null) return;
    params.push(values);
    parts.push(`($${params.length}::text[] IS NULL OR ${col}::text = ANY($${params.length}::text[]))`);
  };

  addArray("global", parsed.global, "global");
  addArray("estado", parsed.estado, "estado");
  addArray("n_semana", parsed.nSemana?.map(String) ?? null, "n_semana");
  addArray("us_name", parsed.usName, "us_name");

  if (parsed.typeLogName != null) {
    if (parsed.typeLogName.length === 0) {
      parts.push("FALSE");
    } else if (omit !== "type_log_name") {
      addArray("type_log_name", parsed.typeLogName, "type_log_name");
    }
  }

  if (parsed.weekdays != null && parsed.weekdays.length > 0) {
    params.push(parsed.weekdays);
    parts.push(
      `(to_char(to_date(fecha,'DD/MM/YYYY'), 'ID')::int = ANY($${params.length}::int[]))`,
    );
  }

  if (omit !== "fecha") {
    if (parsed.fechaFrom) {
      params.push(parsed.fechaFrom);
      parts.push(
        `(to_date(fecha,'DD/MM/YYYY') >= to_date($${params.length}::text,'DD/MM/YYYY'))`,
      );
    }
    if (parsed.fechaTo) {
      params.push(parsed.fechaTo);
      parts.push(
        `(to_date(fecha,'DD/MM/YYYY') <= to_date($${params.length}::text,'DD/MM/YYYY'))`,
      );
    }
  }

  const sql = parts.length > 0 ? parts.join("\n  AND ") : "TRUE";
  return { sql, params };
}

const FILTER_COLUMN: Record<
  Exclude<ProductividadFilterField, "fecha">,
  string
> = {
  global: "global",
  estado: "estado",
  n_semana: "n_semana::text",
  type_user: "type_user",
  type_log_name: "type_log_name",
  us_name: "us_name",
};

export async function runProductividadFilterOptions(
  pool: Pool,
  parsed: ProductividadParsedParams,
  field: ProductividadFilterField,
): Promise<string[] | { min: string | null; max: string | null }> {
  const { sql: whereSql, params } = buildProductividadWhere(parsed, field);

  if (field === "fecha") {
    const q = `
SELECT
  to_char(MIN(to_date(fecha,'DD/MM/YYYY')), 'DD/MM/YYYY') AS min_fecha,
  to_char(MAX(to_date(fecha,'DD/MM/YYYY')), 'DD/MM/YYYY') AS max_fecha
FROM ${TABLE}
WHERE ${whereSql}
  AND fecha IS NOT NULL
  AND trim(fecha::text) <> ''
`;
    const { rows } = await pool.query<{ min_fecha: string | null; max_fecha: string | null }>(
      q,
      params,
    );
    const row = rows[0];
    return { min: row?.min_fecha ?? null, max: row?.max_fecha ?? null };
  }

  const col = FILTER_COLUMN[field];
  const q = `
SELECT DISTINCT ${col} AS v
FROM ${TABLE}
WHERE ${whereSql}
  AND ${col} IS NOT NULL
  AND trim(${col}::text) <> ''
ORDER BY 1
LIMIT 500
`;
  const { rows } = await pool.query<{ v: string }>(q, params);
  return rows.map((r) => String(r.v ?? "").trim()).filter(Boolean);
}

export type UserChartRow = {
  us_name: string;
  type_log_name: string;
  cnt: number;
  buckets: number;
  total_per_user: number;
};

const LOG_TYPE_COUNT = 5;

export async function runProductividadUserChart(
  pool: Pool,
  parsed: ProductividadParsedParams,
): Promise<{ rows: UserChartRow[]; totalUsers: number }> {
  const { sql: whereSql, params: whereParams } = buildProductividadWhere(parsed);
  const sortTypesIdx = whereParams.length + 1;
  const limitIdx = whereParams.length + 2;
  const offsetIdx = whereParams.length + 3;
  const sortTypesParam =
    parsed.sortTypes == null || parsed.sortTypes.length === 0 ? null : parsed.sortTypes;

  const q = `
WITH grouped AS (
  SELECT
    us_name,
    type_log_name,
    COUNT(*)::int AS cnt,
    COUNT(DISTINCT fecha || ' ' || hora)::int AS buckets
  FROM ${TABLE}
  WHERE ${whereSql}
  GROUP BY us_name, type_log_name
),
user_totals AS (
  SELECT us_name, SUM(cnt)::int AS total_per_user
  FROM grouped
  GROUP BY us_name
),
user_sort AS (
  SELECT
    ut.us_name,
    ut.total_per_user,
    CASE
      WHEN $${sortTypesIdx}::text[] IS NULL
        OR cardinality($${sortTypesIdx}::text[]) = 0
        OR cardinality($${sortTypesIdx}::text[]) >= ${LOG_TYPE_COUNT}
        THEN ut.total_per_user::numeric
      WHEN cardinality($${sortTypesIdx}::text[]) = 1
        THEN COALESCE((
          SELECT SUM(g.cnt)::numeric
          FROM grouped g
          WHERE g.us_name = ut.us_name
            AND g.type_log_name = ($${sortTypesIdx}::text[])[1]
        ), 0)
      ELSE COALESCE((
        SELECT SUM(g.cnt)::numeric
        FROM grouped g
        WHERE g.us_name = ut.us_name
          AND g.type_log_name = ANY($${sortTypesIdx}::text[])
      ), 0)
    END AS sort_metric
  FROM user_totals ut
),
top_users AS (
  SELECT us_name, total_per_user, sort_metric
  FROM user_sort
  ORDER BY sort_metric DESC, us_name
  LIMIT $${limitIdx} OFFSET $${offsetIdx}
)
SELECT g.us_name, g.type_log_name, g.cnt, g.buckets, tu.total_per_user
FROM grouped g
INNER JOIN top_users tu ON tu.us_name = g.us_name
ORDER BY tu.sort_metric DESC, g.us_name, g.type_log_name
`;

  const countQ = `
SELECT COUNT(DISTINCT us_name)::int AS total
FROM ${TABLE}
WHERE ${whereSql}
`;

  const queryParams = [...whereParams, sortTypesParam, parsed.limit, parsed.offset];

  const [dataRes, countRes] = await Promise.all([
    pool.query<UserChartRow>(q, queryParams),
    pool.query<{ total: number }>(countQ, whereParams),
  ]);

  return {
    rows: dataRes.rows.map((r) => ({
      us_name: String(r.us_name ?? ""),
      type_log_name: String(r.type_log_name ?? ""),
      cnt: Number(r.cnt) || 0,
      buckets: Number(r.buckets) || 0,
      total_per_user: Number(r.total_per_user) || 0,
    })),
    totalUsers: Number(countRes.rows[0]?.total) || 0,
  };
}

export type ProductividadCardMetrics = {
  type: string;
  total: number;
  buckets: number;
  ratio: number;
};

export async function runProductividadCards(
  pool: Pool,
  parsed: ProductividadParsedParams,
): Promise<ProductividadCardMetrics[]> {
  const { sql: whereSql, params } = buildProductividadWhere(parsed);

  const cases = PRODUCTIVIDAD_LOG_TYPES.map(
    (t) => `
  COUNT(*) FILTER (WHERE type_log_name = '${t.replace(/'/g, "''")}') AS total_${slugType(t)},
  COUNT(DISTINCT fecha || ' ' || hora) FILTER (WHERE type_log_name = '${t.replace(/'/g, "''")}') AS buckets_${slugType(t)}`,
  ).join(",\n  ");

  const q = `
SELECT
  ${cases}
FROM ${TABLE}
WHERE ${whereSql}
`;

  const { rows } = await pool.query<Record<string, number>>(q, params);
  const row = rows[0] ?? {};

  return PRODUCTIVIDAD_LOG_TYPES.map((type) => {
    const slug = slugType(type);
    const total = Number(row[`total_${slug}`]) || 0;
    const buckets = Number(row[`buckets_${slug}`]) || 0;
    const ratio = buckets === 0 ? 0 : Math.round((total / buckets) * 100) / 100;
    return { type, total, buckets, ratio };
  });
}

function slugType(type: string): string {
  return type
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

export type DateCountRow = { fecha: string; cnt: number };
export type DateHourCountRow = { fecha: string; hora: string; cnt: number };

export async function runProductividadByDate(
  pool: Pool,
  parsed: ProductividadParsedParams,
): Promise<DateCountRow[]> {
  const { sql: whereSql, params } = buildProductividadWhere(parsed);
  const q = `
SELECT fecha, COUNT(*)::int AS cnt
FROM ${TABLE}
WHERE ${whereSql}
GROUP BY fecha
ORDER BY to_date(fecha,'DD/MM/YYYY')
`;
  const { rows } = await pool.query<DateCountRow>(q, params);
  return rows.map((r) => ({ fecha: String(r.fecha ?? ""), cnt: Number(r.cnt) || 0 }));
}

export async function runProductividadByDateHour(
  pool: Pool,
  parsed: ProductividadParsedParams,
): Promise<DateHourCountRow[]> {
  const { sql: whereSql, params } = buildProductividadWhere(parsed);
  const q = `
SELECT fecha, hora::text AS hora, COUNT(*)::int AS cnt
FROM ${TABLE}
WHERE ${whereSql}
GROUP BY fecha, hora
ORDER BY to_date(fecha,'DD/MM/YYYY'), hora
`;
  const { rows } = await pool.query<DateHourCountRow>(q, params);
  return rows.map((r) => ({
    fecha: String(r.fecha ?? ""),
    hora: String(r.hora ?? ""),
    cnt: Number(r.cnt) || 0,
  }));
}

/** Exportación completa (sin paginación de usuarios). */
export async function runProductividadUserChartExport(
  pool: Pool,
  parsed: ProductividadParsedParams,
): Promise<UserChartRow[]> {
  const saved = { ...parsed, limit: 100_000, offset: 0 };
  const { rows } = await runProductividadUserChart(pool, saved);
  return rows;
}
