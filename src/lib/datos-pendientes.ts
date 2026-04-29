export type DatosPendientesColumnKey =
  | "id_conductor"
  | "nombre_conductor"
  | "n_servicios_lt_30"
  | "sucursal"
  | "distrito_vive"
  | "turno"
  | "vencimiento_brevete"
  | "vencimiento_revision_tecnica"
  | "vencimiento_soat"
  | "tipo_contribuyente"
  | "marca_contabilidad_moobiz"
  | "numero_ruc_factura"
  | "usuario_sunat"
  | "clave_sol_sunat"
  | "estado";

export type DatosPendientesSortDir = "asc" | "desc";

export const DATOS_PENDIENTES_COLUMNS: Array<{ key: DatosPendientesColumnKey; label: string }> = [
  { key: "id_conductor", label: "ID Conductor" },
  { key: "nombre_conductor", label: "Nombre Conductor" },
  { key: "n_servicios_lt_30", label: "N Servicios <30" },
  { key: "sucursal", label: "Sucursal" },
  { key: "distrito_vive", label: "En que distrito vive" },
  { key: "turno", label: "Turno" },
  { key: "vencimiento_brevete", label: "Vencimiento de Brevete" },
  { key: "vencimiento_revision_tecnica", label: "Vencimiento de Revisión Técnica" },
  { key: "vencimiento_soat", label: "Vencimiento de SOAT" },
  { key: "tipo_contribuyente", label: "Tipo de Contribuyente" },
  { key: "marca_contabilidad_moobiz", label: "Marcar si Moobiz realiza su contabilidad" },
  { key: "numero_ruc_factura", label: "Número Ruc Factura" },
  { key: "usuario_sunat", label: "Usuario Sunat" },
  { key: "clave_sol_sunat", label: "Clave Sol Sunat" },
  { key: "estado", label: "Estado" },
];

export const DATOS_PENDIENTES_SORT_COLUMN_MAP: Record<DatosPendientesColumnKey, string> = {
  id_conductor: "ID Conductor",
  nombre_conductor: "Nombre Conductor",
  n_servicios_lt_30: "N Servicios <30",
  sucursal: "Sucursal",
  distrito_vive: "En que distrito vive",
  turno: "Turno",
  vencimiento_brevete: "Vencimiento de Brevete",
  vencimiento_revision_tecnica: "Vencimiento de Revisión Técnica",
  vencimiento_soat: "Vencimiento de SOAT",
  tipo_contribuyente: "Tipo de Contribuyente",
  marca_contabilidad_moobiz: "Marcar si Moobiz realiza su contabilidad",
  numero_ruc_factura: "Número Ruc Factura",
  usuario_sunat: "Usuario Sunat",
  clave_sol_sunat: "Clave Sol Sunat",
  estado: "Estado",
};

export function normalizeSortDir(raw: unknown): DatosPendientesSortDir {
  return String(raw ?? "").toLowerCase() === "asc" ? "asc" : "desc";
}

export function normalizeSortKey(raw: unknown): DatosPendientesColumnKey {
  const key = String(raw ?? "").trim() as DatosPendientesColumnKey;
  if (DATOS_PENDIENTES_COLUMNS.some((c) => c.key === key)) return key;
  return "n_servicios_lt_30";
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
