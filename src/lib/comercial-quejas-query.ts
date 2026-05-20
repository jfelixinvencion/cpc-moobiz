import type { Pool } from "pg";

import type { ComercialQuejasListParams } from "./comercial-quejas-params";
import { derivePasajero } from "./comercial-quejas";

const TABLE = "comercial.registro_quejas";
const V31 = "vista.vw_moobiz_31cols_pe";

export type ComercialQuejaRow = {
  id: number;
  fecha_queja: string;
  id_servicio: string;
  estado_servicio: string | null;
  empresa: string | null;
  usuario: string | null;
  invitado: string | null;
  pasajero: string | null;
  conductor: string | null;
  turno: string | null;
  categoria: string | null;
  descripcion: string | null;
  fuente: string | null;
  estado_registro: string;
  respuesta: string | null;
  fecha_respuesta: string | null;
  acciones: string | null;
  fotos_revision: string[];
  created_by: string | null;
  created_at: string;
};

export type ComercialSyncRow = {
  estado_servicio: string | null;
  empresa: string | null;
  usuario: string | null;
  invitado: string | null;
  conductor: string | null;
  turno: string | null;
};

export type CreateQuejaInput = {
  fecha_queja: string;
  id_servicio: string;
  turno: string;
  categoria: string;
  descripcion: string;
  fuente: string;
  estado_servicio?: string | null;
  empresa?: string | null;
  usuario?: string | null;
  invitado?: string | null;
  conductor?: string | null;
  created_by: string;
};

export type UpdateQuejaInput = {
  turno?: string;
  categoria?: string;
  descripcion?: string;
  fuente?: string;
  respuesta?: string | null;
  fecha_respuesta?: string | null;
  acciones?: string | null;
  fotos_revision?: string[];
  estado_registro?: string;
};

export type ReviewQuejaInput = {
  respuesta: string | null;
  fecha_respuesta: string | null;
  acciones: string | null;
  fotos_urls: string[];
  estado_registro: string;
};

