import { NextRequest } from "next/server";

import { comercialError, comercialJson } from "@/lib/comercial-api";
import {
  apiStatusFromMessage,
  sanitizeDateOptional,
  sanitizeFotoUrls,
  sanitizeOptionalText,
} from "@/lib/comercial-quejas";
import { runComercialQuejaById, runComercialQuejaReview } from "@/lib/comercial-quejas-query";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityWriteAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("VALIDATION_ID: id inválido.");
  }
  return id;
}

type ReviewBody = {
  respuesta?: string | null;
  fecha_respuesta?: string | null;
  acciones?: string | null;
  fotos_urls?: string[];
};

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertQualityWriteAccess(request);
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const body = (await request.json()) as ReviewBody;
    const pool = getMoobizViewsPool();
    const existing = await runComercialQuejaById(pool, id);
    if (!existing) return comercialError("NOT_FOUND: Queja no encontrada.", 404);

    const respuesta = sanitizeOptionalText(body.respuesta);
    const fecha_respuesta = sanitizeDateOptional(body.fecha_respuesta);
    const acciones = sanitizeOptionalText(body.acciones);
    const fotos_urls = sanitizeFotoUrls(body.fotos_urls ?? []);
    const accionesTrim = String(acciones ?? "").trim();
    const estado_registro = accionesTrim ? "Completado" : "En revision";

    const row = await runComercialQuejaReview(pool, id, {
      respuesta,
      fecha_respuesta,
      acciones,
      fotos_urls,
      estado_registro,
    });
    if (!row) return comercialError("NOT_FOUND: Queja no encontrada.", 404);
    return comercialJson({ data: row, estado_registro });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}
