import { createClient } from "@supabase/supabase-js";

import {
  buildSummaryFromServices,
  parseServiceDate,
  toText,
  UNKNOWN_COMPANY_ID,
} from "@/lib/clientes-operaciones-map";
import type {
  ClientesOperacionesApiResponse,
  ClientesOperacionesServiceRow,
} from "@/lib/clientes-operaciones-types";

export const runtime = "nodejs";

const SCHEMA = "vista";
const VIEW = "moobiz_services_maestra";

type MoobizServicesRow = {
  id: string | number | null;
  dr_id?: string | number | null;
  Conductor?: string | null;
  co_id?: string | number | null;
  co_name?: string | null;
  alt_date?: string | null;
  synced_at?: string | null;
  state_color_name?: string | null;
  pr_name?: string | null;
};

function getEnvTrimmed(keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function getSupabaseClient() {
  const supabaseUrl = getEnvTrimmed(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const serviceRoleKey = getEnvTrimmed(["SUPABASE_SERVICE_ROLE_KEY"]);
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "Faltan variables de entorno para Supabase: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.",
    );
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function inDateRange(date: Date | null, start: Date | null, end: Date | null): boolean {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

function normalizeCoId(raw: unknown): string {
  const s = toText(raw);
  return s || UNKNOWN_COMPANY_ID;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const requestUrl = new URL(request.url);
    const startDateParam =
      requestUrl.searchParams.get("fecha_desde") ??
      requestUrl.searchParams.get("startDate");
    const endDateParam =
      requestUrl.searchParams.get("fecha_hasta") ?? requestUrl.searchParams.get("endDate");

    const startDate = startDateParam ? new Date(`${startDateParam}T00:00:00`) : null;
    const endDate = endDateParam ? new Date(`${endDateParam}T23:59:59`) : null;

    const supabase = getSupabaseClient();
    const baseSelect =
      'id, dr_id, "Conductor", co_id, co_name, alt_date, synced_at, state_color_name, pr_name';

    let data: MoobizServicesRow[] | null = null;
    const first = await supabase
      .schema(SCHEMA)
      .from(VIEW)
      .select(baseSelect)
      .order("id", { ascending: false });

    if (!first.error) {
      data = (first.data ?? []) as unknown as MoobizServicesRow[];
    } else {
      console.warn("[clientes-operaciones] select error:", first.error.message);
      return Response.json({ error: first.error.message }, { status: 500 });
    }

    const mapped: ClientesOperacionesServiceRow[] = [];
    for (const row of data ?? []) {
      const co_id = normalizeCoId(row.co_id);
      const co_name = toText(row.co_name) || (co_id !== UNKNOWN_COMPANY_ID ? "" : "Sin empresa");
      if (!co_name && co_id === UNKNOWN_COMPANY_ID) continue;

      const fecha = toText(row.alt_date);
      const fecha_registro = toText(row.synced_at);
      const serviceRow: ClientesOperacionesServiceRow = {
        id: row.id,
        co_id,
        co_name: co_name || `Empresa ${co_id}`,
        estado: toText(row.state_color_name) || "Sin estado",
        fecha,
        fecha_registro,
        dr_id: row.dr_id != null && toText(row.dr_id) !== "" ? toText(row.dr_id) : null,
        producto: toText(row.pr_name),
      };

      const date = parseServiceDate(serviceRow.fecha, serviceRow.fecha_registro);
      if (!inDateRange(date, startDate, endDate)) continue;

      mapped.push(serviceRow);
    }

    const body: ClientesOperacionesApiResponse = {
      data: mapped,
      summary: buildSummaryFromServices(mapped),
    };

    return Response.json(body);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error inesperado en /api/clientes-operaciones";
    return Response.json({ error: message }, { status: 500 });
  }
}
