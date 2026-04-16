import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const TABLE_NAME = "viajes_activos";
const PENDING_STATUS = "pendiente";

type ViajeRow = {
  id: string | number | null;
  empresa?: string | null;
  usuario?: string | null;
  conductor?: string | null;
  estado?: string | null;
  pasajero?: string | null;
  fecha?: string | null;
  fecha_registro?: string | null;
  producto?: string | null;
  monto?: number | string | null;
  origen?: string | null;
  destino?: string | null;
  operador?: string | null;
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

function parseDateFromRow(row: ViajeRow): Date | null {
  const candidate = toText(row.fecha) || toText(row.fecha_registro);
  if (!candidate) return null;

  const isoTry = new Date(candidate);
  if (!Number.isNaN(isoTry.getTime())) return isoTry;

  // DD/MM/YYYY o DD-MM-YYYY (con hora opcional)
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

/** Franjas horarias desde la primera hora de programación hasta la última (viajes pendientes filtrados). */
function buildPendingByScheduleSlots(rows: ViajeRow[]): Array<{ etiqueta: string; total: number }> {
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

function toDayKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    const scope = requestUrl.searchParams.get("scope");
    const startDateParam = requestUrl.searchParams.get("startDate");
    const endDateParam = requestUrl.searchParams.get("endDate");
    const empresaParam = toText(requestUrl.searchParams.get("empresa"));

    const startDate = startDateParam ? new Date(`${startDateParam}T00:00:00`) : null;
    const endDate = endDateParam ? new Date(`${endDateParam}T23:59:59`) : null;

    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select(
        "id, empresa, usuario, conductor, estado, pasajero, fecha, fecha_registro, producto, monto, origen, destino, operador",
      )
      .order("id", { ascending: false });

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    const rows = (data ?? []) as ViajeRow[];

    if (scope === "all") {
      return Response.json({ data: rows });
    }

    /** Viajes con conductor asignado (pendiente sin conductor no entra por falta de conductor). */
    if (scope === "matrixRows") {
      const matrixRows = rows.filter((row) => {
        const conductor = toText(row.conductor);
        if (!conductor) return false;
        const empresa = toText(row.empresa);
        const date = parseDateFromRow(row);
        const empresaOk = !empresaParam || empresaParam === "Todas" || empresa === empresaParam;
        const dateOk = inDateRange(date, startDate, endDate);
        return empresaOk && dateOk;
      });
      return Response.json({ data: matrixRows });
    }

    const estadosMap = new Map<string, number>();
    for (const row of rows) {
      const estado = toText(row.estado) || "Sin estado";
      estadosMap.set(estado, (estadosMap.get(estado) ?? 0) + 1);
    }

    const pendingRows = rows.filter((row) => normalizeStatus(row.estado) === PENDING_STATUS);
    const filteredPending = pendingRows.filter((row) => {
      const empresa = toText(row.empresa);
      const date = parseDateFromRow(row);
      const empresaOk = !empresaParam || empresaParam === "Todas" || empresa === empresaParam;
      const dateOk = inDateRange(date, startDate, endDate);
      return empresaOk && dateOk;
    });

    const pendingByEmpresaMap = new Map<string, number>();
    const pendingDailyByEmpresaMap = new Map<string, Record<string, number>>();
    const originMap = new Map<string, number>();
    const destinationMap = new Map<string, number>();

    for (const row of filteredPending) {
      const empresa = toText(row.empresa) || "Sin empresa";
      pendingByEmpresaMap.set(empresa, (pendingByEmpresaMap.get(empresa) ?? 0) + 1);

      const rowDate = parseDateFromRow(row);
      if (rowDate) {
        const day = toDayKey(rowDate);
        const dayBucket = pendingDailyByEmpresaMap.get(day) ?? {};
        dayBucket[empresa] = (dayBucket[empresa] ?? 0) + 1;
        pendingDailyByEmpresaMap.set(day, dayBucket);
      }

      const origen = toText(row.origen) || "Sin origen";
      originMap.set(origen, (originMap.get(origen) ?? 0) + 1);

      const destino = toText(row.destino) || "Sin destino";
      destinationMap.set(destino, (destinationMap.get(destino) ?? 0) + 1);
    }

    const estadoDistribution = Array.from(estadosMap.entries())
      .map(([estado, total]) => ({ estado, total }))
      .sort((a, b) => b.total - a.total);

    const pendingByEmpresa = Array.from(pendingByEmpresaMap.entries())
      .map(([empresa, total]) => ({ empresa, total }))
      .sort((a, b) => b.total - a.total);

    const pendingBySchedule = buildPendingByScheduleSlots(filteredPending);

    const pendingDailyByEmpresa = Array.from(pendingDailyByEmpresaMap.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([fecha, empresas]) => ({ fecha, ...empresas }));

    const topOrigens = Array.from(originMap.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const topDestinos = Array.from(destinationMap.entries())
      .map(([label, total]) => ({ label, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 10);

    const empresas = Array.from(
      new Set(rows.map((row) => toText(row.empresa)).filter(Boolean)),
    ).sort();

    return Response.json({
      data: filteredPending,
      kpi: { totalPendientes: filteredPending.length },
      charts: {
        estadoDistribution,
        pendingByEmpresa,
        pendingBySchedule,
        pendingDailyByEmpresa,
        topOrigens,
        topDestinos,
      },
      filters: { empresas },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error inesperado en /api/viajes";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = (await request.json()) as { ids?: unknown };
    const ids = Array.isArray(body?.ids)
      ? body.ids.map((value) => String(value).trim()).filter(Boolean)
      : [];

    if (ids.length === 0) {
      return Response.json({ error: "Debes enviar un arreglo de IDs." }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const { error } = await supabase.from(TABLE_NAME).delete().in("id", ids);

    if (error) {
      return Response.json({ error: error.message }, { status: 500 });
    }

    return Response.json({ deleted: ids.length });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Error inesperado eliminando viajes";
    return Response.json({ error: message }, { status: 500 });
  }
}
