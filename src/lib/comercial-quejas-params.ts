export type ComercialQuejasSortCol = "fecha_queja" | "created_at";
export type ComercialQuejasSortDir = "asc" | "desc";

export type ComercialQuejasListParams = {
  limit: number;
  offset: number;
  search: string | null;
  idServicio: string | null;
  estadoRegistro: string | null;
  fechaFrom: string | null;
  fechaTo: string | null;
  sortCol: ComercialQuejasSortCol;
  sortDir: ComercialQuejasSortDir;
};

const SORT_COLS: ComercialQuejasSortCol[] = ["fecha_queja", "created_at"];

export function parseComercialQuejasListParams(
  searchParams: URLSearchParams,
): ComercialQuejasListParams {
  const limitRaw = Number(searchParams.get("limit") ?? "100");
  const offsetRaw = Number(searchParams.get("offset") ?? "0");
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, limitRaw), 200) : 100;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, offsetRaw) : 0;

  const sortColRaw = (searchParams.get("sort_col") ?? "created_at").trim();
  const sortCol = SORT_COLS.includes(sortColRaw as ComercialQuejasSortCol)
    ? (sortColRaw as ComercialQuejasSortCol)
    : "created_at";

  const sortDirRaw = (searchParams.get("sort_dir") ?? "desc").trim().toLowerCase();
  const sortDir: ComercialQuejasSortDir = sortDirRaw === "asc" ? "asc" : "desc";

  const pick = (key: string) => {
    const v = searchParams.get(key)?.trim();
    return v ? v : null;
  };

  return {
    limit,
    offset,
    search: pick("search"),
    idServicio: pick("id_servicio"),
    estadoRegistro: pick("estado_registro"),
    fechaFrom: pick("fecha_from"),
    fechaTo: pick("fecha_to"),
    sortCol,
    sortDir,
  };
}

export function appendComercialQuejasParams(
  p: URLSearchParams,
  params: ComercialQuejasListParams,
): void {
  p.set("limit", String(params.limit));
  p.set("offset", String(params.offset));
  p.set("sort_col", params.sortCol);
  p.set("sort_dir", params.sortDir);
  if (params.search) p.set("search", params.search);
  if (params.idServicio) p.set("id_servicio", params.idServicio);
  if (params.estadoRegistro) p.set("estado_registro", params.estadoRegistro);
  if (params.fechaFrom) p.set("fecha_from", params.fechaFrom);
  if (params.fechaTo) p.set("fecha_to", params.fechaTo);
}
