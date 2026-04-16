/**
 * Paleta y orden de estados para la vista "Conductores en el tiempo"
 * (matriz y leyenda). Mantener aquí la única fuente de verdad de colores.
 */

export const CONDUCTOR_ESTADO_UI_ORDER = ["Aceptado", "Iniciado", "Esperando", "En Camino"] as const;

export type ConductorEstadoCanonical = (typeof CONDUCTOR_ESTADO_UI_ORDER)[number];

export const CONDUCTOR_ESTADO_COLORS: Record<ConductorEstadoCanonical, string> = {
  Aceptado: "#0e8b66",
  Iniciado: "#2b7be9",
  Esperando: "#ff8a00",
  "En Camino": "#00bfa5",
};

export const CONDUCTOR_ESTADO_FALLBACK_COLOR = "#64748b";

function normalizeEstadoKey(e: string): string {
  return e
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/** Variantes típicas de API → estado canónico de la UI (solo los cuatro prioritarios). */
const ALIAS_TO_CANONICAL: Record<string, ConductorEstadoCanonical> = {
  aceptado: "Aceptado",
  aceptada: "Aceptado",
  iniciado: "Iniciado",
  iniciada: "Iniciado",
  esperando: "Esperando",
  pendiente: "Esperando",
  "en camino": "En Camino",
  encamino: "En Camino",
  "en ruta": "En Camino",
};

export function canonicalConductorEstado(raw: string): ConductorEstadoCanonical | null {
  const k = normalizeEstadoKey(raw);
  return ALIAS_TO_CANONICAL[k] ?? null;
}

export function colorForConductorEstado(raw: string): string {
  const c = canonicalConductorEstado(raw);
  if (c) return CONDUCTOR_ESTADO_COLORS[c];
  return CONDUCTOR_ESTADO_FALLBACK_COLOR;
}

export function rankConductorEstado(raw: string): number {
  const c = canonicalConductorEstado(raw);
  if (!c) return 999;
  return CONDUCTOR_ESTADO_UI_ORDER.indexOf(c);
}

export function compareConductorEstadoStackOrder(a: string, b: string): number {
  const ra = rankConductorEstado(a);
  const rb = rankConductorEstado(b);
  if (ra !== rb) return ra - rb;
  return normalizeEstadoKey(a).localeCompare(normalizeEstadoKey(b), "es");
}

export function sortEstadosForLegend(estados: string[]): string[] {
  const uniq = [...new Set(estados)];
  return uniq.sort((a, b) => {
    const c = compareConductorEstadoStackOrder(a, b);
    if (c !== 0) return c;
    return a.localeCompare(b, "es");
  });
}

/** Orden de apilado en celdas / tooltip: prioridad de estado y a mayor cantidad primero. */
export function sortEstadoEntriesForMatrix(entries: [string, number][]): [string, number][] {
  return [...entries].sort((a, b) => {
    const c = compareConductorEstadoStackOrder(a[0], b[0]);
    if (c !== 0) return c;
    return b[1] - a[1];
  });
}
