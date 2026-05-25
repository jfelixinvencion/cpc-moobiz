/**
 * Parseo de fechas Moobiz (API sin zona → America/Lima; uso interno UTC ISO).
 */
import { DateTime } from "luxon";

const DEFAULT_TZ = "America/Lima";
const LOCAL_FORMAT = "yyyy-MM-dd HH:mm:ss";
const YMD_FORMAT = "yyyy-MM-dd";

export function getMoobizDefaultTimezone(): string {
  const fromEnv = String(process.env.DEFAULT_TIMEZONE || "").trim();
  return fromEnv || DEFAULT_TZ;
}

export function isIsoLikeDateString(value: unknown): boolean {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/[Tt]/.test(s)) return true;
  if (/[Zz]$/.test(s)) return true;
  if (/[+-]\d{2}:?\d{2}$/.test(s)) return true;
  return false;
}

/** Normaliza timestamp Moobiz a UTC ISO (Z). */
export function parseMoobizDateAsUTC(
  dateStr: unknown,
  zone: string = getMoobizDefaultTimezone(),
): string | null {
  const s = String(dateStr ?? "").trim();
  if (!s) return null;

  if (isIsoLikeDateString(s)) {
    const dt = DateTime.fromISO(s, { setZone: true });
    if (!dt.isValid) return null;
    return dt.toUTC().toISO();
  }

  let dt = DateTime.fromFormat(s, LOCAL_FORMAT, { zone });
  if (!dt.isValid) {
    dt = DateTime.fromFormat(s, YMD_FORMAT, { zone });
    if (!dt.isValid) return null;
    dt = dt.startOf("day");
  }
  return dt.toUTC().toISO();
}

export function parseMoobizDateToMillis(
  dateStr: unknown,
  zone: string = getMoobizDefaultTimezone(),
): number | null {
  const iso = parseMoobizDateAsUTC(dateStr, zone);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function moobizYmdDaysAgo(
  days: number,
  zone: string = getMoobizDefaultTimezone(),
): string {
  const n = Number(days);
  const d = Number.isFinite(n) && n >= 0 ? n : 0;
  return DateTime.now().setZone(zone).minus({ days: d }).toFormat(YMD_FORMAT);
}

export function moobizDateToNowUtcIso(): string {
  return DateTime.utc().toISO() ?? new Date().toISOString();
}

export type MoobizDateParseDetails = {
  raw_date_updated: string | null;
  parsed_lima_iso: string | null;
  normalized_utc_iso: string | null;
};

export function resolveMoobizDateParseDetails(
  raw: unknown,
  zone: string = getMoobizDefaultTimezone(),
): MoobizDateParseDetails {
  const rawStr = raw == null ? "" : String(raw).trim();
  if (!rawStr) {
    return { raw_date_updated: null, parsed_lima_iso: null, normalized_utc_iso: null };
  }

  if (isIsoLikeDateString(rawStr)) {
    const dt = DateTime.fromISO(rawStr, { setZone: true });
    const normalized_utc_iso = dt.isValid ? dt.toUTC().toISO() : null;
    const parsed_lima_iso = dt.isValid
      ? dt.setZone(zone).toISO({ suppressMilliseconds: false })
      : null;
    return { raw_date_updated: rawStr, parsed_lima_iso, normalized_utc_iso };
  }

  const dtLocal = DateTime.fromFormat(rawStr, LOCAL_FORMAT, { zone });
  const parsed_lima_iso = dtLocal.isValid ? dtLocal.toISO() : null;
  const normalized_utc_iso = dtLocal.isValid
    ? dtLocal.toUTC().toISO()
    : parseMoobizDateAsUTC(rawStr, zone);

  return { raw_date_updated: rawStr, parsed_lima_iso, normalized_utc_iso };
}
