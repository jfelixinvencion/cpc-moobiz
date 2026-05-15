export const PRODUCTIVIDAD_LOG_TYPES = [
  "Creó",
  "Solicitó",
  "Asignó",
  "Modificó",
  "Quitó",
] as const;

export type ProductividadLogType = (typeof PRODUCTIVIDAD_LOG_TYPES)[number];

export type ProductividadFilterField =
  | "global"
  | "estado"
  | "n_semana"
  | "type_user"
  | "type_log_name"
  | "us_name"
  | "fecha";

export type ProductividadParsedParams = {
  global: string[] | null;
  estado: string[] | null;
  nSemana: string[] | null;
  fechaFrom: string | null;
  fechaTo: string | null;
  typeUser: string[] | null;
  typeLogName: string[] | null;
  usName: string[] | null;
  limit: number;
  offset: number;
  /** Orden dinámico del chart de usuarios; null = por total_per_user. */
  sortTypes: string[] | null;
};

const MAX_MULTI = 80;
const DD_MM_YYYY = /^(\d{2})\/(\d{2})\/(\d{4})$/;

function trimArr(arr: string[]): string[] {
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length === 0 ? [] : out.length > MAX_MULTI ? out.slice(0, MAX_MULTI) : out;
}

function nullIfEmpty(arr: string[]): string[] | null {
  return arr.length === 0 ? null : arr;
}

/** Acepta DD/MM/YYYY o YYYY-MM-DD (input date) y normaliza a DD/MM/YYYY para SQL. */
export function normalizeFechaParam(raw: string | null | undefined): string | null {
  const t = raw?.trim() ?? "";
  if (!t) return null;
  const dd = DD_MM_YYYY.exec(t);
  if (dd) return t;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return null;
}

/** Convierte DD/MM/YYYY a YYYY-MM-DD para inputs type=date. */
export function fechaParamToIsoInput(fecha: string | null): string {
  if (!fecha) return "";
  const m = DD_MM_YYYY.exec(fecha);
  if (!m) return "";
  return `${m[3]}-${m[2]}-${m[1]}`;
}

export function isoInputToFechaParam(iso: string): string | null {
  return normalizeFechaParam(iso);
}

export function parseProductividadParams(
  sp: URLSearchParams,
  opts?: { skipTypeLogName?: boolean },
): ProductividadParsedParams {
  const multi = (key: string) => trimArr(sp.getAll(key));
  const limitRaw = Number.parseInt(sp.get("limit") ?? "20", 10);
  const offsetRaw = Number.parseInt(sp.get("offset") ?? "0", 10);

  return {
    global: nullIfEmpty(multi("global")),
    estado: nullIfEmpty(multi("estado")),
    nSemana: nullIfEmpty(multi("n_semana")),
    fechaFrom: normalizeFechaParam(sp.get("fecha_from")),
    fechaTo: normalizeFechaParam(sp.get("fecha_to")),
    typeUser: nullIfEmpty(multi("type_user")),
    typeLogName: opts?.skipTypeLogName ? null : nullIfEmpty(multi("type_log_name")),
    usName: nullIfEmpty(multi("us_name")),
    limit: Number.isFinite(limitRaw) ? Math.min(200, Math.max(1, limitRaw)) : 20,
    offset: Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0,
    sortTypes: nullIfEmpty(multi("sort_types")),
  };
}

export function appendProductividadParams(
  p: URLSearchParams,
  filters: ProductividadParsedParams,
  opts?: { skipTypeLogName?: boolean },
): void {
  for (const v of filters.global ?? []) p.append("global", v);
  for (const v of filters.estado ?? []) p.append("estado", v);
  for (const v of filters.nSemana ?? []) p.append("n_semana", v);
  for (const v of filters.typeUser ?? []) p.append("type_user", v);
  if (!opts?.skipTypeLogName) {
    for (const v of filters.typeLogName ?? []) p.append("type_log_name", v);
  }
  for (const v of filters.usName ?? []) p.append("us_name", v);
  if (filters.fechaFrom) p.set("fecha_from", filters.fechaFrom);
  if (filters.fechaTo) p.set("fecha_to", filters.fechaTo);
  for (const v of filters.sortTypes ?? []) p.append("sort_types", v);
  p.set("limit", String(filters.limit));
  p.set("offset", String(filters.offset));
}
