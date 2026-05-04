import { endOfISOWeek, format, getISOWeek, getISOWeekYear, startOfISOWeek, subDays } from "date-fns";

/**
 * Etiqueta de semana alineada con `reportes.liquidaciones_conductores.semana_label`:
 * `YYYY_SemWW_dd.MM_dd.MM` (lunes–domingo ISO de la semana que contiene `referencia - 7 días`).
 */
export function semanaLabelLiquidaciones(referencia: Date = new Date()): string {
  const d = subDays(referencia, 7);
  const y = getISOWeekYear(d);
  const w = getISOWeek(d);
  const start = startOfISOWeek(d);
  const end = endOfISOWeek(d);
  return `${y}_Sem${String(w).padStart(2, "0")}_${format(start, "dd.MM")}_${format(end, "dd.MM")}`;
}
