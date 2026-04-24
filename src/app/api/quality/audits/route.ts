import { NextRequest, NextResponse } from "next/server";
import {
  assertQualityReadAccess,
  assertQualityWriteAccess,
  getQualityActorDefaultName,
  getQualityActorUserId,
} from "@/lib/panel-session";
import {
  getSupabaseAdmin,
  normalizeStatus,
  QUALITY_RESULTS,
  sanitizeChecklist,
  sanitizeDriverId,
  sanitizePhotoPaths,
} from "@/lib/quality-audit";

export const runtime = "nodejs";

const TABLE = "quality_audits";
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
    const dateFrom = (url.searchParams.get("dateFrom") ?? "").trim();
    const dateTo = (url.searchParams.get("dateTo") ?? "").trim();
    const driverId = (url.searchParams.get("driverId") ?? "").trim();
    const result = (url.searchParams.get("resultado") ?? "").trim();
    const status = (url.searchParams.get("status") ?? "").trim().toLowerCase();

    const supabase = getSupabaseAdmin();
    let query = supabase.from(TABLE).select(SELECT_FIELDS, { count: "exact" });

    query = query.order("created_at", { ascending: false });
    if (dateFrom) query = query.gte("created_at", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) query = query.lte("created_at", `${dateTo}T23:59:59.999Z`);
    if (driverId) query = query.ilike("driver_id", `%${driverId.replaceAll("%", "\\%")}%`);
    if (result && QUALITY_RESULTS.includes(result as (typeof QUALITY_RESULTS)[number])) {
      query = query.eq("resultado", result);
    }
    if (status) query = query.eq("status", normalizeStatus(status));

    const { data, count, error } = await query.range(from, to);
    if (error) throw error;

    return NextResponse.json({
      data: data ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message, data: [], total: 0 }, { status });
  }
}

type CreateAuditBody = {
  id?: string;
  driver_id?: string;
  driver_name?: string;
  vehicle_plate?: string;
  auditor_name?: string;
  status?: string;
  resultado?: string;
  score?: number | null;
  notes?: string;
  estado?: string;
  usuario_estado?: string;
  checklist?: unknown;
  raw_data?: unknown;
  foto_paths?: unknown;
};

export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const actorId = getQualityActorUserId();
    const defaultName = getQualityActorDefaultName();
    const body = (await request.json()) as CreateAuditBody;
    const status = normalizeStatus(body.status);
    const photoPaths = sanitizePhotoPaths(body.foto_paths, status !== "draft");
    const checklist = sanitizeChecklist(body.checklist ?? {});
    const resultado = String(body.resultado ?? "").trim();
    if (resultado && !QUALITY_RESULTS.includes(resultado as (typeof QUALITY_RESULTS)[number])) {
      return NextResponse.json({ error: "RESULT_INVALID: resultado inválido." }, { status: 422 });
    }

    const payload = {
      driver_id: sanitizeDriverId(body.driver_id),
      driver_name: String(body.driver_name ?? "").trim() || null,
      vehicle_plate: String(body.vehicle_plate ?? "").trim() || null,
      auditor_id: actorId,
      auditor_name: String(body.auditor_name ?? "").trim() || defaultName,
      status,
      fotos_count: photoPaths.length,
      foto_paths: photoPaths,
      estado: String(body.estado ?? "").trim() || null,
      usuario_estado: String(body.usuario_estado ?? "").trim() || null,
      resultado: resultado || null,
      score: typeof body.score === "number" ? body.score : null,
      checklist,
      raw_data: body.raw_data ?? {},
      notes: String(body.notes ?? "").trim() || null,
      created_by: actorId,
    };
    const idValue = String(body.id ?? "").trim();
    if (idValue) {
      Object.assign(payload, { id: idValue });
    }

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(TABLE)
      .insert(payload)
      .select(SELECT_FIELDS)
      .single();
    if (error) throw error;
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH_REQUIRED")
      ? 401
      : message.includes("_INVALID") || message.includes("_REQUIRED")
        ? 422
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
