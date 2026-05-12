import { format } from "date-fns";
import { es } from "date-fns/locale";

/** ISO date calendar-only: YYYY-MM-DD (no hora). */
const ISO_DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
/** Fecha calendario DD/MM/YYYY (sin hora). */
const DMY_DATE_ONLY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

export function parseDateOnlyToLocal(dateStr: string | null | undefined): Date | null {
  if (dateStr === null || dateStr === undefined) return null;
  const trimmed = String(dateStr).trim();
  if (!trimmed) return null;

  let m: RegExpExecArray | null;
  if ((m = ISO_DATE_ONLY.exec(trimmed))) {
    const year = Number(m[1]);
    const month = Number(m[2]) - 1;
    const day = Number(m[3]);
    return new Date(year, month, day);
  }
  if ((m = DMY_DATE_ONLY.exec(trimmed))) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    return new Date(year, month, day);
  }

  const maybe = new Date(trimmed);
  return Number.isNaN(maybe.getTime()) ? null : maybe;
}

export function formatDateForUi(dateStr: string | null | undefined): string {
  const d = parseDateOnlyToLocal(dateStr);
  if (!d) return "";
  return format(d, "dd/MM/yyyy", { locale: es });
}

/**
 * Vencimientos en Datos Pendientes: fechas solo-día (YYYY-MM-DD o DD/MM/YYYY) en calendario local
 * sin desfase UTC; si el valor incluye hora / ISO completo, mismo formato datetime que antes.
 */
export function formatVencimientoDatosPendienteCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value).trim();
  if (!s) return "—";
  if (ISO_DATE_ONLY.test(s) || DMY_DATE_ONLY.test(s)) {
    const out = formatDateForUi(s);
    return out || "—";
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
