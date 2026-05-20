import { NextRequest, NextResponse } from "next/server";

import { getMoobizViewsPool } from "@/lib/pg-moobiz-dashboard-pool";
import { assertQualityReadAccess } from "@/lib/panel-session";

export const runtime = "nodejs";

function getField(obj: Record<string, unknown>, candidates: string[]): unknown {
  for (const k of candidates) {
    if (k in obj && obj[k] !== null && obj[k] !== undefined) return obj[k];
  }
  return null;
}

function asString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s || null;
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const url = new URL(request.url);
    const id_servicio = (
      url.searchParams.get("id_servicio") ||
      url.searchParams.get("id") ||
      ""
    ).trim();

    if (!/^\d{7}$/.test(id_servicio)) {
      return NextResponse.json(
        { error: "ID Servicio inválido. Debe ser exactamente 7 dígitos." },
        { status: 400 },
      );
    }

    const pool = getMoobizViewsPool();
    const sql = `
      SELECT row_to_json(t) AS data
      FROM (
        SELECT *
        FROM vista.vw_moobiz_31cols_pe
        WHERE "ID Servicio" = $1
        LIMIT 1
      ) t;
    `;

    const { rows } = await pool.query<{ data: Record<string, unknown> | null }>(sql, [
      id_servicio,
    ]);

    if (!rows?.length || !rows[0]?.data) {
      return NextResponse.json(
        { error: "ID Servicio no encontrado - Intentar más tarde" },
        { status: 404 },
      );
    }

    const data = rows[0].data;

    const estado = getField(data, ["Estado", "estado", "Estado Servicio", "estado_servicio"]);
    const empresa = getField(data, ["Empresa", "empresa"]);
    const nombreUsuario = getField(data, [
      "Nombre Usuario",
      "nombre_usuario",
      "Nombre_Usuario",
    ]);
    const apellidoUsuario = getField(data, [
      "Apellido Usuario",
      "apellido_usuario",
      "Apellido_Usuario",
    ]);
    const usuario =
      [nombreUsuario, apellidoUsuario]
        .filter((v) => v !== null && v !== undefined)
        .map(String)
        .join(" ")
        .trim() || null;
    const invitado = getField(data, ["Nombre Invitado", "nombre_invitado", "Nombre_Invitado"]);
    const nombreConductor = getField(data, [
      "Nombre Conductor",
      "nombre_conductor",
      "Nombre_Conductor",
    ]);
    const apellidoConductor = getField(data, [
      "Apellido Conductor",
      "apellido_conductor",
      "Apellido_Conductor",
    ]);
    const conductor =
      [nombreConductor, apellidoConductor]
        .filter((v) => v !== null && v !== undefined)
        .map(String)
        .join(" ")
        .trim() || null;
    const turno = getField(data, ["Turno", "turno", "TURNO"]);

    return NextResponse.json({
      estado: asString(estado),
      empresa: asString(empresa),
      usuario,
      invitado: asString(invitado),
      conductor,
      turno: asString(turno),
      raw: data,
    });
  } catch (err) {
    console.error("sync-service error", err);
    return NextResponse.json(
      { error: "Error interno al buscar servicio" },
      { status: 500 },
    );
  }
}
