import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import {
  DATOS_PENDIENTES_SORT_COLUMN_MAP,
  normalizeSortDir,
  normalizeSortKey,
} from "@/lib/datos-pendientes";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { getSupabaseAdmin } from "@/lib/quality-audit";

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

function isMissingRelationError(message: string): boolean {
  const lower = message.toLowerCase();
  return lower.includes("does not exist") || lower.includes("no existe la relación");
}

async function queryFromSource(args: {
  sourceName: "mv_moobiz_drivers_pendientes" | "vw_moobiz_drivers_pendientes";
  page: number;
  pageSize: number;
  sucursalFilter: string;
  estadoFilter: string;
  searchText: string;
  sortColumn: string;
  ascending: boolean;
}) {
  const supabase = getSupabaseAdmin();
  const from = (args.page - 1) * args.pageSize;
  const to = from + args.pageSize - 1;

  let q = supabase.schema("vista").from(args.sourceName).select(SELECT, { count: "exact" });
  if (args.sucursalFilter) q = q.eq("Sucursal", args.sucursalFilter);
  if (args.estadoFilter) q = q.eq("Estado", args.estadoFilter);
  if (args.searchText) q = q.ilike("Nombre Conductor", `%${args.searchText.replaceAll("%", "\\%")}%`);
  q = q.order(args.sortColumn, { ascending: args.ascending, nullsFirst: false }).range(from, to);

  const { data, count, error } = await q;
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
    data: (Array.isArray(data) ? data : []) as DriverPendienteRow[],
    total: count ?? 0,
    sucursalesDistinct,
  };
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);

    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw));
    const sucursalFilter = String(url.searchParams.get("sucursal") ?? "").trim();
    const estadoFilter = String(url.searchParams.get("estado") ?? "").trim();
    const searchText = String(url.searchParams.get("search") ?? "").trim();
    const sortBy = normalizeSortKey(url.searchParams.get("sortBy"));
    const sortDir = normalizeSortDir(url.searchParams.get("sortDir"));
    const sortColumn = DATOS_PENDIENTES_SORT_COLUMN_MAP[sortBy];
    const ascending = sortDir === "asc";

    try {
      const mv = await queryFromSource({
        sourceName: "mv_moobiz_drivers_pendientes",
        page,
        pageSize,
        sucursalFilter,
        estadoFilter,
        searchText,
        sortColumn,
        ascending,
      });
      return NextResponse.json({
        data: mv.data,
        total: mv.total,
        page,
        pageSize,
        source: "vista.mv_moobiz_drivers_pendientes",
        sucursalOptions: mv.sucursalesDistinct,
      });
    } catch (mvError) {
      const mvMsg = formatApiError(mvError);
      if (!isMissingRelationError(mvMsg)) throw mvError;
    }

    const vw = await queryFromSource({
      sourceName: "vw_moobiz_drivers_pendientes",
      page,
      pageSize,
      sucursalFilter,
      estadoFilter,
      searchText,
      sortColumn,
      ascending,
    });
    return NextResponse.json({
      data: vw.data,
      total: vw.total,
      page,
      pageSize,
      source: "vista.vw_moobiz_drivers_pendientes",
      sucursalOptions: vw.sucursalesDistinct,
    });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json(
      {
        error: message,
        hint: "Si la vista no existe en preview, valida esquema `vista` expuesto y objetos `vw_/mv_moobiz_drivers_pendientes`.",
        data: [],
        total: 0,
        page: 1,
        pageSize: 50,
        source: null,
        sucursalOptions: [],
      },
      { status },
    );
  }
}
