import { NextRequest, NextResponse } from "next/server";
import { formatApiError } from "@/lib/format-api-error";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { getSupabaseAdmin } from "@/lib/quality-audit";

export const runtime = "nodejs";

/** Vistas en esquema `vista` (no `public`). */
const SCHEMA = "vista";
/** Última auditoría por conductor con resultado Condicional o Rechazado. */
const VIEW = "quality_audits_seguimiento";
const SELECT_FIELDS =
  "id,driver_id,driver_name,vehicle_plate,auditor_id,auditor_name,created_at,updated_at,status,fotos_count,foto_paths,estado,usuario_estado,resultado,score,checklist,raw_data,notes,created_by";

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "20", 10) || 20;
    const limit = Math.min(100, Math.max(1, limitRaw));
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    const driverId = (url.searchParams.get("driverId") ?? "").trim();

    const supabase = getSupabaseAdmin();
    // Esquema explícito `vista` (no public); PostgREST debe tener `vista` en esquemas expuestos.
    let query = supabase.schema(SCHEMA).from(VIEW).select(SELECT_FIELDS, { count: "exact" });

    query = query.order("created_at", { ascending: false, nullsFirst: false }).order("id", { ascending: false });
    if (driverId) {
      query = query.ilike("driver_id", `%${driverId.replaceAll("%", "\\%")}%`);
    }

    const { data, count, error } = await query.range(from, to);
    if (error) {
      const msg = formatApiError(error);
      return NextResponse.json(
        {
          error: msg,
          hint:
            "Comprueba en Supabase: Settings → API → Exposed schemas incluye `vista`, y que exista vista.quality_audits_seguimiento.",
          data: [],
          total: 0,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message, data: [], total: 0 }, { status });
  }
}
