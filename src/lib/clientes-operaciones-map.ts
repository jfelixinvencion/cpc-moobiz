import type {
  ClientesOperacionesServiceRow,
  ClientesOperacionesSummaryRow,
} from "./clientes-operaciones-types";

export const UNKNOWN_COMPANY_ID = "__unknown_company__";

export function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/** Clave estable por empresa (co_id preferido). */
export function empresaRowKey(co_id: string, co_name: string): string {
  const id = toText(co_id);
  if (id) return id;
  const name = toText(co_name) || "Sin empresa";
  return `${UNKNOWN_COMPANY_ID}:${name}`;
}

export function empresaDisplayName(co_name: string, co_id: string): string {
  const name = toText(co_name);
  if (name) return name;
  const id = toText(co_id);
  return id ? `Empresa ${id}` : "Sin empresa";
}

export function moobizActivesCompanyUrl(co_id: string): string | null {
  const id = toText(co_id);
  if (!id || id === UNKNOWN_COMPANY_ID) return null;
  return `https://app.moobiz.pe/actives?id_company=${encodeURIComponent(id)}`;
}

export function parseServiceDate(fecha: string, fechaRegistro: string): Date | null {
  const candidate = toText(fecha) || toText(fechaRegistro);
  if (!candidate) return null;
  const isoTry = new Date(candidate);
  if (!Number.isNaN(isoTry.getTime())) return isoTry;
  const m = candidate.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?)?/i,
  );
  if (m) {
    const day = Number(m[1]);
    const month = Number(m[2]) - 1;
    const year = Number(m[3]);
    let hour = m[4] !== undefined ? Number(m[4]) : 0;
    const minute = m[5] !== undefined ? Number(m[5]) : 0;
    const second = m[6] !== undefined ? Number(m[6]) : 0;
    const meridiem = m[7] ? String(m[7]).toLowerCase().replace(/\./g, "") : "";
    if (meridiem.startsWith("p") && hour < 12) hour += 12;
    if (meridiem.startsWith("a") && hour === 12) hour = 0;
    const d = new Date(year, month, day, hour, minute, second);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function floorToHourUtc(d: Date): string {
  const x = new Date(d.getTime());
  x.setUTCMinutes(0, 0, 0);
  x.setUTCMilliseconds(0);
  return x.toISOString();
}

export function buildSummaryFromServices(
  rows: ClientesOperacionesServiceRow[],
): ClientesOperacionesSummaryRow[] {
  const counts = new Map<
    string,
    { co_id: string; co_name: string; estado: string; hour_ts: string; servicios_count: number }
  >();

  for (const row of rows) {
    const co_id = toText(row.co_id) || UNKNOWN_COMPANY_ID;
    const co_name = empresaDisplayName(row.co_name, row.co_id);
    const estado = toText(row.estado) || "Sin estado";
    const d = parseServiceDate(row.fecha, row.fecha_registro);
    if (!d) continue;
    const hour_ts = floorToHourUtc(d);
    const key = `${co_id}|${hour_ts}|${estado}`;
    const prev = counts.get(key);
    if (prev) {
      prev.servicios_count += 1;
    } else {
      counts.set(key, { co_id, co_name, estado, hour_ts, servicios_count: 1 });
    }
  }

  return [...counts.values()].sort((a, b) => {
    const n = a.co_name.localeCompare(b.co_name, "es");
    if (n !== 0) return n;
    return a.hour_ts.localeCompare(b.hour_ts);
  });
}
