/**
 * Eje horario del timeline de la subpestaña Clientes (independiente de Seguimiento).
 */

export const CLIENTES_TIMELINE_ACTIVE_STATES = [
  "Pendiente",
  "Aceptado",
  "Iniciado",
  "Esperando",
] as const;

const HOUR_MS = 60 * 60 * 1000;

export const CLIENTES_TIMELINE_DEFAULT_MIN_AXIS_HOURS = 24;

/** Redondea al inicio de la hora local del servicio (hora real, no hora de sistema). */
export function floorToLocalHourMs(d: Date): number {
  const x = new Date(d.getTime());
  x.setMinutes(0, 0, 0);
  x.setMilliseconds(0);
  return x.getTime();
}

export type ClientesTimelineAxisFallback = "active-states-min" | "system-hour";

export type ClientesTimelineAxisBounds = {
  axisStartMs: number;
  axisEndMs: number;
  /** `active-states-min` si hubo servicios en los 4 estados; si no, `system-hour` (hora actual redondeada). */
  fallback: ClientesTimelineAxisFallback;
};

export type ClientesTimelineAxisRow = {
  estado: string;
  serviceAt: Date | null;
};

/**
 * Calcula inicio y fin del eje horario para Clientes.
 * Inicio: hora mínima (truncada) entre servicios en Pendiente/Aceptado/Iniciado/Esperando.
 * Fin: máximo entre la hora más tardía de cualquier servicio y `axisStart + minAxisHours - 1`.
 */
export function computeClientesTimelineAxisBounds(params: {
  rows: ClientesTimelineAxisRow[];
  minAxisHours?: number;
  now?: Date;
}): ClientesTimelineAxisBounds {
  const minAxisHours = params.minAxisHours ?? CLIENTES_TIMELINE_DEFAULT_MIN_AXIS_HOURS;
  const now = params.now ?? new Date();
  const systemHourStart = floorToLocalHourMs(now);
  const activeSet = new Set<string>(CLIENTES_TIMELINE_ACTIVE_STATES);

  let minActiveMs: number | null = null;
  let maxSlotMs = systemHourStart;

  for (const row of params.rows) {
    if (!row.serviceAt) continue;
    const t = floorToLocalHourMs(row.serviceAt);
    if (t > maxSlotMs) maxSlotMs = t;

    const estado = row.estado.trim();
    if (!activeSet.has(estado)) continue;
    if (minActiveMs === null || t < minActiveMs) minActiveMs = t;
  }

  const fallback: ClientesTimelineAxisFallback =
    minActiveMs !== null ? "active-states-min" : "system-hour";
  const axisStartMs = minActiveMs ?? systemHourStart;
  const minEndMs = axisStartMs + (minAxisHours - 1) * HOUR_MS;
  const axisEndMs = Math.max(maxSlotMs, minEndMs);

  return { axisStartMs, axisEndMs, fallback };
}

/** Índice de columna para la hora actual del sistema, o -1 si no está en el rango. */
export function indexOfCurrentHourInAxis(
  slots: ReadonlyArray<{ ts: number }>,
  now: Date = new Date(),
): number {
  const nowSlot = floorToLocalHourMs(now);
  return slots.findIndex((s) => s.ts === nowSlot);
}
