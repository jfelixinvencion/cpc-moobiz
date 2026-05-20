export type FlotaConductoresSortCol = "n_servicios" | "distrito";
export type FlotaConductoresSortDir = "asc" | "desc";

export type FlotaConductoresParsedParams = {
  selectedWeeks: string[] | null;
  selectedGlobal: string[] | null;
  selectedEstado: string[] | null;
  selectedDatosVenc: string[] | null;
  selectedDatosFact: string[] | null;
  distritoText: string | null;
  selectedDistritos: string[] | null;
  selectedNameId: string | null;
  limit: number;
  offset: number;
  sortCol: FlotaConductoresSortCol;
  sortDir: FlotaConductoresSortDir;
};

const MAX_MULTI = 80;
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 200;

function trimArr(arr: string[]): string[] {
  const out = arr.map((s) => s.trim()).filter(Boolean);
  return out.length === 0 ? [] : out.length > MAX_MULTI ? out.slice(0, MAX_MULTI) : out;
}

function nullIfEmpty(arr: string[]): string[] | null {
  return arr.length === 0 ? null : arr;
}

export function parseFlotaConductoresParams(sp: URLSearchParams): FlotaConductoresParsedParams {
  const multi = (key: string) => trimArr(sp.getAll(key));
  const limitRaw = Number.parseInt(sp.get("limit") ?? String(DEFAULT_LIMIT), 10);
  const offsetRaw = Number.parseInt(sp.get("offset") ?? "0", 10);
  const sortColRaw = sp.get("sort_col")?.trim() ?? "n_servicios";
  const sortDirRaw = sp.get("sort_dir")?.trim().toLowerCase() ?? "desc";

  const sortCol: FlotaConductoresSortCol =
    sortColRaw === "distrito" || sortColRaw === "En que distrito vive" ? "distrito" : "n_servicios";
  const sortDir: FlotaConductoresSortDir = sortDirRaw === "asc" ? "asc" : "desc";

  const distritoText = sp.get("distrito_q")?.trim() ?? null;

  const nameId = sp.get("nameid")?.trim() ?? null;

  return {
    selectedWeeks: nullIfEmpty(multi("semana")),
    selectedGlobal: nullIfEmpty(multi("global")),
    selectedEstado: nullIfEmpty(multi("estado")),
    selectedDatosVenc: nullIfEmpty(multi("datos_venc")),
    selectedDatosFact: nullIfEmpty(multi("datos_fact")),
    distritoText: distritoText || null,
    selectedDistritos: nullIfEmpty(multi("distrito")),
    selectedNameId: nameId || null,
    limit: Number.isFinite(limitRaw) ? Math.min(MAX_LIMIT, Math.max(1, limitRaw)) : DEFAULT_LIMIT,
    offset: Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0,
    sortCol,
    sortDir,
  };
}

export function appendFlotaConductoresParams(
  p: URLSearchParams,
  filters: FlotaConductoresParsedParams,
): void {
  for (const v of filters.selectedWeeks ?? []) p.append("semana", v);
  for (const v of filters.selectedGlobal ?? []) p.append("global", v);
  for (const v of filters.selectedEstado ?? []) p.append("estado", v);
  for (const v of filters.selectedDatosVenc ?? []) p.append("datos_venc", v);
  for (const v of filters.selectedDatosFact ?? []) p.append("datos_fact", v);
  for (const v of filters.selectedDistritos ?? []) p.append("distrito", v);
  if (filters.distritoText) p.set("distrito_q", filters.distritoText);
  if (filters.selectedNameId) p.set("nameid", filters.selectedNameId);
  p.set("sort_col", filters.sortCol);
  p.set("sort_dir", filters.sortDir);
  p.set("limit", String(filters.limit));
  p.set("offset", String(filters.offset));
}
