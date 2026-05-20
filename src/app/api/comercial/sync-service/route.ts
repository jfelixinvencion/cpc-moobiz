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

/** Normaliza nombre de columna: sin acentos, minúsculas, solo alfanumérico. */
function normalizeColumnKey(key: string): string {
  return key
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function getFieldNormalized(
  obj: Record<string, unknown>,
  exactCandidates: string[],
  normalizedTargets: string[],
): unknown {
  const exact = getField(obj, exactCandidates);
  if (exact !== null && exact !== undefined) return exact;

  const targetSet = new Set(normalizedTargets.map(normalizeColumnKey));
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) continue;
    if (targetSet.has(normalizeColumnKey(key))) return value;
  }
  return null;
}

function resolveEstado(data: Record<string, unknown>): string | null {
  const fromCandidates = asString(
    getField(data, [
      "Estado",
      "estado",
      "Estado Servicio",
      "estado_servicio",
      "ESTADO",
      "Estado del Servicio",
      "Status",
      "status",
    ]),
  );
  if (fromCandidates) return fromCandidates;

  const fromNormalized = asString(
    getFieldNormalized(data, [], ["estado", "estadoservicio", "estadodelservicio", "status"]),
  );
  if (fromNormalized) return fromNormalized;

  for (const [key, value] of Object.entries(data)) {
    if (value === null || value === undefined) continue;
    const nk = normalizeColumnKey(key);
    if (nk.includes("estado") && !nk.includes("conductor") && !nk.includes("usuario")) {
      const s = asString(value);
      if (s) return s;
    }
  }

  return null;
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

    const estado = resolveEstado(data);
    const empresa = asString(
      getFieldNormalized(data, ["Empresa", "empresa"], ["empresa"]),
    );
    const nombreUsuario = getFieldNormalized(
      data,
      ["Nombre Usuario", "nombre_usuario", "Nombre_Usuario"],
      ["nombreusuario"],
    );
    const apellidoUsuario = getFieldNormalized(
      data,
      ["Apellido Usuario", "apellido_usuario", "Apellido_Usuario"],
      ["apellidousuario"],
    );
    const usuario =
      [nombreUsuario, apellidoUsuario]
        .filter((v) => v !== null && v !== undefined)
        .map(String)
        .join(" ")
        .trim() || null;
    const invitado = asString(
      getFieldNormalized(
        data,
        ["Nombre Invitado", "nombre_invitado", "Nombre_Invitado"],
        ["nombreinvitado"],
      ),
    );
    const nombreConductor = getFieldNormalized(
      data,
      ["Nombre Conductor", "nombre_conductor", "Nombre_Conductor"],
      ["nombreconductor"],
    );
    const apellidoConductor = getFieldNormalized(
      data,
      ["Apellido Conductor", "apellido_conductor", "Apellido_Conductor"],
      ["apellidoconductor"],
    );
    const conductor =
      [nombreConductor, apellidoConductor]
        .filter((v) => v !== null && v !== undefined)
        .map(String)
        .join(" ")
        .trim() || null;
    const turno = asString(
      getFieldNormalized(data, ["Turno", "turno", "TURNO"], ["turno"]),
    );

    return NextResponse.json({
      estado,
      estado_servicio: estado,
      empresa,
      usuario,
      invitado,
      conductor,
      turno,
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
