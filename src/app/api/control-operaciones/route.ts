import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import { mapExcelRowToControlDriver, type ControlDriverExcelRow } from "@/lib/control-operaciones-map";
import { semanaLabelLiquidaciones } from "@/lib/control-operaciones-semana";
import { normalizeConductorName } from "@/lib/gps-filter";
import { assertQualityReadAccess, assertQualityWriteAccess } from "@/lib/panel-session";
import { getSupabaseAdmin } from "@/lib/quality-audit";

export const runtime = "nodejs";

const EXCEL_PAGE = 2500;
const VIAJES_PAGE = 5000;

function pickSemaforo(row: Record<string, unknown>): string {
  const v = row.Semaforo ?? row.semaforo ?? row.SEMAFORO;
  return v === null || v === undefined ? "" : String(v).trim();
}

function pickIdConductorLiq(row: Record<string, unknown>): string {
  const v = row.id_conductor ?? row.ID_Conductor ?? row["id conductor"];
  return v === null || v === undefined ? "" : String(v).trim();
}

function pickSemanaLabel(row: Record<string, unknown>): string {
  const v = row.semana_label ?? row.SEMANA_LABEL ?? row["semana_label"];
  return v === null || v === undefined ? "" : String(v).trim();
}

async function fetchAllExcelDrivers(): Promise<ControlDriverExcelRow[]> {
  const sb = getSupabaseAdmin();
  const out: ControlDriverExcelRow[] = [];
  for (let from = 0; ; from += EXCEL_PAGE) {
    const { data, error } = await sb
      .schema("vista")
      .from("vw_moobiz_drivers_excel")
      .select("*")
      .range(from, from + EXCEL_PAGE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const m = mapExcelRowToControlDriver(raw as Record<string, unknown>);
      if (m) out.push(m);
    }
    if (rows.length < EXCEL_PAGE) break;
  }
  return out;
}

async function fetchViajesActivosCounts(): Promise<Record<string, number>> {
  const sb = getSupabaseAdmin();
  const counts = new Map<string, number>();
  for (let from = 0; ; from += VIAJES_PAGE) {
    const { data, error } = await sb
      .from("viajes_activos")
      .select("conductor")
      .range(from, from + VIAJES_PAGE - 1);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    for (const r of rows) {
      if (!r || typeof r !== "object") continue;
      const c = (r as { conductor?: unknown }).conductor;
      const name = c === null || c === undefined ? "" : String(c).trim();
      if (!name) continue;
      const key = normalizeConductorName(name);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    if (rows.length < VIAJES_PAGE) break;
  }
  return Object.fromEntries(counts.entries());
}

async function fetchLiquidacionesSemaforoByConductor(
  semanaLabel: string,
  ids: string[],
): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const sb = getSupabaseAdmin();
  const map: Record<string, string> = {};
  const chunk = 200;
  for (let i = 0; i < ids.length; i += chunk) {
    const slice = ids.slice(i, i + chunk);
    const { data, error } = await sb
      .schema("reportes")
      .from("liquidaciones_conductores")
      .select("*")
      .in("id_conductor", slice);
    if (error) throw error;
    const rows = Array.isArray(data) ? data : [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const id = pickIdConductorLiq(row);
      if (!id) continue;
      const sl = pickSemanaLabel(row);
      if (!sl || sl !== semanaLabel) continue;
      const sem = pickSemaforo(row);
      if (sem) map[String(id)] = sem;
    }
  }
  return map;
}

async function fetchOperatorsActivos(): Promise<{ value: string; label: string }[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb.schema("vista").from("vw_moobiz_operators").select("*").limit(5000);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const out: { value: string; label: string }[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const estado = String(row.Estado ?? row.estado ?? "").trim().toLowerCase();
    if (estado !== "activo") continue;
    const name = String(row.name ?? row.Name ?? row.nombre ?? "").trim();
    if (!name) continue;
    out.push({ value: name, label: name });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, "es"));
  return out;
}

async function fetchControlRows(): Promise<
  { id_conductor: string; solicitante: string | null; observacion: string | null }[]
> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("control_operaciones")
    .select("id_conductor, solicitante, observacion")
    .limit(50000);
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  return rows
    .filter((r) => r && typeof r === "object")
    .map((r) => {
      const o = r as Record<string, unknown>;
      const id = String(o.id_conductor ?? "").trim();
      if (!id) return null;
      return {
        id_conductor: id,
        solicitante: o.solicitante == null || o.solicitante === "" ? null : String(o.solicitante),
        observacion: o.observacion == null || o.observacion === "" ? null : String(o.observacion),
      };
    })
    .filter(Boolean) as { id_conductor: string; solicitante: string | null; observacion: string | null }[];
}

/** GET ?partial=control — solo filas de `control_operaciones` (polling). */
export async function GET(request: NextRequest) {
  try {
    assertQualityReadAccess(request);
    const url = new URL(request.url);
    if (url.searchParams.get("partial") === "control") {
      const controlRows = await fetchControlRows();
      const controlById: Record<string, { solicitante: string | null; observacion: string | null }> = {};
      for (const r of controlRows) {
        controlById[r.id_conductor] = { solicitante: r.solicitante, observacion: r.observacion };
      }
      return NextResponse.json({
        semanaLabel: semanaLabelLiquidaciones(),
        controlById,
      });
    }

    if (url.searchParams.get("partial") === "viajes") {
      const viajesCounts = await fetchViajesActivosCounts();
      return NextResponse.json({ viajesCounts });
    }

    const [drivers, controlRows, operatorOptions, viajesCounts] = await Promise.all([
      fetchAllExcelDrivers(),
      fetchControlRows(),
      fetchOperatorsActivos(),
      fetchViajesActivosCounts(),
    ]);

    const controlById: Record<string, { solicitante: string | null; observacion: string | null }> = {};
    for (const r of controlRows) {
      controlById[r.id_conductor] = { solicitante: r.solicitante, observacion: r.observacion };
    }

    const semanaLabel = semanaLabelLiquidaciones();
    const ids = drivers.map((d) => d.id_conductor);
    const semaforoById = await fetchLiquidacionesSemaforoByConductor(semanaLabel, ids);

    const rows = drivers.map((d) => {
      const key = normalizeConductorName(d.nombre_conductor);
      const serviciosActivos = viajesCounts[key] ?? 0;
      return {
        ...d,
        servicios_activos: serviciosActivos,
        semaforo: semaforoById[d.id_conductor] ?? null,
      };
    });

    const semaforoOptions = Array.from(
      new Set(
        Object.values(semaforoById)
          .map((s) => String(s).trim())
          .filter(Boolean),
      ),
    ).sort((a, b) => a.localeCompare(b, "es"));

    return NextResponse.json({
      drivers: rows,
      controlById,
      operatorOptions,
      semanaLabel,
      semaforoOptions,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    const message = formatApiError(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}

type UpsertBody = {
  rows?: { id_conductor: string; solicitante?: string | null; observacion?: string | null }[];
};

export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const body = (await request.json()) as UpsertBody;
    const rows = Array.isArray(body.rows) ? body.rows : [];
    if (rows.length === 0) {
      return NextResponse.json({ error: "rows vacío" }, { status: 400 });
    }
    if (rows.length > 500) {
      return NextResponse.json({ error: "Máximo 500 filas por solicitud" }, { status: 400 });
    }

    const payload = rows
      .map((r) => {
        const id = String(r.id_conductor ?? "").trim();
        if (!id) return null;
        const norm = (v: unknown) => {
          if (v === undefined) return null;
          if (v === null) return null;
          const s = String(v).trim();
          return s.length ? s : null;
        };
        return {
          id_conductor: id,
          solicitante: norm(r.solicitante),
          observacion: norm(r.observacion),
        };
      })
      .filter(Boolean) as { id_conductor: string; solicitante: string | null; observacion: string | null }[];

    const sb = getSupabaseAdmin();
    const { error } = await sb.from("control_operaciones").upsert(payload, {
      onConflict: "id_conductor",
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, upserted: payload.length });
  } catch (err) {
    const message = formatApiError(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
