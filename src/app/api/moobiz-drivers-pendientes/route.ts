/**
 * Route Handler exclusivo de servidor. No exportar ningún cliente Supabase ni
 * importar este módulo desde componentes cliente; el navegador solo usa `fetch` a esta ruta.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { formatApiError } from "@/lib/format-api-error";
import {
  buildPostgrestOrderClause,
  parseGlobalFilterParam,
  resolveDatosPendientesSort,
} from "@/lib/datos-pendientes";
import {
  normalizeCount,
  normalizeDriverPendienteRowsFromVistaLabels,
} from "@/lib/moobiz-drivers-pendientes-normalize";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

/** Cliente admin (service role), no exportado — solo uso interno de este archivo. */
let supabaseAdminSingleton: SupabaseClient | null = null;
function getSupabaseAdmin(): SupabaseClient {
  if (supabaseAdminSingleton) return supabaseAdminSingleton;
  if (!process.env.SUPABASE_URL?.trim() || !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error("Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY.");
  }
  supabaseAdminSingleton = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return supabaseAdminSingleton;
}

/** Identificador PostgREST para `.order()` cuando la columna en la vista tiene `<` o espacios (nombre legible). */
const VISTA_ORDER_QUOTED_N_SERVICIOS = '"N Servicios <30"';

/**
 * Traduce `sortColumn` resuelto desde `sortBy` (p. ej. `n_servicios_30`) al nombre que debe recibir `.order()` sobre la vista.
 */
function vistaOrderColumnForSupabase(sortColumn: string): string {
  if (sortColumn === "n_servicios_30" || sortColumn === "n_servicios_lt_30") {
    return VISTA_ORDER_QUOTED_N_SERVICIOS;
  }
  if (sortColumn === "estado") {
    return "Status";
  }
  return sortColumn;
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return formatApiError(err);
}

function isMissingColumnError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === "42703") return true;
  }
  const message = toErrorMessage(err).toLowerCase();
  return message.includes("does not exist") && message.includes("column");
}

function redactSupabaseKey(key: string): string {
  const k = key.trim();
  if (k.length < 16) return `[len=${k.length}]`;
  return `${k.slice(0, 8)}…${k.slice(-4)} (len=${k.length})`;
}

/** Solo para diagnóstico: lee el claim `role` del JWT sin loguear el token completo. */
function logJwtRoleFromServiceKey(url: string, key: string): void {
  const parts = key.trim().split(".");
  if (parts.length !== 3) {
    console.log("[moobiz-drivers-pendientes] SUPABASE_KEY_SHAPE:", {
      url,
      segments: parts.length,
      redacted: redactSupabaseKey(key),
    });
    return;
  }
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as { role?: string };
    console.log("[moobiz-drivers-pendientes] SUPABASE_JWT_ROLE:", payload.role ?? "(missing)");
  } catch {
    console.log("[moobiz-drivers-pendientes] SUPABASE_JWT_ROLE: (no se pudo decodificar payload)");
  }
}

function logSupabaseEnvForRoute(usingServiceRole: boolean): void {
  const url = process.env.SUPABASE_URL?.trim() || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || "";
  console.log("[moobiz-drivers-pendientes] SUPABASE_URL_IN_USE:", url || "(vacío)");
  console.log("[moobiz-drivers-pendientes] SUPABASE_SERVICE_ROLE_KEY_REDACTED:", key ? redactSupabaseKey(key) : "(vacío)");
  console.log(
    "[moobiz-drivers-pendientes] RLS: PostgREST con service role no aplica políticas RLS al rol service_role (bypass). usingServiceRole=",
    usingServiceRole,
  );
  if (url && key) logJwtRoleFromServiceKey(url, key);
}

async function probeMoobizDriversTable(sb: SupabaseClient): Promise<void> {
  const { data, error } = await sb.from("moobiz_drivers").select("id").limit(1);
  if (error) {
    console.warn("[moobiz-drivers-pendientes] PROBE moobiz_drivers FAILED:", {
      code: (error as { code?: string }).code,
      message: error.message,
    });
    return;
  }
  console.log("[moobiz-drivers-pendientes] PROBE moobiz_drivers OK:", {
    rows: Array.isArray(data) ? data.length : 0,
  });
}

