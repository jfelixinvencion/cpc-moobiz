import { format } from "date-fns";
import { enUS, es } from "date-fns/locale";
import { formatInTimeZone, toZonedTime } from "date-fns-tz";

export const AMERICA_LIMA = "America/Lima";

/** Instante → fecha/hora “como en Lima” (componentes locales de esa zona). */
export function toLimaDate(input: Date | string | number): Date {
  const d = input instanceof Date ? input : new Date(input);
  return toZonedTime(d, AMERICA_LIMA);
}

/** Fecha y hora en America/Lima (p. ej. `11/05/2026 05:20 PM`). */
export function formatLimaDateTime(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string" && !value.trim()) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "—";
  return formatInTimeZone(d, AMERICA_LIMA, "dd/MM/yyyy hh:mm a", { locale: enUS });
}

/**
 * Solo fecha en Lima.
 * - `YYYY-MM-DD` (bucket diario): medianoche de ese día en Lima.
 * - `YYYY-MM` (bucket mensual): `mmm-yy` en minúsculas.
 */
export function formatLimaDate(value: Date | string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") {
    const s = value.trim();
    if (!s) return "—";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const [y, m, d] = s.split("-").map(Number);
      const instant = new Date(Date.UTC(y, m - 1, d, 5, 0, 0));
      return formatInTimeZone(instant, AMERICA_LIMA, "dd/MM/yyyy", { locale: es });
    }
    if (/^\d{4}-\d{2}$/.test(s)) {
      const [y, m] = s.split("-").map(Number);
      const instant = new Date(Date.UTC(y, m - 1, 1, 5, 0, 0));
      return formatInTimeZone(instant, AMERICA_LIMA, "MMM-yy", { locale: enUS }).replace(/\./g, "").toLowerCase();
    }
  }
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return typeof value === "string" ? value : "—";
  return formatInTimeZone(d, AMERICA_LIMA, "dd/MM/yyyy", { locale: es });
}

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
