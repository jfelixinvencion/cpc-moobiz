export type DatosPendientesColumnKey =
  | "id_conductor"
  | "nombre_conductor"
  | "n_servicios_30"
  | "sucursal"
  | "distrito"
  | "turno"
  | "vencimiento_brevete"
  | "vencimiento_revision_tecnica"
  | "vencimiento_soat"
  | "tipo_contribuyente"
  | "marcar_contabilidad"
  | "numero_ruc_factura"
  | "usuario_sunat"
  | "clave_sol_sunat"
  | "estado";

export type DatosPendientesSortDir = "asc" | "desc";
export type DatosPendientesNulls = "nullsfirst" | "nullslast";

export const DATOS_PENDIENTES_COLUMNS: Array<{ key: DatosPendientesColumnKey; label: string }> = [
  { key: "id_conductor", label: "ID Conductor" },
  { key: "nombre_conductor", label: "Nombre Conductor" },
  { key: "n_servicios_30", label: "N Servicios <30" },
  { key: "sucursal", label: "Sucursal" },
  { key: "distrito", label: "En que distrito vive" },
  { key: "turno", label: "Turno" },
  { key: "vencimiento_brevete", label: "Vencimiento de Brevete" },
  { key: "vencimiento_revision_tecnica", label: "Vencimiento de Revisión Técnica" },
  { key: "vencimiento_soat", label: "Vencimiento de SOAT" },
  { key: "tipo_contribuyente", label: "Tipo de Contribuyente" },
  { key: "marcar_contabilidad", label: "Marcar si Moobiz realiza su contabilidad" },
  { key: "numero_ruc_factura", label: "Número Ruc Factura" },
  { key: "usuario_sunat", label: "Usuario Sunat" },
  { key: "clave_sol_sunat", label: "Clave Sol Sunat" },
  { key: "estado", label: "Estado" },
];

export const DATOS_PENDIENTES_SORT_COLUMN_MAP: Record<DatosPendientesColumnKey, string> = {
  id_conductor: "id_conductor",
  nombre_conductor: "nombre_conductor",
  n_servicios_30: "n_servicios_30",
  sucursal: "sucursal",
  distrito: "distrito_vive",
  turno: "turno",
  vencimiento_brevete: "vencimiento_brevete",
  vencimiento_revision_tecnica: "vencimiento_revision_tecnica",
  vencimiento_soat: "vencimiento_soat",
  tipo_contribuyente: "tipo_contribuyente",
  marcar_contabilidad: "marca_contabilidad_moobiz",
  numero_ruc_factura: "numero_ruc_factura",
  usuario_sunat: "usuario_sunat",
  clave_sol_sunat: "clave_sol_sunat",
  estado: "estado",
};

const DATOS_PENDIENTES_SORT_ALIASES: Record<string, DatosPendientesColumnKey> = {
  id_conductor: "id_conductor",
  "id conductor": "id_conductor",
  nombre_conductor: "nombre_conductor",
  "nombre conductor": "nombre_conductor",
  n_servicios_30: "n_servicios_30",
  n_servicios_lt_30: "n_servicios_30",
  "n servicios <30": "n_servicios_30",
  sucursal: "sucursal",
  distrito: "distrito",
  distrito_vive: "distrito",
  "en que distrito vive": "distrito",
  turno: "turno",
  vencimiento_brevete: "vencimiento_brevete",
  "vencimiento de brevete": "vencimiento_brevete",
  vencimiento_revision_tecnica: "vencimiento_revision_tecnica",
  "vencimiento de revisión técnica": "vencimiento_revision_tecnica",
  "vencimiento de revision tecnica": "vencimiento_revision_tecnica",
  vencimiento_soat: "vencimiento_soat",
  "vencimiento de soat": "vencimiento_soat",
  tipo_contribuyente: "tipo_contribuyente",
  "tipo de contribuyente": "tipo_contribuyente",
  marcar_contabilidad: "marcar_contabilidad",
  marca_contabilidad_moobiz: "marcar_contabilidad",
  "marcar si moobiz realiza su contabilidad": "marcar_contabilidad",
  numero_ruc_factura: "numero_ruc_factura",
  "número ruc factura": "numero_ruc_factura",
  "numero ruc factura": "numero_ruc_factura",
  usuario_sunat: "usuario_sunat",
  "usuario sunat": "usuario_sunat",
  clave_sol_sunat: "clave_sol_sunat",
  "clave sol sunat": "clave_sol_sunat",
  estado: "estado",
};

