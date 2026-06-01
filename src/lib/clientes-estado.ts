/**
 * COPIA INDEPENDIENTE: Do not modify original seguimiento-estado.ts; this is Clientes copy.
 */
/**
 * Paleta y orden de estados para la vista "Clientes operaciones"
 * (matriz y leyenda) basada en `vista.moobiz_services_maestra.state_color_name`.
 *
 * IMPORTANTE: el match es ESTRICTAMENTE case-sensitive contra los strings
 * que devuelve el SQL.
 */

/** Cinco estados principales (leyenda y apilado, en este orden). */
export const CLIENTES_ESTADO_PRIMARY_ORDER = [
  "Pendiente",
  "Aceptado",
  "Iniciado",
  "Esperando",
  "En camino",
] as const;

/** Estados canónicos adicionales (después de los cinco principales). */
export const CLIENTES_ESTADO_SECONDARY_ORDER = ["Llegado"] as const;

export const CLIENTES_ESTADO_UI_ORDER = [
  ...CLIENTES_ESTADO_PRIMARY_ORDER,
  ...CLIENTES_ESTADO_SECONDARY_ORDER,
] as const;

export type ClientesEstadoCanonical = (typeof CLIENTES_ESTADO_UI_ORDER)[number];

export const CLIENTES_ESTADO_COLORS: Record<ClientesEstadoCanonical, string> = {
  Pendiente: "#b8b8b8",
  Aceptado: "#333333",
  Iniciado: "#4B77BE",
  Esperando: "#f57f17",
  "En camino": "#00838f",
  Llegado: "#64748b",
};

/** Colores fijos para estados extra conocidos (evitan duplicar la paleta principal). */
export const CLIENTES_ESTADO_EXTRA_COLORS: Record<string, string> = {
  Validar: "#7c3aed",
  "Sin estado": "#94a3b8",
};

/** Paleta para otros `state_color_name` no listados arriba (hash estable). */
const CLIENTES_DYNAMIC_EXTRA_PALETTE = [
  "#b45309",
  "#0d9488",
  "#db2777",
  "#4f46e5",
  "#0369a1",
  "#65a30d",
] as const;

export const CLIENTES_ESTADO_FALLBACK_COLOR = "#94a3b8";

const USED_COLOR_VALUES = new Set<string>([
  ...Object.values(CLIENTES_ESTADO_COLORS),
  ...Object.values(CLIENTES_ESTADO_EXTRA_COLORS),
]);

export function canonicalClientesEstado(raw: string): ClientesEstadoCanonical | null {
  return (CLIENTES_ESTADO_UI_ORDER as readonly string[]).includes(raw)
    ? (raw as ClientesEstadoCanonical)
    : null;
}

function hashEstadoLabel(raw: string): number {
  let h = 0;
  for (let i = 0; i < raw.length; i++) {
    h = (h * 31 + raw.charCodeAt(i)) >>> 0;
  }
  return h;
}

function colorForDynamicExtraEstado(raw: string): string {
  const palette = CLIENTES_DYNAMIC_EXTRA_PALETTE.filter((c) => !USED_COLOR_VALUES.has(c));
  const pool = palette.length > 0 ? palette : CLIENTES_DYNAMIC_EXTRA_PALETTE;
  return pool[hashEstadoLabel(raw) % pool.length] ?? CLIENTES_ESTADO_FALLBACK_COLOR;
}

export function colorForClientesEstado(raw: string): string {
  const c = canonicalClientesEstado(raw);
  if (c) return CLIENTES_ESTADO_COLORS[c];
  const extra = CLIENTES_ESTADO_EXTRA_COLORS[raw];
  if (extra) return extra;
  return colorForDynamicExtraEstado(raw);
}

export function clientesEstadoBadgeRingClass(raw: string, variant: "cell" | "pill"): string {
  if (canonicalClientesEstado(raw) === "Aceptado") {
    return "ring-white/10";
  }
  if (canonicalClientesEstado(raw) === "Pendiente") {
    return variant === "cell" ? "ring-black/10" : "ring-black/15";
  }
  return variant === "cell" ? "ring-black/5" : "ring-black/10";
}

export function rankClientesEstado(raw: string): number {
  const primaryIdx = (CLIENTES_ESTADO_PRIMARY_ORDER as readonly string[]).indexOf(raw);
  if (primaryIdx >= 0) return primaryIdx;

  const secondaryIdx = (CLIENTES_ESTADO_SECONDARY_ORDER as readonly string[]).indexOf(raw);
  if (secondaryIdx >= 0) return CLIENTES_ESTADO_PRIMARY_ORDER.length + secondaryIdx;

  if (raw in CLIENTES_ESTADO_EXTRA_COLORS) {
    const keys = Object.keys(CLIENTES_ESTADO_EXTRA_COLORS).sort((a, b) =>
      a.localeCompare(b, "es"),
    );
    return 100 + keys.indexOf(raw);
  }

  return 900;
}

export function compareClientesEstadoStackOrder(a: string, b: string): number {
  const ra = rankClientesEstado(a);
  const rb = rankClientesEstado(b);
  if (ra !== rb) return ra - rb;
  return a.localeCompare(b, "es");
}

export function sortEstadosForLegend(estados: string[]): string[] {
  const uniq = [...new Set(estados)];
  return uniq.sort(compareClientesEstadoStackOrder);
}

export function sortEstadoEntriesForMatrix(entries: [string, number][]): [string, number][] {
  return [...entries].sort((a, b) => {
    const c = compareClientesEstadoStackOrder(a[0], b[0]);
    if (c !== 0) return c;
    return b[1] - a[1];
  });
}
