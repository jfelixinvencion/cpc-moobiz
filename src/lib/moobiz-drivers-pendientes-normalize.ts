export type DriverPendienteRow = Record<string, unknown>;

/** Nombres de columna tal como los devuelve PostgREST para `vista.vw_moobiz_drivers_pendientes` con `select('*')`. */
export const VISTA_MOOBIZ_DRIVERS_PENDIENTES_LABELS = {
  id_conductor: "ID Conductor",
  nombre_conductor: "Nombre Conductor",
  global: "GLOBAL",
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
} as const;

/** Convierte una fila de la vista (claves legibles) al shape que consume `normalizeDriverPendienteRow`. */
export function mapVistaMoobizDriversPendientesRow(row: Record<string, unknown>): Record<string, unknown> {
  const g = (label: string) => row[label];
  const L = VISTA_MOOBIZ_DRIVERS_PENDIENTES_LABELS;
  return {
    id_conductor: g(L.id_conductor),
    nombre_conductor: g(L.nombre_conductor),
    global: g(L.global),
    n_servicios_lt_30: g(L.n_servicios_lt_30),
    sucursal: g(L.sucursal),
    distrito_vive: g(L.distrito_vive),
    turno: g(L.turno),
    vencimiento_brevete: g(L.vencimiento_brevete),
    vencimiento_revision_tecnica: g(L.vencimiento_revision_tecnica),
    vencimiento_soat: g(L.vencimiento_soat),
    tipo_contribuyente: g(L.tipo_contribuyente),
    marca_contabilidad_moobiz: g(L.marca_contabilidad_moobiz),
    numero_ruc_factura: g(L.numero_ruc_factura),
    usuario_sunat: g(L.usuario_sunat),
    clave_sol_sunat: g(L.clave_sol_sunat),
    estado: g(L.estado) ?? g("Status"),
  };
}

export function normalizeDriverPendienteRowsFromVistaLabels(data: unknown): DriverPendienteRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) =>
    normalizeDriverPendienteRow(
      item && typeof item === "object" ? mapVistaMoobizDriversPendientesRow(item as Record<string, unknown>) : {},
    ),
  );
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function toNullableText(value: unknown): string | null {
  const s = toText(value).trim();
  return s.length > 0 ? s : null;
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function normalizeDriverPendienteRow(raw: unknown): DriverPendienteRow {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    id_conductor: toNullableText(obj.id_conductor),
    nombre_conductor: toNullableText(obj.nombre_conductor),
    global: toNullableText(obj.global),
    n_servicios_lt_30: toNullableNumber(obj.n_servicios_lt_30) ?? 0,
    sucursal: toNullableText(obj.sucursal),
    distrito_vive: toNullableText(obj.distrito_vive),
    turno: toNullableText(obj.turno),
    vencimiento_brevete: toNullableText(obj.vencimiento_brevete),
    vencimiento_revision_tecnica: toNullableText(obj.vencimiento_revision_tecnica),
    vencimiento_soat: toNullableText(obj.vencimiento_soat),
    tipo_contribuyente: toNullableText(obj.tipo_contribuyente),
    marca_contabilidad_moobiz: toNullableText(obj.marca_contabilidad_moobiz),
    numero_ruc_factura: toNullableText(obj.numero_ruc_factura),
    usuario_sunat: toNullableText(obj.usuario_sunat),
    clave_sol_sunat: toNullableText(obj.clave_sol_sunat),
    estado: toNullableText(obj.estado),
  };
}

export function normalizeDriverPendienteRows(data: unknown): DriverPendienteRow[] {
  if (!Array.isArray(data)) return [];
  return data.map((item) => normalizeDriverPendienteRow(item));
}

export function normalizeCount(count: unknown): number {
  const n = Number(count);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}
