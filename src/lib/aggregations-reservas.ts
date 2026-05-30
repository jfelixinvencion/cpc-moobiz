import type { Pool } from "pg";

const TABLE = "reportes.historico_reservas";

export type ReservasGranularity = "hour" | "day" | "week" | "month";

export type ReservasAggregationParams = {
  start: Date;
  end: Date;
  granularity: ReservasGranularity;
  semana: string | null;
  estado: string[] | null;
  chart2Estado: string[] | null;
  /** ISO weekday 1..7 (lun..dom); null = sin filtro de día. */
  weekdays: number[] | null;
};

export type ReservasSeriesPoint = { bucket: string; value: number };

export type ReservasChart1Series = { name: string; data: number[] };

export type ReservasAggregationsResponse = {
  meta: {
    start: string;
    end: string;
    granularity: ReservasGranularity;
    requestedAt: string;
    semana: string | null;
    estado: string[] | null;
    chart2Estado: string[] | null;
    weekdays: number[] | null;
  };
  filterOptions: {
    estados: string[];
    semanas: string[];
  };
  chart1: {
    buckets: string[];
    series: ReservasChart1Series[];
  };
  chart2: {
    buckets: string[];
    series: ReservasChart1Series[];
  };
  chart3: {
    buckets: string[];
    numerator: number[];
    denominator: number[];
  };
};

const GRANULARITY_SQL: Record<ReservasGranularity, string> = {
  hour: "hour",
  day: "day",
  week: "week",
  month: "month",
};

const DEFAULT_DAYS = 30;
const MAX_MULTI = 40;

type CacheEntry = { expires: number; body: ReservasAggregationsResponse };

const aggregationCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 15_000;

function trimArr(arr: string[]): string[] {
  return arr.map((s) => s.trim()).filter(Boolean).slice(0, MAX_MULTI);
}

function nullIfEmpty(arr: string[]): string[] | null {
  return arr.length === 0 ? null : arr;
}

function parseReservasWeekdaysParam(sp: URLSearchParams): number[] | null {
  const seen = new Set<number>();
  for (const raw of sp.getAll("weekday")) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n >= 1 && n <= 7) seen.add(n);
  }
  const arr = [...seen].sort((a, b) => a - b);
  return arr.length === 0 ? null : arr;
}

export function parseReservasGranularity(raw: string | null): ReservasGranularity {
  const g = raw?.trim().toLowerCase();
  if (g === "hour" || g === "day" || g === "week" || g === "month") return g;
  return "day";
}

export function parseReservasAggregationParams(
  sp: URLSearchParams,
): ReservasAggregationParams {
  const now = new Date();
  const defaultStart = new Date(now.getTime() - DEFAULT_DAYS * 24 * 60 * 60 * 1000);

  const startRaw = sp.get("start")?.trim();
  const endRaw = sp.get("end")?.trim();
  const start = startRaw ? new Date(startRaw) : defaultStart;
  const end = endRaw ? new Date(endRaw) : now;

  const semana = sp.get("semana")?.trim() || null;
  const estado = nullIfEmpty(trimArr(sp.getAll("estado")));
  const chart2Estado = nullIfEmpty(trimArr(sp.getAll("chart2_estado")));

  return {
    start: Number.isNaN(start.getTime()) ? defaultStart : start,
    end: Number.isNaN(end.getTime()) ? now : end,
    granularity: parseReservasGranularity(sp.get("granularity")),
    semana,
    estado,
    chart2Estado,
    weekdays: parseReservasWeekdaysParam(sp),
  };
}

function cacheKey(params: ReservasAggregationParams): string {
  return JSON.stringify({
    start: params.start.toISOString(),
    end: params.end.toISOString(),
    granularity: params.granularity,
    semana: params.semana,
    estado: params.estado,
    chart2Estado: params.chart2Estado,
    weekdays: params.weekdays,
  });
}

function truncExpr(granularity: ReservasGranularity): string {
  const unit = GRANULARITY_SQL[granularity];
  return `date_trunc('${unit}', r."F. Programada")`;
}

function baseWhere(startIdx: number): string {
  return `
    r."F. Programada" IS NOT NULL
    AND r."F. Programada" BETWEEN $${startIdx}::timestamptz AND $${startIdx + 1}::timestamptz
    AND ($${startIdx + 2}::text IS NULL OR $${startIdx + 2} = '' OR r."Semana" = $${startIdx + 2})
  `;
}

function estadoClause(paramIdx: number): string {
  return `(cardinality($${paramIdx}::text[]) = 0 OR r."Estado" = ANY($${paramIdx}::text[]))`;
}

function weekdaysClause(paramIdx: number): string {
  return `(cardinality($${paramIdx}::int[]) = 0 OR EXTRACT(ISODOW FROM timezone('America/Lima', r."F. Programada"))::int = ANY($${paramIdx}::int[]))`;
}

