/** Tipos de celda de control (asignaciones por conductor). */
export type ControlSolicitanteCell = {
  solicitante_tm: string | null;
  solicitante_tt: string | null;
  observacion: string | null;
};

export const SOLICITANTE_FILTER_ALL = "__all__";
export const SOLICITANTE_FILTER_EMPTY = "__empty__";

export function emptyControlSolicitanteCell(): ControlSolicitanteCell {
  return { solicitante_tm: null, solicitante_tt: null, observacion: null };
}

/** Etiqueta legible para un id de operador (o cadena vacía). */
export function labelForOperatorId(
  raw: string | null | undefined,
  operatorLabelByValue: Map<string, string>,
): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  return operatorLabelByValue.get(v) ?? v;
}

/** Opciones del filtro «Solicitante»: unión de distincts TM y TT como etiquetas (todas las filas en controlById). */
export function buildSolicitanteFilterOptions(params: {
  controlById: Record<string, ControlSolicitanteCell>;
  operatorLabelByValue: Map<string, string>;
}): { value: string; label: string }[] {
  const set = new Set<string>();
  for (const c of Object.values(params.controlById)) {
    const l1 = labelForOperatorId(c.solicitante_tm, params.operatorLabelByValue);
    if (l1) set.add(l1);
    const l2 = labelForOperatorId(c.solicitante_tt, params.operatorLabelByValue);
    if (l2) set.add(l2);
  }
  return [
    { value: SOLICITANTE_FILTER_ALL, label: "Todos" },
    { value: SOLICITANTE_FILTER_EMPTY, label: "Vacío" },
    ...Array.from(set)
      .sort((a, b) => a.localeCompare(b, "es"))
      .map((s) => ({ value: s, label: s })),
  ];
}

function containsInsensitive(hay: string, needle: string): boolean {
  const h = hay.trim().toLowerCase();
  const n = needle.trim().toLowerCase();
  if (!n) return false;
  return h.includes(n);
}

/** Fila visible si el filtro por solicitante coincide (OR en TM y TT, contiene, sin distinguir mayúsculas). */
export function rowMatchesSolicitanteFilter(params: {
  solicitanteFilter: string;
  cell: ControlSolicitanteCell | undefined;
  operatorLabelByValue: Map<string, string>;
}): boolean {
  const { solicitanteFilter, cell, operatorLabelByValue } = params;
  const ltm = labelForOperatorId(cell?.solicitante_tm, operatorLabelByValue);
  const ltt = labelForOperatorId(cell?.solicitante_tt, operatorLabelByValue);
  const rawTm = String(cell?.solicitante_tm ?? "").trim();
  const rawTt = String(cell?.solicitante_tt ?? "").trim();
  if (solicitanteFilter === SOLICITANTE_FILTER_EMPTY) {
    return !ltm && !ltt && !rawTm && !rawTt;
  }
  if (solicitanteFilter === SOLICITANTE_FILTER_ALL) return true;
  return (
    containsInsensitive(ltm, solicitanteFilter) ||
    containsInsensitive(ltt, solicitanteFilter) ||
    containsInsensitive(rawTm, solicitanteFilter) ||
    containsInsensitive(rawTt, solicitanteFilter)
  );
}
