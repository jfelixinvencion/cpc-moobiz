import { NextRequest } from "next/server";

import { comercialError, comercialJson } from "@/lib/comercial-api";
import {
  apiStatusFromMessage,
  derivePasajero,
  sanitizeDateRequired,
  sanitizeFuente,
  sanitizeRequiredText,
  validateIdServicio,
} from "@/lib/comercial-quejas";
import { parseComercialQuejasListParams } from "@/lib/comercial-quejas-params";
import type { ComercialQuejaRow } from "@/lib/comercial-quejas-query";
import { runComercialQuejasList } from "@/lib/comercial-quejas-query";
import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import {
  assertQualityReadAccess,
  assertQualityWriteAccess,
  getQualityActorUserId,
} from "@/lib/panel-session";

export const runtime = "nodejs";

const ALLOWED_TURNOS = ["Mañana", "Tarde", "Noche"] as const;
const V31 = "vista.vw_moobiz_31cols_pe";

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

function getJsonField(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (k in obj && obj[k] !== null && obj[k] !== undefined) return obj[k];
  }
  return null;
}

async function syncFromVista(
  pool: ReturnType<typeof getMoobizViewsPool>,
  idServicio: string,
): Promise<{
  estado_servicio: string | null;
  empresa: string | null;
  usuario: string | null;
  invitado: string | null;
  conductor: string | null;
} | null> {
  const { rows } = await pool.query<{ data: Record<string, unknown> | null }>(
    `SELECT row_to_json(t) AS data
     FROM (SELECT * FROM ${V31} WHERE "ID Servicio" = $1 LIMIT 1) t`,
    [idServicio],
  );
  if (!rows[0]?.data) return null;
  const data = rows[0].data;
  const nombreUsuario = getJsonField(data, ["Nombre Usuario", "nombre_usuario"]);
  const apellidoUsuario = getJsonField(data, ["Apellido Usuario", "apellido_usuario"]);
  const usuario =
    [nombreUsuario, apellidoUsuario]
      .filter((v) => v != null)
      .map(String)
      .join(" ")
      .trim() || null;
  const nombreConductor = getJsonField(data, ["Nombre Conductor", "nombre_conductor"]);
  const apellidoConductor = getJsonField(data, ["Apellido Conductor", "apellido_conductor"]);
  const conductor =
    [nombreConductor, apellidoConductor]
      .filter((v) => v != null)
      .map(String)
      .join(" ")
      .trim() || null;
  const estado = getJsonField(data, ["Estado", "estado", "Estado Servicio", "estado_servicio"]);
  return {
    estado_servicio: estado != null ? String(estado) : null,
    empresa:
      getJsonField(data, ["Empresa", "empresa"]) != null
        ? String(getJsonField(data, ["Empresa", "empresa"]))
        : null,
    usuario,
    invitado:
      getJsonField(data, ["Nombre Invitado", "nombre_invitado"]) != null
        ? String(getJsonField(data, ["Nombre Invitado", "nombre_invitado"]))
        : null,
    conductor,
  };
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const parsed = parseComercialQuejasListParams(new URL(request.url).searchParams);
    const pool = getMoobizViewsPool();
    const { rows, total } = await runComercialQuejasList(pool, parsed);
    return comercialJson({ data: rows, total, limit: parsed.limit, offset: parsed.offset });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}

type CreateBody = {
  fecha_queja?: string;
  id_servicio?: string;
  turno?: string;
  categoria?: string;
  descripcion?: string;
  fuente?: string;
  sync?: boolean;
  estado_servicio?: string | null;
  empresa?: string | null;
  usuario?: string | null;
  invitado?: string | null;
  conductor?: string | null;
};

export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const body = (await request.json()) as CreateBody;
    const fecha_queja = sanitizeDateRequired(body.fecha_queja, "fecha_queja");
    const id_servicio = validateIdServicio(body.id_servicio);
    const turno = String(body.turno ?? "").trim();
    const turnoErr = validateTurno(turno);
    if (turnoErr) {
      return comercialJson({ error: turnoErr }, 400);
    }
    const categoria = sanitizeRequiredText(body.categoria, "categoria", 500);
    const descripcion = sanitizeRequiredText(body.descripcion, "descripcion");
    const fuente = sanitizeFuente(body.fuente);

    const pool = getMoobizViewsPool();
    let warning: string | undefined;
    let syncData = {
      estado_servicio: body.estado_servicio ?? null,
      empresa: body.empresa ?? null,
      usuario: body.usuario ?? null,
      invitado: body.invitado ?? null,
      conductor: body.conductor ?? null,
    };

    if (body.sync) {
      const synced = await syncFromVista(pool, id_servicio);
      if (!synced) {
        warning = "ID Servicio no encontrado - Intentar más tarde";
      } else {
        syncData = synced;
      }
    }

    const pasajero = derivePasajero(syncData.invitado, syncData.usuario);
    const created_by = getQualityActorUserId();

    const sql = `
      INSERT INTO comercial.registro_quejas
        (fecha_queja, id_servicio, estado_servicio, empresa, usuario, invitado, pasajero,
         conductor, turno, categoria, descripcion, fuente, estado_registro, respuesta,
         fecha_respuesta, acciones, fotos_revision, created_by)
      VALUES
        ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::date, $16, $17::text[], $18)
      RETURNING *;
    `;

    const params = [
      fecha_queja,
      id_servicio,
      syncData.estado_servicio,
      syncData.empresa,
      syncData.usuario,
      syncData.invitado,
      pasajero,
      syncData.conductor,
      turno,
      categoria,
      descripcion,
      fuente,
      "Pendiente",
      null,
      null,
      null,
      [],
      created_by,
    ];

    const { rows } = await pool.query<Record<string, unknown>>(sql, params);
    if (!rows[0]) {
      console.error("comercial quejas POST: INSERT sin fila RETURNING");
      return comercialError("Error interno al crear queja", 500);
    }

    return comercialJson({
      created: true,
      data: mapReturnedRow(rows[0]),
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    console.error("comercial quejas POST error", error);
    const message = error instanceof Error ? error.message : String(error);
    return comercialError(message, apiStatusFromMessage(message));
  }
}
