import { NextRequest } from "next/server";

import { comercialError, comercialJson } from "@/lib/comercial-api";
import {
  ALLOWED_FOTO_TYPES,
  MAX_FOTO_BYTES,
  MAX_FOTOS_REVISION,
  STORAGE_BUCKET,
  apiStatusFromMessage,
  getSupabaseAdmin,
  sanitizeFileName,
} from "@/lib/comercial-quejas";
import { assertQualityWriteAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const form = await request.formData();
    const quejaIdRaw = String(form.get("queja_id") ?? "").trim();
    if (!quejaIdRaw || !/^\d+$/.test(quejaIdRaw)) {
      return comercialError("VALIDATION_REQUIRED: queja_id es obligatorio.", 400);
    }

    const files: File[] = [];
    for (const [key, value] of form.entries()) {
      if ((key === "files" || key === "files[]") && value instanceof File && value.size > 0) {
        files.push(value);
      }
    }
    if (files.length === 0) {
      return comercialError("VALIDATION_REQUIRED: Debes enviar al menos un archivo.", 400);
    }
    if (files.length > MAX_FOTOS_REVISION) {
      return comercialError(
        `VALIDATION_FOTOS: máximo ${MAX_FOTOS_REVISION} archivos por solicitud.`,
        400,
      );
    }

    const supabase = getSupabaseAdmin();
    const urls: string[] = [];

    for (const file of files) {
      const contentType = (file.type || "").toLowerCase();
      if (!ALLOWED_FOTO_TYPES.includes(contentType as (typeof ALLOWED_FOTO_TYPES)[number])) {
        return comercialError("VALIDATION_TYPE: Solo JPEG, PNG o WebP.", 422);
      }
      if (file.size > MAX_FOTO_BYTES) {
        return comercialError("VALIDATION_SIZE: cada foto debe ser ≤ 5 MB.", 422);
      }
      const safeName = sanitizeFileName(file.name || "foto.jpg");
      const path = `${quejaIdRaw}/${Date.now()}_${safeName}`;
      const buffer = Buffer.from(await file.arrayBuffer());
      const { error: uploadErr } = await supabase.storage
        .from(STORAGE_BUCKET)
        .upload(path, buffer, { contentType, upsert: false });
      if (uploadErr) throw uploadErr;
      const { data: pub } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      urls.push(pub.publicUrl);
    }

    return comercialJson({ urls });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}
