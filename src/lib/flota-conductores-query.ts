import type { Pool } from "pg";

import type {
  FlotaConductoresParsedParams,
  FlotaConductoresSortCol,
} from "./flota-conductores-params";

const DRIVERS_MV = "reportes.mv_vw_moobiz_drivers_excel";
const LIQ_MV = "reportes.liquidaciones_conductores_resumen_mv";

export type FlotaConductorRow = {
  idConductor: string;
  nombreConductor: string;
  sucursal: string;
  distrito: string;
  turno: string;
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

  addArrayFilter(parts, params, 'd."GLOBAL"', parsed.selectedGlobal);
  addArrayFilter(parts, params, 'd."Estado Conductor"', parsed.selectedEstado);
  addArrayFilter(parts, params, 'd."Datos Vencimiento"', parsed.selectedDatosVenc);
  addArrayFilter(parts, params, 'd."Datos Facturacion"', parsed.selectedDatosFact);
  addArrayFilter(parts, params, 'd."En que distrito vive"', parsed.selectedDistritos);

  if (parsed.distritoText) {
    params.push(`%${parsed.distritoText}%`);
    parts.push(`d."En que distrito vive" ILIKE $${params.length}`);
  }

  if (parsed.selectedNameId) {
    params.push(parsed.selectedNameId);
    const idx = params.length;
    parts.push(
      `(d."ID Conductor"::text = $${idx} OR d."Nombre Conductor" = $${idx})`,
    );
  }

  return { sql: parts.join("\n  AND "), params };
}

function buildWeekFilter(parsed: FlotaConductoresParsedParams, params: unknown[]): string {
  if (parsed.selectedWeeks == null) return "TRUE";
  params.push(parsed.selectedWeeks);
  return `l.semana_label = ANY($${params.length}::text[])`;
}

function orderClause(sortCol: FlotaConductoresSortCol, sortDir: "asc" | "desc"): string {
  const dir = sortDir === "asc" ? "ASC" : "DESC";
  if (sortCol === "distrito") {
    return `d."En que distrito vive" ${dir} NULLS LAST, COALESCE(s.n_servicios_total, 0) DESC`;
  }
  return `COALESCE(s.n_servicios_total, 0) ${dir}, d."En que distrito vive" ASC NULLS LAST`;
}

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
    pool.query<{ semana_label: string }>(
      `SELECT DISTINCT semana_label FROM ${LIQ_MV} WHERE semana_label IS NOT NULL AND trim(semana_label::text) <> '' ORDER BY semana_label DESC`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT "GLOBAL" AS v FROM ${DRIVERS_MV} WHERE "GLOBAL" IS NOT NULL AND trim("GLOBAL"::text) <> '' ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT "Estado Conductor" AS v FROM ${DRIVERS_MV} WHERE "Estado Conductor" IS NOT NULL AND trim("Estado Conductor"::text) <> '' ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT "Datos Vencimiento" AS v FROM ${DRIVERS_MV} WHERE "Datos Vencimiento" IS NOT NULL AND trim("Datos Vencimiento"::text) <> '' ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT "Datos Facturacion" AS v FROM ${DRIVERS_MV} WHERE "Datos Facturacion" IS NOT NULL AND trim("Datos Facturacion"::text) <> '' ORDER BY 1`,
    ),
    pool.query<{ v: string }>(
      `SELECT DISTINCT "En que distrito vive" AS v FROM ${DRIVERS_MV} WHERE "En que distrito vive" IS NOT NULL AND trim("En que distrito vive"::text) <> '' ORDER BY 1`,
    ),
    pool.query<{ value: string; label: string }>(
      `SELECT ("ID Conductor")::text AS value,
              ("ID Conductor")::text || ' - ' || "Nombre Conductor" AS label
       FROM ${DRIVERS_MV}
       WHERE "ID Conductor" IS NOT NULL
       ORDER BY "Nombre Conductor"
       LIMIT 1000`,
    ),
  ]);

  const semanaOptions = semanasRes.rows.map((r) => String(r.semana_label ?? "").trim()).filter(Boolean);

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
    trim(l.id_conductor::text) AS id_conductor,
    COALESCE(sum(l.n_servicios), 0)::bigint AS n_servicios_total
  FROM ${LIQ_MV} l
  WHERE ${weekSql}
    AND l.id_conductor IS NOT NULL
    AND trim(l.id_conductor::text) <> ''
  GROUP BY trim(l.id_conductor::text)
),
conductores AS (
  SELECT DISTINCT ON (trim(d."ID Conductor"::text))
    d.*
  FROM ${DRIVERS_MV} d
  WHERE d."ID Conductor" IS NOT NULL
    AND trim(d."ID Conductor"::text) <> ''
  ORDER BY trim(d."ID Conductor"::text), d."Nombre Conductor" NULLS LAST
)
SELECT
  trim(d."ID Conductor"::text) AS id_conductor,
  d."Nombre Conductor" AS nombre_conductor,
  d."Sucursal" AS sucursal,
  d."En que distrito vive" AS distrito,
  d."Turno" AS turno,
  COALESCE(s.n_servicios_total, 0)::int AS n_servicios,
  COUNT(*) OVER()::int AS total_count
FROM conductores d
LEFT JOIN servicios_por_conductor s
  ON s.id_conductor = trim(d."ID Conductor"::text)
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
      nServicios: Number(r.n_servicios) || 0,
    })),
    total,
  };
}
