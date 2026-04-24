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

type Params = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: Params) {
  try {
    assertQualityReadAccess(request);
    const { id } = await params;
    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase.from(TABLE).select(SELECT_FIELDS).eq("id", id).single();
    if (error) throw error;

    const bucket = process.env.QUALITY_PHOTOS_BUCKET?.trim() || "audits-photos";
    const photoPaths = Array.isArray(data.foto_paths) ? data.foto_paths : [];
    const signedPhotos: Array<{ path: string; signedUrl: string }> = [];
    for (const path of photoPaths) {
      const { data: signed, error: signedError } = await supabase.storage
        .from(bucket)
        .createSignedUrl(path, 60 * 30);
      if (!signedError && signed?.signedUrl) {
        signedPhotos.push({ path, signedUrl: signed.signedUrl });
      }
    }

    return NextResponse.json({ data, signedPhotos });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

type PatchBody = {
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

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    assertQualityWriteAccess(request);
    const actorId = getQualityActorUserId();
    const defaultName = getQualityActorDefaultName();
    const { id } = await params;
    const body = (await request.json()) as PatchBody;
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
    };

    const supabase = getSupabaseAdmin();
    const { data, error } = await supabase
      .from(TABLE)
      .update(payload)
      .eq("id", id)
      .select(SELECT_FIELDS)
      .single();
    if (error) throw error;

    return NextResponse.json({ data });
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
