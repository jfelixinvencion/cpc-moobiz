import type { Pool } from "pg";

import type {
  FlotaConductoresParsedParams,
  FlotaConductoresSortCol,
} from "./flota-conductores-params";

/** Materialized view de conductores (identificador sin comillas → `mv_conductores`). */
const CONDUCTORES_MV = "reportes.mv_conductores";
const SEMAFORO_MV = "reportes.semaforo";

const GLOBAL_EXPR = `CASE
  WHEN upper(trim(coalesce(d.sucursal, ''))) = 'LIMA' THEN 'LIMA'
  ELSE 'PROVINCIA'
END`;

const NOMBRE_EXPR = `trim(concat_ws(' ', nullif(trim(d.name), ''), nullif(trim(d.surname), '')))`;

const DATOS_VENCIMIENTO_EXPR = `CASE
  WHEN coalesce(nullif(trim(d.vencimiento_brevete::text), ''), '') <> ''
   AND coalesce(nullif(trim(d.vencimiento_revision_tecnica::text), ''), '') <> ''
   AND coalesce(nullif(trim(d.vencimiento_soat::text), ''), '') <> ''
  THEN 'Completo'
  ELSE 'Pendiente'
END`;

const DATOS_FACTURACION_EXPR = `CASE
  WHEN coalesce(nullif(trim(d.tipo_contribuyente::text), ''), '') = '' THEN 'Pendiente Tp Contribuyente'
  WHEN coalesce(nullif(trim(d.marcar_si_moobiz_realiza_su_contabilidad::text), ''), '') = ''
    THEN 'Pendiente Check Facturacion'
  WHEN trim(d.marcar_si_moobiz_realiza_su_contabilidad::text) = '1'
   AND (
     coalesce(nullif(trim(d.numero_ruc_factura::text), ''), '') = ''
     OR coalesce(nullif(trim(d.usuario_sunat::text), ''), '') = ''
     OR coalesce(nullif(trim(d.clave_sol_sunat::text), ''), '') = ''
   ) THEN 'Pendiente datos facturacion'
  WHEN trim(d.marcar_si_moobiz_realiza_su_contabilidad::text) = '1'
   AND coalesce(nullif(trim(d.numero_ruc_factura::text), ''), '') <> ''
   AND coalesce(nullif(trim(d.usuario_sunat::text), ''), '') <> ''
   AND coalesce(nullif(trim(d.clave_sol_sunat::text), ''), '') <> ''
  THEN 'Completo'
  WHEN trim(d.marcar_si_moobiz_realiza_su_contabilidad::text) = '0' THEN 'Completo'
  ELSE 'Pendiente'
END`;

export type FlotaConductorRow = {
  idConductor: string;
  nombreConductor: string;
  sucursal: string;
  distrito: string;
  turno: string;
  fechaActivacion: string | null;
  nServicios: number;
};

export type FlotaConductoresMeta = {
  semanaOptions: string[];
  defaultSemana: string | null;
  globalOptions: string[];
  estadoOptions: string[];
  datosVencimientoOptions: string[];
  datosFacturacionOptions: string[];
  distritoOptions: string[];
  nameOptions: { value: string; label: string }[];
};

type FilterSql = { sql: string; params: unknown[] };

function addArrayFilter(
  parts: string[],
  params: unknown[],
  col: string,
  values: string[] | null,
): void {
  if (values == null) return;
  params.push(values);
  parts.push(`($${params.length}::text[] IS NULL OR ${col} = ANY($${params.length}::text[]))`);
}

function buildDriverWhere(parsed: FlotaConductoresParsedParams): FilterSql {
  const params: unknown[] = [];
  const parts: string[] = ["TRUE"];

  addArrayFilter(parts, params, "d.global_val", parsed.selectedGlobal);
  addArrayFilter(parts, params, "d.state", parsed.selectedEstado);
  addArrayFilter(parts, params, "d.datos_vencimiento", parsed.selectedDatosVenc);
  addArrayFilter(parts, params, "d.datos_facturacion", parsed.selectedDatosFact);
  addArrayFilter(parts, params, "d.en_que_distrito_vive", parsed.selectedDistritos);

  if (parsed.distritoText) {
    params.push(`%${parsed.distritoText}%`);
    parts.push(`d.en_que_distrito_vive ILIKE $${params.length}`);
  }

  if (parsed.selectedNameId) {
    params.push(parsed.selectedNameId);
    const idx = params.length;
    parts.push(
      `(trim(d.id::text) = $${idx} OR d.nombre_completo = $${idx})`,
    );
  }

  return { sql: parts.join("\n  AND "), params };
}

function buildWeekFilter(parsed: FlotaConductoresParsedParams, params: unknown[]): string {
  if (parsed.selectedWeeks == null) return "TRUE";
  params.push(parsed.selectedWeeks);
  return `s."Semana" = ANY($${params.length}::text[])`;
}

function orderClause(sortCol: FlotaConductoresSortCol, sortDir: "asc" | "desc"): string {
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  if (sortCol === "distrito") {
    return `d.en_que_distrito_vive ${dir} NULLS LAST, COALESCE(s.n_servicios_total, 0) DESC`;
  }
  return `COALESCE(s.n_servicios_total, 0) ${dir}, d.en_que_distrito_vive ASC NULLS LAST`;
}

const CONDUCTORES_BASE_FROM = `
  SELECT
    d.id,
    d.name,
    d.surname,
    d.sucursal,
    d.en_que_distrito_vive,
    d.turno,
    d.fecha_activacion,
    d.state,
    ${GLOBAL_EXPR} AS global_val,
    ${NOMBRE_EXPR} AS nombre_completo,
    ${DATOS_VENCIMIENTO_EXPR} AS datos_vencimiento,
    ${DATOS_FACTURACION_EXPR} AS datos_facturacion
  FROM ${CONDUCTORES_MV} d
`;

