import { NextRequest, NextResponse } from "next/server";

import { productividadError, productividadJson } from "@/lib/productividad-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import {
  parseProductividadParams,
  type ProductividadFilterField,
} from "@/lib/productividad-logs-params";
import {
  buildProductividadFilterOptionsQuery,
  formatProductividadSqlForLog,
  runProductividadFilterOptions,
} from "@/lib/productividad-logs-query";

export const runtime = "nodejs";

const VALID_FIELDS: ProductividadFilterField[] = [
  "estado",
  "n_semana",
  "type_user",
  "type_log_name",
  "us_name",
  "fecha",
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const field = url.searchParams.get("field")?.trim() as ProductividadFilterField | undefined;

  if (!field || !VALID_FIELDS.includes(field)) {
    return productividadError(
      `Parametro field requerido: ${VALID_FIELDS.join(", ")}`,
      400,
    );
  }

  const parsed = parseProductividadParams(url.searchParams);
  let sqlForLog = "";

  try {
    const preview = buildProductividadFilterOptionsQuery(parsed, field);
    sqlForLog = formatProductividadSqlForLog(preview.sql, preview.params);
    console.log(`[productividad/filters] field=${field}\n${sqlForLog}`);

    const pool = getMoobizViewsPool();
    const { values, sql } = await runProductividadFilterOptions(pool, parsed, field);

    return productividadJson({ field, values, column: preview.columnSql });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[productividad/filters] field=${field} error=${message}\n${sqlForLog}`);
    return NextResponse.json(
      {
        field,
        values: [],
        error: message,
        sql: sqlForLog || undefined,
      },
      { status: 500, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
