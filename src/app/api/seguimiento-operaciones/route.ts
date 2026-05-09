import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

/** Vista en esquema `vista` (PostgREST debe exponer `vista` en Settings → API). */
const SCHEMA = "vista";
const VIEW = "moobiz_services_maestra";

/** Columnas crudas que devuelve la vista para esta gráfica. */
type MoobizServicesRow = {
  id: string | number | null;
  dr_id?: string | number | null;
  Conductor: string | null;
  cl_name?: string | null;
  cl_surname?: string | null;
  alt_date: string | null;
  synced_at: string | null;
  state_color_name: string | null;
  co_name: string | null;
  pr_name: string | null;
  org_lat?: unknown;
  org_lng?: unknown;
  dst_zone?: string | null;
  org_address?: string | null;
  prioridad_mapa?: unknown;
};

/** Shape compatible con el componente `SeguimientoOperaciones` (idéntico al de `ViajeRow`). */
type ViajeRow = {
  id: string | number | null;
  empresa: string;
  usuario: string;
  conductor: string;
  estado: string;
  pasajero: string;
  fecha: string;
  fecha_registro: string;
  producto: string;
  monto: string;
  origen: string;
  destino: string;
  operador: string;
};

/** Shape JSON hacia el cliente (campos extra para mapa / Moobiz). */
type SeguimientoOperacionesRow = ViajeRow & {
  dr_id: string | number | null;
  org_lat: number | null;
  org_lng: number | null;
  dst_zone: string;
  org_address: string;
  prioridad_mapa: number | null;
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

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * Parser idéntico al de `/api/viajes` y al del componente: prioriza `fecha`,
 * y soporta tanto ISO como `DD/MM/YYYY[ HH:mm[:ss] [a.m./p.m.]]`.
 */
function parseDateFromMapped(row: ViajeRow): Date | null {
  const candidate = toText(row.fecha) || toText(row.fecha_registro);
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

function inDateRange(date: Date | null, start: Date | null, end: Date | null): boolean {
  if (!date) return false;
  if (start && date < start) return false;
  if (end && date > end) return false;
  return true;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const requestUrl = new URL(request.url);
    const startDateParam = requestUrl.searchParams.get("startDate");
    const endDateParam = requestUrl.searchParams.get("endDate");

    const startDate = startDateParam ? new Date(`${startDateParam}T00:00:00`) : null;
    const endDate = endDateParam ? new Date(`${endDateParam}T23:59:59`) : null;

    const supabase = getSupabaseClient();
    const baseSelect =
      'id, dr_id, "Conductor", alt_date, synced_at, state_color_name, co_name, pr_name, org_lat, org_lng, dst_zone, org_address, prioridad_mapa';
    const fullSelect = `${baseSelect}, cl_name, cl_surname`;

    /** Intenta primero con `cl_name`/`cl_surname`; si la vista no los expone, vuelve al select base. */
    let data: MoobizServicesRow[] | null = null;
    {
      const first = await supabase
        .schema(SCHEMA)
        .from(VIEW)
        .select(fullSelect)
        .order("id", { ascending: false });
      if (!first.error) {
        data = (first.data ?? []) as unknown as MoobizServicesRow[];
      } else {
        console.warn(
          "[seguimiento-operaciones] select con cl_name/cl_surname falló, fallback sin esos campos:",
          first.error.message,
        );
        const second = await supabase
          .schema(SCHEMA)
          .from(VIEW)
          .select(baseSelect)
          .order("id", { ascending: false });
        if (second.error) {
          console.error("[seguimiento-operaciones] Supabase select error:", second.error.message);
          return Response.json({ error: second.error.message }, { status: 500 });
        }
        data = (second.data ?? []) as unknown as MoobizServicesRow[];
      }
    }

    const rawRows = data ?? [];

    const mappedRows: SeguimientoOperacionesRow[] = rawRows.map((row) => ({
      id: row.id,
      conductor: toText(row.Conductor),
      fecha: toText(row.alt_date),
      fecha_registro: toText(row.synced_at),
      estado: toText(row.state_color_name),
      empresa: toText(row.co_name),
      producto: toText(row.pr_name),
      usuario: [toText(row.cl_name), toText(row.cl_surname)].filter(Boolean).join(" "),
      pasajero: "",
      monto: "",
      origen: "",
      destino: "",
      operador: "",
      dr_id: row.dr_id ?? null,
      org_lat: asNumber(row.org_lat),
      org_lng: asNumber(row.org_lng),
      dst_zone: toText(row.dst_zone),
      org_address: toText(row.org_address),
      prioridad_mapa: asNumber(row.prioridad_mapa),
    }));

    /** Filas con conductor y fecha dentro del rango (sin filtro por empresa ni producto). */
    const matrixRows = mappedRows.filter((row) => {
      if (!row.conductor) return false;
      const date = parseDateFromMapped(row);
      return inDateRange(date, startDate, endDate);
    });

    return Response.json({ data: matrixRows });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Error inesperado en /api/seguimiento-operaciones";
    return Response.json({ error: message }, { status: 500 });
  }
}
