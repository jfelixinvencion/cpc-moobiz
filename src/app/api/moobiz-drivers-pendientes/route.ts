import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import {
  buildPostgrestOrderClause,
  resolveDatosPendientesSort,
} from "@/lib/datos-pendientes";
import {
  normalizeCount,
  normalizeDriverPendienteRows,
} from "@/lib/moobiz-drivers-pendientes-normalize";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { getSupabaseServerClient } from "@/lib/supabase-server";

export const runtime = "nodejs";

const SELECT = [
  `id_conductor:"ID Conductor"`,
  `nombre_conductor:"Nombre Conductor"`,
  `n_servicios_lt_30:"N Servicios <30"`,
  `sucursal:"Sucursal"`,
  `distrito_vive:"En que distrito vive"`,
  `turno:"Turno"`,
  `vencimiento_brevete:"Vencimiento de Brevete"`,
  `vencimiento_revision_tecnica:"Vencimiento de Revisión Técnica"`,
  `vencimiento_soat:"Vencimiento de SOAT"`,
  `tipo_contribuyente:"Tipo de Contribuyente"`,
  `marca_contabilidad_moobiz:"Marcar si Moobiz realiza su contabilidad"`,
  `numero_ruc_factura:"Número Ruc Factura"`,
  `usuario_sunat:"Usuario Sunat"`,
  `clave_sol_sunat:"Clave Sol Sunat"`,
  `estado:"Estado"`,
].join(",");

type DriverPendienteRow = Record<string, unknown>;

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (err && typeof err === "object" && "message" in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim()) return msg;
  }
  return formatApiError(err);
}

function isMissingRelationError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("does not exist") ||
    lower.includes("no existe la relación") ||
    lower.includes("could not find the table")
  );
}

function isMissingColumnError(err: unknown): boolean {
  if (err && typeof err === "object") {
    const code = (err as { code?: unknown }).code;
    if (code === "42703") return true;
  }
  const message = toErrorMessage(err).toLowerCase();
  return message.includes("does not exist") && message.includes("column");
}

async function queryFromSource(args: {
  sb: ReturnType<typeof getSupabaseServerClient>["client"];
  sourceName: "mv_moobiz_drivers_pendientes" | "vw_moobiz_drivers_pendientes";
  page: number;
  pageSize: number;
  sucursalFilter: string;
  estadoFilter: string;
  searchText: string;
  sortColumn: string;
  ascending: boolean;
  orderClause: string;
}) {
  const supabase = args.sb;
  const from = (args.page - 1) * args.pageSize;
  const to = from + args.pageSize - 1;
  const sortColumnForSource =
    args.sourceName === "vw_moobiz_drivers_pendientes" && args.sortColumn === "n_servicios_30"
      ? "n_servicios_lt_30"
      : args.sortColumn;
  const orderClauseForSource = buildPostgrestOrderClause(
    sortColumnForSource,
    args.ascending ? "asc" : "desc",
  );

  console.log("[moobiz-drivers-pendientes] Supabase ORDER / range:", {
    source: args.sourceName,
    sortColumn: sortColumnForSource,
    ascending: args.ascending,
    orderClause: orderClauseForSource,
    range: { from, to },
  });

  const baseQuery = () => {
    let q = supabase.schema("vista").from(args.sourceName).select(SELECT, { count: "exact" });
    if (args.sucursalFilter) q = q.eq("Sucursal", args.sucursalFilter);
    if (args.estadoFilter) q = q.eq("Estado", args.estadoFilter);
    if (args.searchText) q = q.ilike("Nombre Conductor", `%${args.searchText.replaceAll("%", "\\%")}%`);
    return q;
  };

  let result = await baseQuery()
    .order(sortColumnForSource, {
      ascending: args.ascending,
    })
    .range(from, to);

  if (result.error && isMissingColumnError(result.error)) {
    console.warn("[moobiz-drivers-pendientes] ORDER_FINAL fallback sin ORDER por columna faltante:", {
      source: args.sourceName,
      attemptedOrder: orderClauseForSource,
    });
    result = await baseQuery().range(from, to);
  }

  const { data, count, error } = result;
  if (error) throw error;

  let sucursalesDistinct: string[] = [];
  const sucRes = await supabase
    .schema("vista")
    .from(args.sourceName)
    .select(`sucursal:"Sucursal"`)
    .not("Sucursal", "is", null)
    .limit(5000);
  if (!sucRes.error) {
    sucursalesDistinct = Array.from(
      new Set(
        (Array.isArray(sucRes.data) ? sucRes.data : [])
          .map((r) => String((r as { sucursal?: unknown }).sucursal ?? "").trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "es"));
  }

  return {
    data: normalizeDriverPendienteRows(data as unknown),
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
    const { client: sb, usingServiceRole } = getSupabaseServerClient();
    console.log("[moobiz-drivers-pendientes] USING_SERVICE_ROLE:", usingServiceRole);

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;
    const pageSize = Math.min(100, Math.max(1, pageSizeRaw));
    const sucursalFilter = String(url.searchParams.get("sucursal") ?? "").trim();
    const estadoFilter = String(url.searchParams.get("estado") ?? "").trim();
    const searchText = String(url.searchParams.get("search") ?? "").trim();
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
      estadoFilter,
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

    try {
      const mv = await queryFromSource({
        sb,
        sourceName: "mv_moobiz_drivers_pendientes",
        page,
        pageSize,
        sucursalFilter,
        estadoFilter,
        searchText,
        sortColumn,
        ascending,
        orderClause,
      });
      return NextResponse.json(
        successPayload(mv, {
          page,
          pageSize,
          source: "vista.mv_moobiz_drivers_pendientes",
        }),
      );
    } catch (mvError) {
      const mvMsg = toErrorMessage(mvError);
      if (!isMissingRelationError(mvMsg)) throw mvError;
    }

    const vw = await queryFromSource({
      sb,
      sourceName: "vw_moobiz_drivers_pendientes",
      page,
      pageSize,
      sucursalFilter,
      estadoFilter,
      searchText,
      sortColumn,
      ascending,
      orderClause,
    });
    return NextResponse.json(
      successPayload(vw, {
        page,
        pageSize,
        source: "vista.vw_moobiz_drivers_pendientes",
      }),
    );
  } catch (err: unknown) {
    console.error(
      "[moobiz-drivers-pendientes] ERROR:",
      err instanceof Error ? err.stack : err,
    );
    const message = toErrorMessage(err);
    return NextResponse.json(
      { error: true, message, data: [], total: 0 },
      { status: 500 },
    );
  }
}