export function normalizeSortDir(raw: unknown): DatosPendientesSortDir {
  return String(raw ?? "").toLowerCase() === "asc" ? "asc" : "desc";
}

export function normalizeSortKey(raw: unknown): DatosPendientesColumnKey {
  const key = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (key in DATOS_PENDIENTES_SORT_ALIASES) return DATOS_PENDIENTES_SORT_ALIASES[key];
  return "n_servicios_30";
}

export function normalizeNulls(raw: unknown): DatosPendientesNulls | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "nullsfirst") return "nullsfirst";
  if (v === "nullslast") return "nullslast";
  return null;
}

export function parseSortByToken(rawSortBy: unknown): { sortByRaw: string; sortDirFromToken: string; nullsFromToken: string } {
  const raw = String(rawSortBy ?? "").trim();
  const [first, second, third] = raw.split(".");
  return {
    sortByRaw: (first ?? "").trim(),
    sortDirFromToken: (second ?? "").trim(),
    nullsFromToken: (third ?? "").trim(),
  };
}

export function resolveDatosPendientesSort(args: {
  rawSortBy: unknown;
  rawSortDir: unknown;
  rawNulls?: unknown;
}): {
  sortKey: DatosPendientesColumnKey;
  orderColumn: string;
  sortDir: DatosPendientesSortDir;
  nulls: DatosPendientesNulls;
  usedFallback: boolean;
} {
  const token = parseSortByToken(args.rawSortBy);
  const mapped = normalizeSortKey(token.sortByRaw || args.rawSortBy);
  const usedFallback = mapped === "n_servicios_30" && normalizeSortKey(token.sortByRaw) === "n_servicios_30" && !(
    String(token.sortByRaw || args.rawSortBy)
      .trim()
      .toLowerCase() in DATOS_PENDIENTES_SORT_ALIASES
  );
  const sortDir = normalizeSortDir(token.sortDirFromToken || args.rawSortDir);
  const nulls =
    normalizeNulls(token.nullsFromToken || args.rawNulls) ||
    (sortDir === "asc" ? "nullsfirst" : "nullslast");
  return {
    sortKey: mapped,
    orderColumn: DATOS_PENDIENTES_SORT_COLUMN_MAP[mapped],
    sortDir,
    nulls,
    usedFallback,
  };
}

export function buildPostgrestOrderClause(orderColumn: string, sortDir: DatosPendientesSortDir): string {
  return `${orderColumn}.${sortDir}`;
}

export function buildDatosPendientesQueryParams(input: {
  page: number;
  pageSize: number;
  sucursalFilter: string;
  estadoFilter: string;
  searchText: string;
  sortBy: DatosPendientesColumnKey;
  sortDir: DatosPendientesSortDir;
}): string {
  const p = new URLSearchParams();
  p.set("page", String(input.page));
  p.set("pageSize", String(input.pageSize));
  if (input.sucursalFilter && input.sucursalFilter !== "__all__") p.set("sucursal", input.sucursalFilter);
  if (input.estadoFilter && input.estadoFilter !== "__all__") p.set("estado", input.estadoFilter);
  if (input.searchText.trim()) p.set("search", input.searchText.trim());
  p.set("sortBy", input.sortBy);
  p.set("sortDir", input.sortDir);
  return p.toString();
}