function bucketIso(v: unknown): string {
  if (v instanceof Date) return v.toISOString();
  return new Date(String(v)).toISOString();
}

function sortedBuckets(values: Iterable<string>): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function seriesFromRows(
  buckets: string[],
  rows: { bucket: string; estado: string; cnt: number }[],
): ReservasChart1Series[] {
  const estados = [...new Set(rows.map((r) => r.estado))].sort((a, b) => a.localeCompare(b));
  const map = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!map.has(row.estado)) map.set(row.estado, new Map());
    map.get(row.estado)!.set(row.bucket, row.cnt);
  }
  return estados.map((name) => ({
    name,
    data: buckets.map((b) => map.get(name)?.get(b) ?? 0),
  }));
}

function totalsFromRows(
  buckets: string[],
  rows: { bucket: string; cnt: number }[],
): ReservasChart1Series[] {
  const map = new Map(rows.map((r) => [r.bucket, r.cnt]));
  return [{ name: "Total", data: buckets.map((b) => map.get(b) ?? 0) }];
}

function alignCounts(buckets: string[], rows: { bucket: string; cnt: number }[]): number[] {
  const map = new Map(rows.map((r) => [r.bucket, r.cnt]));
  return buckets.map((b) => map.get(b) ?? 0);
}

export async function runReservasFilterOptions(pool: Pool): Promise<{
  estados: string[];
  semanas: string[];
}> {
  const [estadosRes, semanasRes] = await Promise.all([
    pool.query<{ v: string }>(
      `SELECT DISTINCT "Estado" AS v FROM ${TABLE}
       WHERE "Estado" IS NOT NULL AND trim("Estado"::text) <> ''
       ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT "Semana" AS v FROM ${TABLE}
       WHERE "Semana" IS NOT NULL AND trim("Semana"::text) <> ''
       ORDER BY 1 DESC
       LIMIT 120`,
    ),
  ]);
  return {
    estados: estadosRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
    semanas: semanasRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
  };
}

