/** Valor interno del multi-filtro para filas sin semáforo (UI: «Sin semáforo»). */
export const SEMAFORO_MULTI_SIN = "__sin__";

export function isSemaforoEmptyForFilter(raw: string | null | undefined): boolean {
  if (raw === undefined || raw === null) return true;
  const s = String(raw).trim();
  return !s || s === "—" || s === "–" || s === "-";
}

export function rowSemaforoBucket(raw: string | null | undefined): string {
  if (isSemaforoEmptyForFilter(raw)) return SEMAFORO_MULTI_SIN;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower.includes("verde") || lower === "v" || lower === "1") return "verde";
  if (lower.includes("amar")) return "amarillo";
  if (lower.includes("naranj")) return "naranja";
  if (lower.includes("rojo") || lower === "r" || lower === "3") return "rojo";
  return "";
}

export function rowMatchesSemaforoMultiFilter(
  row: { semaforo?: string | null },
  selected: string[],
): boolean {
  if (selected.length === 0) return true;
  const bucket = rowSemaforoBucket(row.semaforo);
  if (
    selected.includes(SEMAFORO_MULTI_SIN) &&
    (bucket === SEMAFORO_MULTI_SIN || isSemaforoEmptyForFilter(row.semaforo))
  ) {
    return true;
  }
  if (bucket === "" || bucket === SEMAFORO_MULTI_SIN) return false;
  return selected.includes(bucket);
}
