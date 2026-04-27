import { NextRequest, NextResponse } from "next/server";
import { formatApiError } from "@/lib/format-api-error";
import { assertQualityReadAccess } from "@/lib/panel-session";
import { getSupabaseAdmin } from "@/lib/quality-audit";

export const runtime = "nodejs";

const SELECT = [
  `estado:"Estado"`,
  `"Sucursal"`,
  `distrito_vive:"En que distrito vive"`,
  `"Turno"`,
  `id_conductor:"ID Conductor"`,
  `nombre_conductor:"Nombre Conductor"`,
  `"Telefono"`,
  `"Calificacion"`,
  `"GPS"`,
  `motivo_deshabilitado:"Motivo Desabilitado"`,
  `tp_vehiculo:"TP. Vehiculo"`,
  `permiso_placa:"PERMISO PLACA"`,
  `categoria_brevete:"Categoría Brevete"`,
].join(",");

type DriverViewRow = Record<string, unknown>;

function normalizeEstado(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    if (value === 1) return "Aprobado";
    if (value === 2) return "Rechazado";
    if (value === 3) return "Pendiente";
  }
  const text = String(value).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "1" || lower === "aprobado") return "Aprobado";
  if (lower === "2" || lower === "rechazado") return "Rechazado";
  if (lower === "3" || lower === "pendiente") return "Pendiente";
  return text;
}

function normalizeGps(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "Encendido" : "Apagado";
  if (typeof value === "number") {
    if (value === 1) return "Encendido";
    if (value === 0) return "Apagado";
  }
  const text = String(value).trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (["true", "t", "1", "on", "encendido", "si", "sí"].includes(lower)) return "Encendido";
  if (["false", "f", "0", "off", "apagado", "no"].includes(lower)) return "Apagado";
  return text;
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function mapRow(row: DriverViewRow): DriverViewRow {
  return {
    estado: normalizeEstado(row.estado),
    sucursal: asText(row.Sucursal),
    distrito_vive: asText(row.distrito_vive),
    turno: asText(row.Turno),
    id_conductor: asText(row.id_conductor),
    nombre_conductor: asText(row.nombre_conductor),
    telefono: asText(row.Telefono),
    calificacion: asText(row.Calificacion),
    gps: normalizeGps(row.GPS),
    motivo_deshabilitado: asText(row.motivo_deshabilitado),
    tp_vehiculo: asText(row.tp_vehiculo),
    permiso_placa: asText(row.permiso_placa),
    categoria_brevete: asText(row.categoria_brevete),
  };
}

export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const url = new URL(request.url);
    const page = Math.max(1, Number.parseInt(url.searchParams.get("page") ?? "1", 10) || 1);
    const pageSizeRaw = Number.parseInt(url.searchParams.get("pageSize") ?? "50", 10) || 50;
    const pageSize = Math.min(10000, Math.max(1, pageSizeRaw));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const supabase = getSupabaseAdmin();
    const { data, count, error } = await supabase
      .schema("vista")
      .from("vw_moobiz_drivers_excel")
      .select(SELECT, { count: "exact" })
      .range(from, to);

    if (error) throw error;
    const mapped = Array.isArray(data)
      ? data
          .filter((row) => row && typeof row === "object")
          .map((row) => mapRow(row as DriverViewRow))
      : [];

    return NextResponse.json({
      data: mapped,
      total: count ?? 0,
      page,
      pageSize,
    });
  } catch (error) {
    const message = formatApiError(error);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message, data: [], total: 0 }, { status });
  }
}