export async function runReservasAggregations(
  pool: Pool,
  params: ReservasAggregationParams,
): Promise<ReservasAggregationsResponse> {
  const key = cacheKey(params);
  const cached = aggregationCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.body;
  }

  const trunc = truncExpr(params.granularity);
  const globalEstado = params.estado ?? [];
  const chart2Estado = params.chart2Estado ?? globalEstado;

  const filterOptions = await runReservasFilterOptions(pool);

  const chart1Sql = `
    SELECT ${trunc} AS bucket, r."Estado" AS estado, COUNT(*)::bigint AS cnt
    FROM ${TABLE} r
    WHERE ${baseWhere(1)}
      AND ${estadoClause(4)}
      AND ${weekdaysClause(5)}
    GROUP BY bucket, estado
    ORDER BY bucket ASC, estado
  `;

  const chart2Sql = `
    SELECT ${trunc} AS bucket, COUNT(*)::bigint AS cnt
    FROM ${TABLE} r
    WHERE ${baseWhere(1)}
      AND ${estadoClause(4)}
      AND ${weekdaysClause(5)}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const chart3NumSql = `
    SELECT ${trunc} AS bucket, COUNT(*)::bigint AS cnt
    FROM ${TABLE} r
    WHERE ${baseWhere(1)}
      AND ${estadoClause(4)}
      AND ${weekdaysClause(5)}
      AND upper(trim(r."Nombre Conductor"::text)) = 'NUEVOS'
      AND upper(trim(r."Estado"::text)) = 'FINALIZADO'
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const chart3DenSql = `
    SELECT ${trunc} AS bucket, COUNT(*)::bigint AS cnt
    FROM ${TABLE} r
    WHERE ${baseWhere(1)}
      AND ${estadoClause(4)}
      AND ${weekdaysClause(5)}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const globalWeekdays = params.weekdays ?? [];

  const baseParams = [
    params.start.toISOString(),
    params.end.toISOString(),
    params.semana,
    globalEstado,
    globalWeekdays,
  ];

  const chart2Params = [
    params.start.toISOString(),
    params.end.toISOString(),
    params.semana,
    chart2Estado,
    globalWeekdays,
  ];

  const [chart1Res, chart2Res, chart3NumRes, chart3DenRes] = await Promise.all([
    pool.query<{ bucket: Date; estado: string; cnt: string }>(chart1Sql, baseParams),
    pool.query<{ bucket: Date; cnt: string }>(chart2Sql, chart2Params),
    pool.query<{ bucket: Date; cnt: string }>(chart3NumSql, baseParams),
    pool.query<{ bucket: Date; cnt: string }>(chart3DenSql, baseParams),
  ]);

  const chart1Rows = chart1Res.rows.map((r) => ({
    bucket: bucketIso(r.bucket),
    estado: String(r.estado ?? ""),
    cnt: Number(r.cnt) || 0,
  }));

  const chart2Rows = chart2Res.rows.map((r) => ({
    bucket: bucketIso(r.bucket),
    cnt: Number(r.cnt) || 0,
  }));

  const chart3NumRows = chart3NumRes.rows.map((r) => ({
    bucket: bucketIso(r.bucket),
    cnt: Number(r.cnt) || 0,
  }));

  const chart3DenRows = chart3DenRes.rows.map((r) => ({
    bucket: bucketIso(r.bucket),
    cnt: Number(r.cnt) || 0,
  }));

  const allBuckets = sortedBuckets([
    ...chart1Rows.map((r) => r.bucket),
    ...chart2Rows.map((r) => r.bucket),
    ...chart3NumRows.map((r) => r.bucket),
    ...chart3DenRows.map((r) => r.bucket),
  ]);

  const body: ReservasAggregationsResponse = {
    meta: {
      start: params.start.toISOString(),
      end: params.end.toISOString(),
      granularity: params.granularity,
      requestedAt: new Date().toISOString(),
      semana: params.semana,
      estado: params.estado,
      chart2Estado: params.chart2Estado,
      weekdays: params.weekdays,
    },
    filterOptions,
    chart1: {
      buckets: allBuckets,
      series: seriesFromRows(allBuckets, chart1Rows),
    },
    chart2: {
      buckets: allBuckets,
      series: totalsFromRows(allBuckets, chart2Rows),
    },
    chart3: {
      buckets: allBuckets,
      numerator: alignCounts(allBuckets, chart3NumRows),
      denominator: alignCounts(allBuckets, chart3DenRows),
    },
  };

  aggregationCache.set(key, { expires: Date.now() + CACHE_TTL_MS, body });
  return body;
}

export function buildReservasExportCsv(
  chart: "1" | "2" | "3",
  data: ReservasAggregationsResponse,
  includePercent: boolean,
): { filename: string; csv: string } {
  const { buckets } = data[`chart${chart}` as "chart1" | "chart2" | "chart3"];
  const rows: Record<string, string | number>[] = [];

  if (chart === "1") {
    for (let i = 0; i < buckets.length; i++) {
      const bucket = buckets[i];
      let rowTotal = 0;
      for (const s of data.chart1.series) {
        rowTotal += s.data[i] ?? 0;
      }
      for (const s of data.chart1.series) {
        const value = s.data[i] ?? 0;
        const row: Record<string, string | number> = {
          bucket,
          estado: s.name,
          value,
        };
        if (includePercent) {
          row.percentage = rowTotal > 0 ? ((value / rowTotal) * 100).toFixed(2) : "";
        }
        rows.push(row);
      }
    }
    return {
      filename: "reservas-chart1-por-estado.csv",
      csv: rowsToCsvLocal(
        ["bucket", "estado", "value", ...(includePercent ? ["percentage"] : [])],
        rows,
      ),
    };
  }

  if (chart === "2") {
    const values = data.chart2.series[0]?.data ?? [];
    for (let i = 0; i < buckets.length; i++) {
      rows.push({ bucket: buckets[i], value: values[i] ?? 0 });
    }
    return {
      filename: "reservas-chart2-total.csv",
      csv: rowsToCsvLocal(["bucket", "value"], rows),
    };
  }

  for (let i = 0; i < buckets.length; i++) {
    const num = data.chart3.numerator[i] ?? 0;
    const den = data.chart3.denominator[i] ?? 0;
    rows.push({
      bucket: buckets[i],
      value: num,
      total: den,
      percentage: den > 0 ? ((num / den) * 100).toFixed(2) : "",
    });
  }
  return {
    filename: "reservas-chart3-apoyo.csv",
    csv: rowsToCsvLocal(["bucket", "value", "total", "percentage"], rows),
  };
}

function rowsToCsvLocal(
  headers: string[],
  rows: Record<string, string | number>[],
): string {
  const esc = (v: string | number) => {
    const s = String(v ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => esc(row[h] ?? "")).join(","));
  }
  return lines.join("\n");
}

export function appendReservasParams(p: URLSearchParams, params: ReservasAggregationParams): void {
  p.set("start", params.start.toISOString());
  p.set("end", params.end.toISOString());
  p.set("granularity", params.granularity);
  if (params.semana) p.set("semana", params.semana);
  for (const e of params.estado ?? []) p.append("estado", e);
  for (const e of params.chart2Estado ?? []) p.append("chart2_estado", e);
  for (const d of params.weekdays ?? []) p.append("weekday", String(d));
}
