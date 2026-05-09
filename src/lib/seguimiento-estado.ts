/**
 * Paleta y orden de estados para la vista "Seguimiento operaciones"
 * (matriz y leyenda) basada en `vista.moobiz_services_maestra.state_color_name`.
 *
 * IMPORTANTE: el match es ESTRICTAMENTE case-sensitive contra los strings
 * que devuelve el SQL. Respetar capitalización tal cual:
 *   "Aceptado", "Iniciado", "Esperando", "En camino" (c minúscula), "Llegado".
 */

/**
 * Orden ESTRICTO de la leyenda y del apilado en celdas:
 *   Aceptado → Iniciado → Esperando → En camino → Llegado.
 */
export const SEGUIMIENTO_ESTADO_UI_ORDER = [
  "Aceptado",
  "Iniciado",
  "Esperando",
  "En camino",
  "Llegado",
] as const;

export type SeguimientoEstadoCanonical = (typeof SEGUIMIENTO_ESTADO_UI_ORDER)[number];

/**
 * Paleta oficial extraída de `moobiz_services` (case-sensitive):
 *   - Aceptado   #333333  (gris casi negro)
 *   - Iniciado   #4B77BE  (azul profesional)
 *   - Esperando  #f57f17  (naranja intenso)
 *   - En camino  #00838f  (verde azulado / cian oscuro)
 *   - Llegado    #64748b  (gris fallback, al final)
 */
export const SEGUIMIENTO_ESTADO_COLORS: Record<SeguimientoEstadoCanonical, string> = {
  Aceptado: "#333333",
  Iniciado: "#4B77BE",
  Esperando: "#f57f17",
  "En camino": "#00838f",
  Llegado: "#64748b",
};

export const SEGUIMIENTO_ESTADO_FALLBACK_COLOR = "#64748b";

/**
 * Match ESTRICTO case-sensitive contra los nombres oficiales del SQL.
 * Devuelve `null` para cualquier variante (e.g. "aceptado", "EN CAMINO", "En Camino").
 */
export function canonicalSeguimientoEstado(raw: string): SeguimientoEstadoCanonical | null {
  return (SEGUIMIENTO_ESTADO_UI_ORDER as readonly string[]).includes(raw)
    ? (raw as SeguimientoEstadoCanonical)
    : null;
}

export function colorForSeguimientoEstado(raw: string): string {
  const c = canonicalSeguimientoEstado(raw);
  if (c) return SEGUIMIENTO_ESTADO_COLORS[c];
  return SEGUIMIENTO_ESTADO_FALLBACK_COLOR;
}

/**
 * Clase Tailwind del anillo del badge (contraste sobre fondo oscuro para "Aceptado" #333).
 * `cell`: segmentos dentro de la grilla; `pill`: leyenda y tooltip.
 */
export function seguimientoEstadoBadgeRingClass(raw: string, variant: "cell" | "pill"): string {
  if (canonicalSeguimientoEstado(raw) === "Aceptado") {
    return "ring-white/10";
  }
  return variant === "cell" ? "ring-black/5" : "ring-black/10";
}

export function rankSeguimientoEstado(raw: string): number {
  const c = canonicalSeguimientoEstado(raw);
  if (!c) return 999;
  return SEGUIMIENTO_ESTADO_UI_ORDER.indexOf(c);
}

export function compareSeguimientoEstadoStackOrder(a: string, b: string): number {
  const ra = rankSeguimientoEstado(a);
  const rb = rankSeguimientoEstado(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "es");
}

export function sortEstadosForLegend(estados: string[]): string[] {
  const uniq = [...new Set(estados)];
  return uniq.sort(compareSeguimientoEstadoStackOrder);
}

/** Orden de apilado en celdas / tooltip: prioridad de estado y a mayor cantidad primero. */
export function sortEstadoEntriesForMatrix(entries: [string, number][]): [string, number][] {
  return [...entries].sort((a, b) => {
    const c = compareSeguimientoEstadoStackOrder(a[0], b[0]);
    if (c !== 0) return c;
    return b[1] - a[1];
  });
}
