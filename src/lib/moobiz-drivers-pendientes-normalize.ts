export type DriverPendienteRow = Record<string, unknown>;

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