async function queryExcelView(args: {
  sb: SupabaseClient;
  page: number;
  pageSize: number;
  sucursalFilter: string;
  statusFilter: string;
  globalFilter: string;
  searchText: string;
  sortColumn: string;
  ascending: boolean;
  orderClause: string;
}) {
  const supabase = args.sb;
  const from = (args.page - 1) * args.pageSize;
  const to = from + args.pageSize - 1;
  const sortColumnForSource = vistaOrderColumnForSupabase(args.sortColumn);
  const orderClauseForSource = buildPostgrestOrderClause(
    sortColumnForSource,
    args.ascending ? "asc" : "desc",
  );

  console.log("[moobiz-drivers-pendientes] ORDER_COLUMN_SENT_TO_SUPABASE:", sortColumnForSource);
  console.log("[moobiz-drivers-pendientes] Supabase ORDER / range:", {
    source: "vw_moobiz_drivers_excel",
    schema: "vista",
    sortColumn: sortColumnForSource,
    ascending: args.ascending,
    orderClause: orderClauseForSource,
    range: { from, to },
  });

  const baseQuery = () => {
    let q = supabase.schema('vista').from('vw_moobiz_drivers_excel').select("*", { count: "exact" });
    if (args.sucursalFilter) q = q.eq("Sucursal", args.sucursalFilter);
    if (args.statusFilter) q = q.eq("Status", args.statusFilter);
    if (args.globalFilter) q = q.eq("GLOBAL", args.globalFilter);
    if (args.searchText) {
      q = q.ilike("Nombre Conductor", `%${args.searchText.replaceAll("%", "\\%")}%`);
    }
    return q;
  };

  let result = await baseQuery()
    .order(sortColumnForSource, {
      ascending: args.ascending,
    })
    .range(from, to);

  if (result.error && isMissingColumnError(result.error)) {
    console.warn("[moobiz-drivers-pendientes] ORDER_FINAL fallback sin ORDER por columna faltante:", {
      source: "vw_moobiz_drivers_excel",
      attemptedOrder: orderClauseForSource,
    });
    result = await baseQuery().range(from, to);
  }

  const { data, count, error } = result;
  if (error) throw error;

  if (Array.isArray(data) && data.length > 0 && data[0] && typeof data[0] === "object") {
    console.log("[DEBUG] Keys detectadas en el primer registro:", Object.keys(data[0] as object));
  }

  let sucursalesDistinct: string[] = [];
  const sucRes = await supabase
    .schema('vista')
    .from('vw_moobiz_drivers_excel')
    .select(`sucursal:"Sucursal"`)
    .not("Sucursal", "is", null)
    .limit(5000);
  if (!sucRes.error) {
    const rawRows = Array.isArray(sucRes.data) ? sucRes.data : [];
    const names: string[] = rawRows.map((r: { sucursal?: unknown }) =>
      String(r.sucursal ?? "").trim(),
    );
    sucursalesDistinct = Array.from(new Set(names.filter(Boolean))).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
  }

  return {
    data: normalizeDriverPendienteRowsFromVistaLabels(data as unknown),
    total: normalizeCount(count),
    sucursalesDistinct,
  };
}

function successPayload(
  mv: { data: unknown[]; total: number; sucursalesDistinct: string[] },
  meta: { page: number; pageSize: number; source: string },
) {
  return {
    data: mv.data,
    total: mv.total,
    sucursalesDistinct: mv.sucursalesDistinct,
    sucursalOptions: mv.sucursalesDistinct,
    page: meta.page,
    pageSize: meta.pageSize,
    source: meta.source,
  };
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const sb = getSupabaseAdmin();
    const usingServiceRole = Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
    console.log("[moobiz-drivers-pendientes] USING_SERVICE_ROLE:", usingServiceRole);
    logSupabaseEnvForRoute(usingServiceRole);

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const sucursalFilter = String(url.searchParams.get("sucursal") ?? "").trim();
    const rawEstado = url.searchParams.get("estado");
    let statusFilter = "";
    if (rawEstado !== null && String(rawEstado).trim() !== "") {
      const t = String(rawEstado).trim().toLowerCase();
      if (t !== "all" && t !== "__all__") {
        statusFilter = String(rawEstado).trim();
      }
    }
    const searchText = String(url.searchParams.get("search") ?? "").trim();
    const globalFilter = parseGlobalFilterParam(url.searchParams.get("global"));
    const rawSortBy = url.searchParams.get("sortBy");
    const rawSortDir = url.searchParams.get("sortDir");
    const rawNulls = url.searchParams.get("nulls");
    const sortSpec = resolveDatosPendientesSort({
      rawSortBy,
      rawSortDir,
      rawNulls,
    });
    if (sortSpec.usedFallback) {
      console.warn(
        `[datos-pendientes] sortBy no permitido, usando fallback seguro n_servicios_30 desc: "${String(
          rawSortBy ?? "",
        )}"`,
      );
    }
    const sortColumn = sortSpec.orderColumn;
    const ascending = sortSpec.sortDir === "asc";
    const orderClause = buildPostgrestOrderClause(sortColumn, sortSpec.sortDir);

    console.log("[moobiz-drivers-pendientes] GET params / sort resolved:", {
      page,
      pageSize,
      sucursalFilter,
      statusFilter,
      globalFilter,
      searchText,
      rawSortBy,
      rawSortDir,
      rawNulls,
      sortColumn,
      ascending,
      sortDir: sortSpec.sortDir,
      usedFallback: sortSpec.usedFallback,
    });
    console.log("[moobiz-drivers-pendientes] ORDER_FINAL:", orderClause);
    console.log("[moobiz-drivers-pendientes] SORT_HEADER_TO_ORDER_ARG:", {
      sortKey: sortSpec.sortKey,
      orderColumnFromResolver: sortColumn,
      supabaseOrderFirstArg: vistaOrderColumnForSupabase(sortColumn),
    });

    const result = await queryExcelView({
      sb,
      page,
      pageSize,
      sucursalFilter,
      statusFilter,
      globalFilter,
      searchText,
      sortColumn,
      ascending,
      orderClause,
    });
    return NextResponse.json(
      successPayload(result, {
        page,
        pageSize,
        source: "vista.vw_moobiz_drivers_excel",
      }),
    );
  } catch (err: unknown) {
    console.error(
      "[moobiz-drivers-pendientes] ERROR:",
      err instanceof Error ? err.stack : err,
    );
    const message = toErrorMessage(err);
    if (/permission denied/i.test(message)) {
      try {
        await probeMoobizDriversTable(getSupabaseAdmin());
      } catch (probeErr) {
        console.warn("[moobiz-drivers-pendientes] PROBE moobiz_drivers skipped:", toErrorMessage(probeErr));
      }
    }
    return NextResponse.json(
      { error: true, message, data: [], total: 0 },
      { status: 500 },
    );
  }
}
