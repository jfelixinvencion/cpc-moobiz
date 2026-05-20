import { NextRequest } from "next/server";

import { comercialError, comercialJson } from "@/lib/comercial-api";
import {
  apiStatusFromMessage,
  resolveEstadoOnUpdate,
  sanitizeDateOptional,
  sanitizeFuente,
  sanitizeFotoUrls,
  sanitizeOptionalText,
  sanitizeRequiredText,
  STORAGE_BUCKET,
  getSupabaseAdmin,
} from "@/lib/comercial-quejas";
import type { ComercialQuejaRow } from "@/lib/comercial-quejas-query";
import {
  runComercialQuejaById,
  runComercialQuejaDelete,
} from "@/lib/comercial-quejas-query";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess, assertQualityWriteAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

const ALLOWED_TURNOS = ["Mañana", "Tarde", "Noche"] as const;

function validateTurno(turno: string): string | null {
  if (!ALLOWED_TURNOS.includes(turno as (typeof ALLOWED_TURNOS)[number])) {
    return "Turno inválido";
  }
  return null;
}

function mapReturnedRow(r: Record<string, unknown>): ComercialQuejaRow {
  const fotos = r.fotos_revision;
  return {
    id: Number(r.id),
    fecha_queja: String(r.fecha_queja ?? "").slice(0, 10),
    id_servicio: String(r.id_servicio ?? ""),
    estado_servicio: r.estado_servicio != null ? String(r.estado_servicio) : null,
    empresa: r.empresa != null ? String(r.empresa) : null,
    usuario: r.usuario != null ? String(r.usuario) : null,
    invitado: r.invitado != null ? String(r.invitado) : null,
    pasajero: r.pasajero != null ? String(r.pasajero) : null,
    conductor: r.conductor != null ? String(r.conductor) : null,
    turno: r.turno != null ? String(r.turno) : null,
    categoria: r.categoria != null ? String(r.categoria) : null,
    descripcion: r.descripcion != null ? String(r.descripcion) : null,
    fuente: r.fuente != null ? String(r.fuente) : null,
    estado_registro: String(r.estado_registro ?? "Pendiente"),
    respuesta: r.respuesta != null ? String(r.respuesta) : null,
    fecha_respuesta:
      r.fecha_respuesta != null ? String(r.fecha_respuesta).slice(0, 10) : null,
    acciones: r.acciones != null ? String(r.acciones) : null,
    fotos_revision: Array.isArray(fotos) ? fotos.map(String) : [],
    created_by: r.created_by != null ? String(r.created_by) : null,
    created_at:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : String(r.created_at ?? ""),
  };
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("VALIDATION_ID: id inválido.");
  }
  return id;
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertQualityReadAccess(request);
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const pool = getMoobizViewsPool();
    const row = await runComercialQuejaById(pool, id);
    if (!row) return comercialError("NOT_FOUND: Queja no encontrada.", 404);
    return comercialJson({ data: row });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}

type UpdateBody = {
  turno?: string;
  categoria?: string;
  descripcion?: string;
  fuente?: string;
  respuesta?: string | null;
  fecha_respuesta?: string | null;
  acciones?: string | null;
  fotos_revision?: string[];
};

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertQualityWriteAccess(request);
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const body = (await request.json()) as UpdateBody;
    const pool = getMoobizViewsPool();
    const existing = await runComercialQuejaById(pool, id);
    if (!existing) return comercialError("NOT_FOUND: Queja no encontrada.", 404);

    const turno =
      body.turno !== undefined ? String(body.turno).trim() : (existing.turno ?? "");
    if (body.turno !== undefined) {
      const turnoErr = validateTurno(turno);
      if (turnoErr) {
        return comercialJson({ error: turnoErr }, 400);
      }
    }

    const categoria =
      body.categoria !== undefined
        ? sanitizeRequiredText(body.categoria, "categoria", 500)
        : existing.categoria ?? "";
    const descripcion =
      body.descripcion !== undefined
        ? sanitizeRequiredText(body.descripcion, "descripcion")
        : existing.descripcion ?? "";
    const fuente =
      body.fuente !== undefined ? sanitizeFuente(body.fuente) : existing.fuente ?? "";
    const respuesta =
      body.respuesta !== undefined
        ? sanitizeOptionalText(body.respuesta)
        : existing.respuesta;
    const fecha_respuesta =
      body.fecha_respuesta !== undefined
        ? sanitizeDateOptional(body.fecha_respuesta)
        : existing.fecha_respuesta;
    const acciones =
      body.acciones !== undefined
        ? sanitizeOptionalText(body.acciones)
        : existing.acciones;
    const fotos_revision =
      body.fotos_revision !== undefined
        ? sanitizeFotoUrls(body.fotos_revision)
        : existing.fotos_revision ?? [];

    const updatingReview =
      body.respuesta !== undefined ||
      body.fecha_respuesta !== undefined ||
      body.acciones !== undefined;
    const estado_registro = resolveEstadoOnUpdate({
      acciones,
      updatingReview,
      previous: existing.estado_registro,
    });

    const sql = `
      UPDATE comercial.registro_quejas
      SET turno = $1,
          categoria = $2,
          descripcion = $3,
          fuente = $4,
          respuesta = $5,
          fecha_respuesta = $6::date,
          acciones = $7,
          fotos_revision = $8::text[],
          estado_registro = $9
      WHERE id = $10
      RETURNING *;
    `;

    const params = [
      turno,
      categoria,
      descripcion,
      fuente,
      respuesta,
      fecha_respuesta,
      acciones,
      fotos_revision,
      estado_registro,
      id,
    ];

    const { rows } = await pool.query<Record<string, unknown>>(sql, params);
    if (!rows[0]) {
      return comercialError("NOT_FOUND: Queja no encontrada.", 404);
    }

    return comercialJson({ data: mapReturnedRow(rows[0]) });
  } catch (error) {
    console.error("comercial quejas PUT error", error);
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}

async function deleteStorageFolder(quejaId: number): Promise<void> {
  try {
    const supabase = getSupabaseAdmin();
    const prefix = `${quejaId}`;
    const { data: listed, error: listErr } = await supabase.storage
      .from(STORAGE_BUCKET)
      .list(prefix, { limit: 100 });
    if (listErr || !listed?.length) return;
    const paths = listed.map((f) => `${prefix}/${f.name}`);
    await supabase.storage.from(STORAGE_BUCKET).remove(paths);
  } catch {
    /* best-effort */
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertQualityWriteAccess(request);
    const { id: idParam } = await context.params;
    const id = parseId(idParam);
    const pool = getMoobizViewsPool();
    const deleted = await runComercialQuejaDelete(pool, id);
    if (!deleted) return comercialError("NOT_FOUND: Queja no encontrada.", 404);
    await deleteStorageFolder(id);
    return comercialJson({ deleted: true, id });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}
