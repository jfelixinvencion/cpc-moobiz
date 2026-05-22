import type { Pool } from "pg";

import {
  SOLICITANTE_FILTER_ALL,
  SOLICITANTE_FILTER_EMPTY,
} from "@/lib/control-operaciones-solicitante-tm-tt";

export const SOLICITANTE_API_TODOS = "Todos";
export const SOLICITANTE_API_VACIOS = "VACÍOS";

const UNION_DISTINCT_SQL = `
  SELECT DISTINCT valor
  FROM (
    SELECT NULLIF(trim("Solicitante TM"), '') AS valor, "Semana"
    FROM vista.vw_moobiz_31cols_pe
    UNION ALL
    SELECT NULLIF(trim("Solicitante TT"), '') AS valor, "Semana"
    FROM vista.vw_moobiz_31cols_pe
  ) t
  WHERE valor IS NOT NULL
    AND ($1::text IS NULL OR t."Semana" = $1)
  ORDER BY valor
`;

/** Patrones ILIKE '%valor%' escapando % y _ literales. */
export function ilikeContainsPatterns(values: string[]): string[] {
  return values.map((raw) => {
    const s = String(raw ?? "").trim();
    const escaped = s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
    return `%${escaped}%`;
  });
}

export function normalizeSolicitanteFilterParams(params: string[]): string[] {
  return params
    .map((p) => p.trim())
    .filter((p) => p && p !== SOLICITANTE_FILTER_ALL && p !== SOLICITANTE_API_TODOS);
}

export async function fetchSolicitanteFilterOptionsFromV31(
  pool: Pool,
  week: string | null,
): Promise<string[]> {
  const weekParam = week?.trim() || null;
  const { rows } = await pool.query<{ valor: string }>(UNION_DISTINCT_SQL, [weekParam]);
  const values = rows
    .map((r) => (typeof r.valor === "string" ? r.valor.trim() : ""))
    .filter(Boolean);
  return [SOLICITANTE_API_TODOS, SOLICITANTE_API_VACIOS, ...values];
}

/** IDs de conductor en vw_moobiz_31cols_pe que cumplen el filtro de solicitante para la semana. */
export async function fetchDriverIdsMatchingSolicitanteV31(
  pool: Pool,
  week: string,
  solicitanteParams: string[],
): Promise<Set<string>> {
  const weekTrim = week.trim();
  const params = normalizeSolicitanteFilterParams(solicitanteParams);
  if (params.length === 0) return new Set();

  const onlyEmpty =
    params.length === 1 &&
    (params[0] === SOLICITANTE_FILTER_EMPTY || params[0].toUpperCase() === SOLICITANTE_API_VACIOS);

  if (onlyEmpty) {
    const sql = `
      SELECT DISTINCT trim("ID Conductor"::text) AS id_conductor
      FROM vista.vw_moobiz_31cols_pe
      WHERE "Semana" = $1
        AND trim(coalesce("ID Conductor"::text, '')) <> ''
        AND trim("ID Conductor"::text) NOT IN (
          SELECT DISTINCT trim("ID Conductor"::text)
          FROM vista.vw_moobiz_31cols_pe
          WHERE "Semana" = $1
            AND (
              NULLIF(trim("Solicitante TM"), '') IS NOT NULL
              OR NULLIF(trim("Solicitante TT"), '') IS NOT NULL
            )
        )
    `;
    const { rows } = await pool.query<{ id_conductor: string }>(sql, [weekTrim]);
    return new Set(rows.map((r) => String(r.id_conductor ?? "").trim()).filter(Boolean));
  }

  const labels = params.filter(
    (p) => p !== SOLICITANTE_FILTER_EMPTY && p.toUpperCase() !== SOLICITANTE_API_VACIOS,
  );
  if (labels.length === 0) return new Set();

  const patterns = ilikeContainsPatterns(labels);
  const sql = `
    SELECT DISTINCT trim("ID Conductor"::text) AS id_conductor
    FROM vista.vw_moobiz_31cols_pe
    WHERE "Semana" = $1
      AND trim(coalesce("ID Conductor"::text, '')) <> ''
      AND (
        COALESCE("Solicitante TM", '') ILIKE ANY ($2::text[])
        OR COALESCE("Solicitante TT", '') ILIKE ANY ($2::text[])
      )
  `;
  const { rows } = await pool.query<{ id_conductor: string }>(sql, [weekTrim, patterns]);
  return new Set(rows.map((r) => String(r.id_conductor ?? "").trim()).filter(Boolean));
}

export function apiSolicitanteValuesToSelectOptions(
  data: string[],
): { value: string; label: string }[] {
  const out: { value: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const raw of data) {
    const s = String(raw ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    if (s === SOLICITANTE_API_TODOS) {
      out.push({ value: SOLICITANTE_FILTER_ALL, label: SOLICITANTE_API_TODOS });
      continue;
    }
    if (s.toUpperCase() === SOLICITANTE_API_VACIOS) {
      out.push({ value: SOLICITANTE_FILTER_EMPTY, label: SOLICITANTE_API_VACIOS });
      continue;
    }
    out.push({ value: s, label: s });
  }
  if (!out.some((o) => o.value === SOLICITANTE_FILTER_ALL)) {
    out.unshift({ value: SOLICITANTE_FILTER_ALL, label: SOLICITANTE_API_TODOS });
  }
  return out;
}
