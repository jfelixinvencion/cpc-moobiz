/**
 * Parseo de fechas Moobiz: strings sin zona → America/Lima; salida interna UTC ISO (Z).
 * DEFAULT_TIMEZONE (env) por defecto America/Lima.
 */
const { DateTime } = require("luxon");

const DEFAULT_TZ = "America/Lima";
const LOCAL_FORMAT = "yyyy-MM-dd HH:mm:ss";
const YMD_FORMAT = "yyyy-MM-dd";

function getMoobizDefaultTimezone() {
  const fromEnv = String(process.env.DEFAULT_TIMEZONE || "").trim();
  return fromEnv || DEFAULT_TZ;
}

/** true si el string parece ISO (T/Z/offset). */
function isIsoLikeDateString(value) {
  const s = String(value ?? "").trim();
  if (!s) return false;
  if (/[Tt]/.test(s)) return true;
  if (/[Zz]$/.test(s)) return true;
  if (/[+-]\d{2}:?\d{2}$/.test(s)) return true;
  return false;
}

/**
 * Normaliza un timestamp Moobiz a UTC ISO con sufijo Z.
 * @param {unknown} dateStr
 * @param {string} [zone]
 * @returns {string|null}
 */
function parseMoobizDateAsUTC(dateStr, zone = getMoobizDefaultTimezone()) {
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

/**
 * @param {unknown} dateStr
 * @param {string} [zone]
 * @returns {number|null} millis UTC
 */
function parseMoobizDateToMillis(dateStr, zone = getMoobizDefaultTimezone()) {
  const iso = parseMoobizDateAsUTC(dateStr, zone);
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** YYYY-MM-DD calendario en zona Moobiz (p. ej. hoy−N días para date_from API). */
function moobizYmdDaysAgo(days, zone = getMoobizDefaultTimezone()) {
  const n = Number(days);
  const d = Number.isFinite(n) && n >= 0 ? n : 0;
  return DateTime.now().setZone(zone).minus({ days: d }).toFormat(YMD_FORMAT);
}

/** Inicio del día YYYY-MM-DD en zona Moobiz → millis UTC. */
function moobizYmdStartUtcMillis(ymd, zone = getMoobizDefaultTimezone()) {
  const s = String(ymd ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return NaN;
  const dt = DateTime.fromFormat(s, YMD_FORMAT, { zone }).startOf("day");
  if (!dt.isValid) return NaN;
  return dt.toUTC().toMillis();
}

/** date_to para query API: ahora en UTC ISO (comparaciones internas alineadas). */
function moobizDateToNowUtcIso() {
  return DateTime.utc().toISO();
}

/**
 * Detalle para dry-run / logs.
 * @param {unknown} raw
 * @param {string} [zone]
 */
function resolveMoobizDateParseDetails(raw, zone = getMoobizDefaultTimezone()) {
  const rawStr = raw == null ? "" : String(raw).trim();
  if (!rawStr) {
    return {
      raw_date_updated: null,
      parsed_lima_iso: null,
      normalized_utc_iso: null,
    };
  }

  if (isIsoLikeDateString(rawStr)) {
    const dt = DateTime.fromISO(rawStr, { setZone: true });
    const normalized_utc_iso = dt.isValid ? dt.toUTC().toISO() : null;
    const parsed_lima_iso =
      dt.isValid ? dt.setZone(zone).toISO({ suppressMilliseconds: false }) : null;
    return { raw_date_updated: rawStr, parsed_lima_iso, normalized_utc_iso };
  }

  const dtLocal = DateTime.fromFormat(rawStr, LOCAL_FORMAT, { zone });
  const parsed_lima_iso = dtLocal.isValid ? dtLocal.toISO() : null;
  const normalized_utc_iso = dtLocal.isValid ? dtLocal.toUTC().toISO() : parseMoobizDateAsUTC(rawStr, zone);

  return { raw_date_updated: rawStr, parsed_lima_iso, normalized_utc_iso };
}

/** Mayor date_updated UTC ISO entre filas { raw_data, id }. */
function maxMoobizDateUpdatedIsoFromRows(rows) {
  if (!rows || rows.length === 0) return null;
  let maxMs = null;
  for (const r of rows) {
    const cand =
      (r.raw_data && (r.raw_data.date_updated ?? r.raw_data["date_updated"])) || r.date_updated || null;
    const ms = parseMoobizDateToMillis(cand);
    if (ms == null) continue;
    if (maxMs == null || ms > maxMs) maxMs = ms;
  }
  return maxMs != null ? new Date(maxMs).toISOString() : null;
}

module.exports = {
  getMoobizDefaultTimezone,
  isIsoLikeDateString,
  parseMoobizDateAsUTC,
  parseMoobizDateToMillis,
  moobizYmdDaysAgo,
  moobizYmdStartUtcMillis,
  moobizDateToNowUtcIso,
  resolveMoobizDateParseDetails,
  maxMoobizDateUpdatedIsoFromRows,
};