function mapRow(r: Record<string, unknown>): ComercialQuejaRow {
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

function buildListWhere(parsed: ComercialQuejasListParams): {
  sql: string;
  params: unknown[];
} {
  const parts: string[] = ["TRUE"];
  const params: unknown[] = [];

  if (parsed.idServicio) {
    params.push(parsed.idServicio);
    parts.push(`id_servicio = $${params.length}`);
  }
  if (parsed.estadoRegistro) {
    params.push(parsed.estadoRegistro);
    parts.push(`estado_registro = $${params.length}`);
  }
  if (parsed.fechaFrom) {
    params.push(parsed.fechaFrom);
    parts.push(`fecha_queja >= $${params.length}::date`);
  }
  if (parsed.fechaTo) {
    params.push(parsed.fechaTo);
    parts.push(`fecha_queja <= $${params.length}::date`);
  }
  if (parsed.search) {
    params.push(`%${parsed.search}%`);
    const idx = params.length;
    parts.push(`(
      id_servicio ILIKE $${idx}
      OR empresa ILIKE $${idx}
      OR usuario ILIKE $${idx}
      OR pasajero ILIKE $${idx}
      OR conductor ILIKE $${idx}
      OR categoria ILIKE $${idx}
      OR descripcion ILIKE $${idx}
      OR CAST(id AS text) ILIKE $${idx}
    )`);
  }

  return { sql: parts.join(" AND "), params };
}

function orderClause(sortCol: ComercialQuejasListParams["sortCol"], sortDir: "asc" | "desc"): string {
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  if (sortCol === "fecha_queja") {
    return `fecha_queja ${dir} NULLS LAST, created_at DESC`;
  }
  return `created_at ${dir}, id DESC`;
}

const SELECT_COLS = `
  id, fecha_queja, id_servicio, estado_servicio, empresa, usuario, invitado,
  pasajero, conductor, turno, categoria, descripcion, fuente, estado_registro,
  respuesta, fecha_respuesta, acciones, fotos_revision, created_by, created_at
`;

export async function runComercialSyncService(
  pool: Pool,
  idServicio: string,
): Promise<ComercialSyncRow | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT
      "Estado" AS estado_servicio,
      "Empresa" AS empresa,
      trim(COALESCE("Nombre Usuario", '') || ' ' || COALESCE("Apellido Usuario", '')) AS usuario,
      "Nombre Invitado" AS invitado,
      trim(COALESCE("Nombre Conductor", '') || ' ' || COALESCE("Apellido Conductor", '')) AS conductor,
      "Turno" AS turno
    FROM ${V31}
    WHERE "ID Servicio" = $1
    LIMIT 1`,
    [idServicio],
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    estado_servicio: r.estado_servicio != null ? String(r.estado_servicio) : null,
    empresa: r.empresa != null ? String(r.empresa) : null,
    usuario: r.usuario != null ? String(r.usuario).trim() || null : null,
    invitado: r.invitado != null ? String(r.invitado) : null,
    conductor: r.conductor != null ? String(r.conductor).trim() || null : null,
    turno: r.turno != null ? String(r.turno) : null,
  };
}

export async function runComercialQuejasList(
  pool: Pool,
  parsed: ComercialQuejasListParams,
): Promise<{ rows: ComercialQuejaRow[]; total: number }> {
  const { sql: whereSql, params } = buildListWhere(parsed);
  const order = orderClause(parsed.sortCol, parsed.sortDir);
  params.push(parsed.limit, parsed.offset);
  const limitIdx = params.length - 1;
  const offsetIdx = params.length;

  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${SELECT_COLS},
            COUNT(*) OVER()::int AS total_count
     FROM ${TABLE}
     WHERE ${whereSql}
     ORDER BY ${order}
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const total = rows.length > 0 ? Number(rows[0].total_count ?? 0) : 0;
  return { rows: rows.map(mapRow), total };
}

export async function runComercialQuejaById(
  pool: Pool,
  id: number,
): Promise<ComercialQuejaRow | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `SELECT ${SELECT_COLS} FROM ${TABLE} WHERE id = $1`,
    [id],
  );
  if (!rows[0]) return null;
  return mapRow(rows[0]);
}

export async function runComercialQuejaCreate(
  pool: Pool,
  input: CreateQuejaInput,
): Promise<ComercialQuejaRow> {
  const pasajero = derivePasajero(input.invitado ?? null, input.usuario ?? null);
  const { rows } = await pool.query<Record<string, unknown>>(
    `INSERT INTO ${TABLE} (
      fecha_queja, id_servicio, estado_servicio, empresa, usuario, invitado,
      pasajero, conductor, turno, categoria, descripcion, fuente, created_by
    ) VALUES (
      $1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
    )
    RETURNING ${SELECT_COLS}`,
    [
      input.fecha_queja,
      input.id_servicio,
      input.estado_servicio ?? null,
      input.empresa ?? null,
      input.usuario ?? null,
      input.invitado ?? null,
      pasajero,
      input.conductor ?? null,
      input.turno,
      input.categoria,
      input.descripcion,
      input.fuente,
      input.created_by,
    ],
  );
  return mapRow(rows[0]);
}

export async function runComercialQuejaUpdate(
  pool: Pool,
  id: number,
  input: UpdateQuejaInput,
): Promise<ComercialQuejaRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [];

  const add = (col: string, val: unknown) => {
    params.push(val);
    sets.push(`${col} = $${params.length}`);
  };

  if (input.turno !== undefined) add("turno", input.turno);
  if (input.categoria !== undefined) add("categoria", input.categoria);
  if (input.descripcion !== undefined) add("descripcion", input.descripcion);
  if (input.fuente !== undefined) add("fuente", input.fuente);
  if (input.respuesta !== undefined) add("respuesta", input.respuesta);
  if (input.fecha_respuesta !== undefined) {
    params.push(input.fecha_respuesta);
    sets.push(`fecha_respuesta = $${params.length}::date`);
  }
  if (input.acciones !== undefined) add("acciones", input.acciones);
  if (input.fotos_revision !== undefined) {
    params.push(input.fotos_revision);
    sets.push(`fotos_revision = $${params.length}::text[]`);
  }
  if (input.estado_registro !== undefined) add("estado_registro", input.estado_registro);

  if (sets.length === 0) return runComercialQuejaById(pool, id);

  params.push(id);
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE ${TABLE} SET ${sets.join(", ")} WHERE id = $${params.length}
     RETURNING ${SELECT_COLS}`,
    params,
  );
  if (!rows[0]) return null;
  return mapRow(rows[0]);
}

export async function runComercialQuejaReview(
  pool: Pool,
  id: number,
  input: ReviewQuejaInput,
): Promise<ComercialQuejaRow | null> {
  const { rows } = await pool.query<Record<string, unknown>>(
    `UPDATE ${TABLE}
     SET respuesta = $2,
         fecha_respuesta = $3::date,
         acciones = $4,
         fotos_revision = COALESCE(fotos_revision, ARRAY[]::text[]) || $5::text[],
         estado_registro = $6
     WHERE id = $1
     RETURNING ${SELECT_COLS}`,
    [
      id,
      input.respuesta,
      input.fecha_respuesta,
      input.acciones,
      input.fotos_urls,
      input.estado_registro,
    ],
  );
  if (!rows[0]) return null;
  return mapRow(rows[0]);
}

export async function runComercialQuejaDelete(pool: Pool, id: number): Promise<boolean> {
  const { rowCount } = await pool.query(`DELETE FROM ${TABLE} WHERE id = $1`, [id]);
  return (rowCount ?? 0) > 0;
}
