import { formatInTimeZone } from "date-fns-tz";
import { NextRequest } from "next/server";
import type { Pool } from "pg";

import {
  buildReservasExportCsv,
  parseReservasAggregationParams,
  runReservasAggregations,
  type ReservasAggregationParams,
} from "@/lib/aggregations-reservas";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { reservasError } from "@/lib/reservas-api";

export const runtime = "nodejs";

const TABLE = "reportes.historico_reservas";
const AMERICA_LIMA = "America/Lima";
const RAW_DEFAULT_LIMIT = 10_000;
const RAW_MAX_LIMIT = 100_000;

const RAW_CSV_HEADERS = [
  "ID Servicio",
  "F. Programada",
  "Nombre Conductor",
  "Estado",
  "Semana",
] as const;

type RawRow = {
  id_servicio: string | null;
  f_programada: Date | string | null;
  nombre_conductor: string | null;
  estado: string | null;
  semana: string | null;
};

function parseRawPagination(sp: URLSearchParams): { limit: number; offset: number } {
  const limitRaw = Number.parseInt(sp.get("limit") ?? String(RAW_DEFAULT_LIMIT), 10);
  const offsetRaw = Number.parseInt(sp.get("offset") ?? "0", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), RAW_MAX_LIMIT)
    : RAW_DEFAULT_LIMIT;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;
  return { limit, offset };
}

function rawWhereSql(): string {
  return `
    r."F. Programada" IS NOT NULL
    AND r."F. Programada" >= $1::date
    AND r."F. Programada" < $2::date
    AND ($3::text IS NULL OR $3 = '' OR r."Semana" = $3)
    AND (cardinality($4::text[]) = 0 OR r."Estado" = ANY($4::text[]))
    AND (cardinality($5::int[]) = 0 OR EXTRACT(ISODOW FROM r."F. Programada")::int = ANY($5::int[]))
  `;
}

function rawBaseParams(params: ReservasAggregationParams): unknown[] {
  return [
    params.startDate,
    params.endExclusiveDate,
    params.semana,
    params.estado ?? [],
    params.weekdays ?? [],
  ];
}

function formatFProgramadaCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return String(value).trim();
  return formatInTimeZone(d, AMERICA_LIMA, "dd/MM/yyyy HH:mm:ss");
}

function escCsvCell(v: string | number): string {
  const s = String(v ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function buildRawCsv(rows: RawRow[]): string {
  const lines = [RAW_CSV_HEADERS.join(",")];
  for (const row of rows) {
    lines.push(
      [
        escCsvCell(row.id_servicio ?? ""),
        escCsvCell(formatFProgramadaCsv(row.f_programada)),
        escCsvCell(row.nombre_conductor ?? ""),
        escCsvCell(row.estado ?? ""),
        escCsvCell(row.semana ?? ""),
      ].join(","),
    );
  }
  return lines.join("\n");
}

function rawFilename(params: ReservasAggregationParams): string {
  return `reservas_raw_${params.startDate}_${params.endExclusiveDate}.csv`;
}

async function exportRawReservasCsv(
  pool: Pool,
  params: ReservasAggregationParams,
  limit: number,
  offset: number,
): Promise<{ csv: string; totalCount: number; filename: string }> {
  const where = rawWhereSql();
  const baseParams = rawBaseParams(params);

  const countRes = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::bigint AS cnt FROM ${TABLE} r WHERE ${where}`,
    baseParams,
  );
  const totalCount = Number(countRes.rows[0]?.cnt) || 0;

  const dataRes = await pool.query<RawRow>(
    `SELECT
      r."ID Servicio" AS id_servicio,
      r."F. Programada" AS f_programada,
      r."Nombre Conductor" AS nombre_conductor,
      r."Estado" AS estado,
      r."Semana" AS semana
    FROM ${TABLE} r
    WHERE ${where}
    ORDER BY r."F. Programada" ASC
    LIMIT $6 OFFSET $7`,
    [...baseParams, limit, offset],
  );

  return {
    csv: buildRawCsv(dataRes.rows),
    totalCount,
    filename: rawFilename(params),
  };
}

export async function GET(req: NextRequest) {
  try {
    assertQualityReadAccess(req);
    const url = new URL(req.url);
    const parsed = parseReservasAggregationParams(url.searchParams);
    const pool = getMoobizViewsPool();

    const raw = url.searchParams.get("raw")?.trim().toLowerCase() === "true";
    if (raw) {
      const { limit, offset } = parseRawPagination(url.searchParams);
      const { csv, totalCount, filename } = await exportRawReservasCsv(
        pool,
        parsed,
        limit,
        offset,
      );
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "private, no-store",
          "X-Total-Count": String(totalCount),
        },
      });
    }

    const chartRaw = url.searchParams.get("chart")?.trim();
    if (chartRaw !== "1" && chartRaw !== "2" && chartRaw !== "3" && chartRaw !== "all") {
      return reservasError("Query param chart must be 1, 2, 3 or all", 400);
    }

    const data = await runReservasAggregations(pool, parsed);
    const includePercent = url.searchParams.get("include_percent") === "1";

    if (chartRaw === "all") {
      const parts = (["1", "2", "3"] as const).map((c) =>
        buildReservasExportCsv(c, data, includePercent),
      );
      const csv = parts.map((p) => `# ${p.filename}\n${p.csv}`).join("\n\n");
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": 'attachment; filename="reservas-charts-all.csv"',
          "Cache-Control": "private, no-store",
        },
      });
    }

    const { filename, csv } = buildReservasExportCsv(chartRaw, data, includePercent);
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("AUTH_REQUIRED")) {
      return reservasError("Unauthorized", 401);
    }
    console.error("[dashboard/reservas/export]", msg);
    return reservasError("Failed to export reservas data", 500);
  }
}