export async function runFlotaConductoresMeta(pool: Pool): Promise<FlotaConductoresMeta> {
  const [
    semanasRes,
    globalRes,
    estadoRes,
    vencRes,
    factRes,
    distritoRes,
    namesRes,
  ] = await Promise.all([
    pool.query<{ semana: string }>(
      `SELECT DISTINCT "Semana" AS semana
       FROM ${SEMAFORO_MV}
       WHERE "Semana" IS NOT NULL AND trim("Semana"::text) <> ''
       ORDER BY "Semana" DESC`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT ${GLOBAL_EXPR} AS v
       FROM ${CONDUCTORES_MV} d
       WHERE d.sucursal IS NOT NULL AND trim(d.sucursal::text) <> ''
       ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT d.state AS v
       FROM ${CONDUCTORES_MV} d
       WHERE d.state IS NOT NULL AND trim(d.state::text) <> ''
       ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT datos_vencimiento AS v
       FROM (${CONDUCTORES_BASE_FROM}) base
       WHERE datos_vencimiento IS NOT NULL AND trim(datos_vencimiento::text) <> ''
       ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT datos_facturacion AS v
       FROM (${CONDUCTORES_BASE_FROM}) base
       WHERE datos_facturacion IS NOT NULL AND trim(datos_facturacion::text) <> ''
       ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT d.en_que_distrito_vive AS v
       FROM ${CONDUCTORES_MV} d
       WHERE d.en_que_distrito_vive IS NOT NULL AND trim(d.en_que_distrito_vive::text) <> ''
       ORDER BY 1`,
    ),
    pool.query<{ value: string; label: string }>(
      `SELECT trim(d.id::text) AS value,
              trim(d.id::text) || ' - ' || ${NOMBRE_EXPR} AS label
       FROM ${CONDUCTORES_MV} d
       WHERE d.id IS NOT NULL AND trim(d.id::text) <> ''
       ORDER BY ${NOMBRE_EXPR}
       LIMIT 1000`,
    ),
  ]);

  const semanaOptions = semanasRes.rows.map((r) => String(r.semana ?? "").trim()).filter(Boolean);

  return {
    semanaOptions,
    defaultSemana: semanaOptions[0] ?? null,
    globalOptions: globalRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
    estadoOptions: estadoRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
    datosVencimientoOptions: vencRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
    datosFacturacionOptions: factRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
    distritoOptions: distritoRes.rows.map((r) => String(r.v ?? "").trim()).filter(Boolean),
    nameOptions: namesRes.rows
      .map((r) => ({
        value: String(r.value ?? "").trim(),
        label: String(r.label ?? "").trim(),
      }))
      .filter((r) => r.value && r.label),
  };
}

export async function runFlotaConductoresRows(
  pool: Pool,
  parsed: FlotaConductoresParsedParams,
): Promise<{ rows: FlotaConductorRow[]; total: number }> {
  const { sql: whereSql, params: whereParams } = buildDriverWhere(parsed);
  const servParams = [...whereParams];
  const weekSql = buildWeekFilter(parsed, servParams);

  const limitIdx = servParams.length + 1;
  const offsetIdx = servParams.length + 2;
  const queryParams = [...servParams, parsed.limit, parsed.offset];

  const orderSql = orderClause(parsed.sortCol, parsed.sortDir);

  const q = `
WITH servicios_por_conductor AS (
  SELECT
    trim(s."ID Conductor"::text) AS id_conductor,
    COALESCE(sum(s."N_Reservas"), 0)::bigint AS n_servicios_total
  FROM ${SEMAFORO_MV} s
  WHERE ${weekSql}
    AND s."ID Conductor" IS NOT NULL
    AND trim(s."ID Conductor"::text) <> ''
  GROUP BY trim(s."ID Conductor"::text)
),
conductores AS (
  SELECT DISTINCT ON (trim(c.id::text))
    c.*
  FROM (${CONDUCTORES_BASE_FROM}) c
  WHERE c.id IS NOT NULL AND trim(c.id::text) <> ''
  ORDER BY trim(c.id::text), c.nombre_completo NULLS LAST
)
SELECT
  trim(d.id::text) AS id_conductor,
  d.nombre_completo AS nombre_conductor,
  d.sucursal AS sucursal,
  d.en_que_distrito_vive AS distrito,
  d.turno AS turno,
  d.fecha_activacion AS fecha_activacion,
  COALESCE(s.n_servicios_total, 0)::int AS n_servicios,
  COUNT(*) OVER()::int AS total_count
FROM conductores d
LEFT JOIN servicios_por_conductor s
  ON s.id_conductor = trim(d.id::text)
WHERE ${whereSql}
ORDER BY ${orderSql}
LIMIT $${limitIdx} OFFSET $${offsetIdx}
`;

  const { rows } = await pool.query<{
    id_conductor: string;
    nombre_conductor: string;
    sucursal: string | null;
    distrito: string | null;
    turno: string | null;
    fecha_activacion: string | null;
    n_servicios: number;
    total_count: number;
  }>(q, queryParams);

  const total = rows[0]?.total_count ?? 0;

  return {
    rows: rows.map((r) => ({
      idConductor: String(r.id_conductor ?? ""),
      nombreConductor: String(r.nombre_conductor ?? ""),
      sucursal: String(r.sucursal ?? ""),
      distrito: String(r.distrito ?? ""),
      turno: String(r.turno ?? ""),
      fechaActivacion:
        r.fecha_activacion === null || r.fecha_activacion === undefined
          ? null
          : String(r.fecha_activacion).trim() || null,
      nServicios: Number(r.n_servicios) || 0,
    })),
    total,
  };
}
