import { NextRequest, NextResponse } from "next/server";
import { assertQualityWriteAccess } from "@/lib/panel-session";
import { ALLOWED_PHOTO_TYPES, getSupabaseAdmin, MAX_PHOTO_BYTES } from "@/lib/quality-audit";

export const runtime = "nodejs";

type UploadUrlBody = {
  auditId?: string;
  filename?: string;
  contentType?: string;
  size?: number;
};

function sanitizeFileName(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const body = (await request.json()) as UploadUrlBody;
    const auditId = String(body.auditId ?? "").trim();
    const filename = String(body.filename ?? "").trim();
    const contentType = String(body.contentType ?? "").trim().toLowerCase();
    const size = Number(body.size ?? 0);

    if (!auditId || !filename) {
      return NextResponse.json(
        { error: "VALIDATION_REQUIRED: auditId y filename son obligatorios." },
        { status: 400 },
      );
    }
    if (!ALLOWED_PHOTO_TYPES.includes(contentType)) {
      return NextResponse.json({ error: "VALIDATION_TYPE: Solo JPG/PNG." }, { status: 422 });
    }
    if (!Number.isFinite(size) || size <= 0 || size > MAX_PHOTO_BYTES) {
      return NextResponse.json(
        { error: "VALIDATION_SIZE: tamaño inválido o > 5MB." },
        { status: 422 },
      );
    }

    const bucket = process.env.QUALITY_PHOTOS_BUCKET?.trim() || "audits-photos";
    const safeName = sanitizeFileName(filename);
    const path = `audits/${auditId}/${Date.now()}_${safeName}`;
    const supabase = getSupabaseAdmin();

    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) throw error ?? new Error("No se pudo crear signed upload URL.");

    return NextResponse.json({
      bucket,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
