import { createClient } from "@supabase/supabase-js";
import { SCHEDULE_CRITICAL_PRODUCTS, SCHEDULE_OTHER_KEY } from "@/lib/product-categories";

export const runtime = "nodejs";

const PENDING_STATUS = "pendiente";

type ServicesMaestraRow = {
  id?: string | number | null;
  co_name?: string | null;
  state_color_name?: string | null;
  alt_date?: string | null;
  pr_name?: string | null;
  zona?: string | null;
};

type PendingChartRow = {
  id: string | number;
  empresa: string | null;
  estado: string | null;
  fecha: string | null;
  fecha_registro: string | null;
  producto: string | null;
  zona: string | null;
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

function normalizeStatus(value: unknown): string {
  return toText(value).toLowerCase();
}

function parseDateFromRow(row: PendingChartRow): Date | null {
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

function floorToHourStart(date: Date): Date {
  const d = new Date(date.getTime());
  d.setMinutes(0, 0, 0);
  d.setMilliseconds(0);
  return d;
}

function formatScheduleSlotLabel(date: Date): string {
  return date.toLocaleString("es-PE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function buildPendingByScheduleSlots(rows: PendingChartRow[]): Array<{ etiqueta: string; total: number }> {
  const timestamps: number[] = [];
  for (const row of rows) {
    const d = parseDateFromRow(row);
    if (d) timestamps.push(d.getTime());
  }
  if (timestamps.length === 0) return [];

  const minMs = Math.min(...timestamps);
  const maxMs = Math.max(...timestamps);
  const slotStart = floorToHourStart(new Date(minMs));
  const slotEnd = floorToHourStart(new Date(maxMs));
  const HOUR_MS = 60 * 60 * 1000;

  const buckets: Array<{ etiqueta: string; total: number }> = [];
  for (let t = slotStart.getTime(); t <= slotEnd.getTime(); t += HOUR_MS) {
    const bucketStart = t;
    const bucketEnd = t + HOUR_MS;
    let total = 0;
    for (const row of rows) {
      const d = parseDateFromRow(row);
      if (!d) continue;
      const ms = d.getTime();
      if (ms >= bucketStart && ms < bucketEnd) total += 1;
    }
    buckets.push({
      etiqueta: formatScheduleSlotLabel(new Date(bucketStart)),
      total,
    });
  }
  return buckets;
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
    const empresaParam = toText(requestUrl.searchParams.get("empresa"));

    const startDate = startDateParam ? new Date(`${startDateParam}T00:00:00`) : null;
    const endDate = endDateParam ? new Date(`${endDateParam}T23:59:59`) : null;

    const supabase = getSupabaseClient();
    let query = supabase
      .schema("vista")
      .from("moobiz_services_maestra")
      .select("id, state_color_name, alt_date, pr_name, co_name, zona")
      .ilike("state_color_name", PENDING_STATUS);

    if (startDateParam) {
      query = query.gte("alt_date", `${startDateParam}T00:00:00`);
    }
    if (endDateParam) {
      query = query.lte("alt_date", `${endDateParam}T23:59:59`);
    }
    if (empresaParam && empresaParam !== "Todas") {
      query = query.eq("co_name", empresaParam);
    }

    const { data, error } = await query.order("alt_date", { ascending: true });
    if (error) return Response.json({ error: error.message }, { status: 500 });

    const rawRows = (data ?? []) as ServicesMaestraRow[];
    const pendingRows: PendingChartRow[] = rawRows.map((row, index) => ({
      id: row.id ?? `row-${index}`,
      empresa: toText(row.co_name) || null,
      estado: toText(row.state_color_name) || null,
      fecha: toText(row.alt_date) || null,
      fecha_registro: null,
      producto: toText(row.pr_name) || null,
      zona: toText(row.zona) || null,
    }));

    const filteredPending = pendingRows.filter((row) => {
      const empresa = toText(row.empresa);
      const date = parseDateFromRow(row);
      const empresaOk = !empresaParam || empresaParam === "Todas" || empresa === empresaParam;
      const dateOk = inDateRange(date, startDate, endDate);
      return empresaOk && dateOk && normalizeStatus(row.estado) === PENDING_STATUS;
    });

    const pendingBySchedule = buildPendingByScheduleSlots(filteredPending);
    const pendingByEmpresaMap = new Map<string, number>();
    for (const row of filteredPending) {
      const empresa = toText(row.empresa) || "Sin empresa";
      pendingByEmpresaMap.set(empresa, (pendingByEmpresaMap.get(empresa) ?? 0) + 1);
    }
    const pendingByEmpresa = Array.from(pendingByEmpresaMap.entries())
      .map(([empresa, total]) => ({ empresa, total }))
      .sort((a, b) => b.total - a.total);

    const empresas = Array.from(new Set(rawRows.map((row) => toText(row.co_name)).filter(Boolean))).sort();
    const productos = [...SCHEDULE_CRITICAL_PRODUCTS, SCHEDULE_OTHER_KEY];

    return Response.json({
      data: filteredPending,
      kpi: { totalPendientes: filteredPending.length },
      charts: {
        estadoDistribution: [{ estado: "Pendiente", total: filteredPending.length }],
        pendingByEmpresa,
        pendingBySchedule,
        pendingDailyByEmpresa: [],
        topOrigens: [],
        topDestinos: [],
      },
      filters: { empresas, productos },
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error inesperado en /api/dashboard-v2/reservas";
    return Response.json({ error: message }, { status: 500 });
  }
}
