import { NextRequest } from "next/server";

import { productividadError, productividadJson } from "@/lib/productividad-api";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import {
  parseProductividadParams,
  type ProductividadFilterField,
} from "@/lib/productividad-logs-params";
import { runProductividadFilterOptions } from "@/lib/productividad-logs-query";

export const runtime = "nodejs";

const VALID_FIELDS: ProductividadFilterField[] = [
  "global",
  "estado",
  "n_semana",
  "type_user",
  "type_log_name",
  "us_name",
  "fecha",
];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const field = url.searchParams.get("field")?.trim() as ProductividadFilterField | undefined;
    if (!field || !VALID_FIELDS.includes(field)) {
      return productividadError(
        `Parametro field requerido: ${VALID_FIELDS.join(", ")}`,
        400,
      );
    }
    const parsed = parseProductividadParams(url.searchParams);
    const pool = getMoobizViewsPool();
    const values = await runProductividadFilterOptions(pool, parsed, field);
    return productividadJson({ field, values });
  } catch (err) {
    return productividadError(err instanceof Error ? err.message : String(err));
  }
}
