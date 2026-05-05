import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import { mapExcelRowToControlDriver, type ControlDriverExcelRow } from "@/lib/control-operaciones-map";
import { semanaLabelLiquidaciones } from "@/lib/control-operaciones-semana";
import { normalizeConductorName } from "@/lib/gps-filter";
import { assertQualityReadAccess, assertQualityWriteAccess } from "@/lib/panel-session";
import { getSupabaseAdmin } from "@/lib/quality-audit";

export const runtime = "nodejs";

/** Columnas mínimas de la vista (alias PostgREST → mapExcelRowToControlDriver). */
const DRIVER_SELECT = [
  `id_conductor:"ID Conductor"`,
  `nombre_conductor:"Nombre Conductor"`,
  `distrito_vive:"En que distrito vive"`,
  `turno:"Turno"`,
  `global_col:GLOBAL`,
  `estado_conductor_col:"Estado Conductor"`,
  `estado:"Estado"`,
  `status_col:"Status"`,
  `online_col:"Online"`,
  `gps_col:"GPS"`,
].join(",");

const DRIVERS_INTERNAL_CHUNK = 150;
const MAX_NAMES_VIAJES = 250;
const CONTROL_LIMIT = 50_000;

function nowMs(): number {
  return Date.now();
}

function logBlock(label: string, t0: number): number {
  const ms = Date.now() - t0;
  console.log(`[control-operaciones][timing] ${label}: ${ms}ms`);
  return ms;
}

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

async function fetchDriversPage(
  page: number,
  pageSize: number,
): Promise<{ drivers: ControlDriverExcelRow[]; total: number }> {
  const sb = getSupabaseAdmin();
  const safePage = Math.max(1, page);
  const safeSize = Math.max(1, pageSize);
  const from = (safePage - 1) * safeSize;
  const to = from + safeSize - 1;

  let result = await sb
    .schema("vista")
    .from("vw_moobiz_drivers_excel")
    .select(DRIVER_SELECT, { count: "exact" })
    .eq("Estado Conductor", "Aprobado")
    .range(from, to);

  if (result.error) {
    console.warn("[control-operaciones] DRIVER_SELECT explícito falló, fallback select(*):", result.error.message);
    result = await sb
      .schema("vista")
      .from("vw_moobiz_drivers_excel")
      .select("*", { count: "exact" })
      .eq("Estado Conductor", "Aprobado")
      .range(from, to);
  }

  const { data, count, error } = result;
  if (error) throw error;
  const rows = Array.isArray(data) ? data : [];
  const drivers: ControlDriverExcelRow[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const m = mapExcelRowToControlDriver(raw as Record<string, unknown>);
    if (m && m.estado_conductor === "Aprobado") drivers.push(m);
  }
  const total = typeof count === "number" && Number.isFinite(count) ? count : drivers.length;
  return { drivers, total };
}

async function fetchAllApprovedDrivers(): Promise<{ drivers: ControlDriverExcelRow[]; total: number }> {
  const all: ControlDriverExcelRow[] = [];
  let page = 1;
  let total = 0;
  for (;;) {
    const { drivers, total: t } = await fetchDriversPage(page, DRIVERS_INTERNAL_CHUNK);
    if (page === 1) total = t;
    all.push(...drivers);
    if (drivers.length < DRIVERS_INTERNAL_CHUNK) break;
    page += 1;
  }
  return { drivers: all, total };
}

async function fetchViajesCountsForExactConductorNames(names: string[]): Promise<Record<string, number>> {
  const sb = getSupabaseAdmin();
  const counts = new Map<string, number>();
  const uniq = [...new Set(names.map((n) => String(n).trim()).filter(Boolean))].slice(0, MAX_NAMES_VIAJES);
  const chunk = 80;
  for (let i = 0; i < uniq.length; i += chunk) {
    const part = uniq.slice(i, i + chunk);
    if (part.length === 0) continue;
    const { data, error } = await sb.from("viajes_activos").select("conductor").in("conductor", part);
    if (error) throw error;
    for (const raw of data || []) {
      if (!raw || typeof raw !== "object") continue;
      const c = String((raw as { conductor?: unknown }).conductor ?? "").trim();
      if (!c) continue;
      const k = normalizeConductorName(c);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return Object.fromEntries(counts.entries());
}

async function fetchLiquidacionesSemaforoBySemanaLabel(
  semanaLabel: string,
): Promise<Record<string, string>> {
  const sb = getSupabaseAdmin();
  const map: Record<string, string> = {};
  const { data, error } = await sb
    .schema("reportes")
    .from("liquidaciones_conductores_resumen_mv")
    .select('id_conductor,semana_label,"Semaforo"')
    .eq("semana_label", semanaLabel);
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
  return map;
}

async function fetchOperatorsActivos(): Promise<{ value: string; label: string }[]> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .schema("vista")
    .from("vw_moobiz_operators")
    .select("name,Estado,estado")
    .limit(3000);
  if (error) {
    console.warn("[control-operaciones] operators select(name,Estado) falló, fallback *:", error.message);
    const fb = await sb.schema("vista").from("vw_moobiz_operators").select("*").limit(3000);
    if (fb.error) throw fb.error;
    return normalizeOperatorRows(fb.data);
  }
  return normalizeOperatorRows(data);
}

function normalizeOperatorRows(data: unknown): { value: string; label: string }[] {
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
    .limit(CONTROL_LIMIT);
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

function controlByIdFromRows(
  controlRows: { id_conductor: string; solicitante: string | null; observacion: string | null }[],
): Record<string, { solicitante: string | null; observacion: string | null }> {
  const controlById: Record<string, { solicitante: string | null; observacion: string | null }> = {};
  for (const r of controlRows) {
    controlById[r.id_conductor] = { solicitante: r.solicitante, observacion: r.observacion };
  }
  return controlById;
}

/**
 * GET principal (sin partial): solo página de drivers + control_operaciones + meta.
 * Causa histórica de timeout 57014: Promise.all de (a) paginación completa de la vista con select(*),
 * (b) scan completo de viajes_activos por rangos, (c) liquidaciones para todos los ids,
 * (d) operadores en el mismo request — excedía statement_timeout y/o acumulaba I/O.
 */
export async function GET(request: NextRequest) {
  const tRequest = nowMs();
  try {
    assertQualityReadAccess(request);
    const url = request.nextUrl;

    if (url.searchParams.get("partial") === "control") {
      const t0 = nowMs();
      const controlRows = await fetchControlRows();
      const ms = logBlock("partial=control fetchControlRows", t0);
      console.log("[control-operaciones][timing] partial=control total:", nowMs() - tRequest, "ms (control:", ms, "ms)");
      const controlById = controlByIdFromRows(controlRows);
      return NextResponse.json({
        semanaLabel: semanaLabelLiquidaciones(),
        controlById,
        timingsMs: { control: nowMs() - tRequest },
      });
    }

    if (url.searchParams.get("partial") === "operators") {
      const t0 = nowMs();
      const operatorOptions = await fetchOperatorsActivos();
      logBlock("partial=operators", t0);
      return NextResponse.json({ operatorOptions, timingsMs: { operators: nowMs() - tRequest } });
    }

    if (url.searchParams.get("partial") === "viajes") {
      const t0 = nowMs();
      const names = url.searchParams.getAll("n").map((s) => s.trim()).filter(Boolean);
      if (names.length === 0) {
        return NextResponse.json(
          { error: "Indica al menos un nombre con el query repetido n= (conductores de la página cargada)." },
          { status: 400 },
        );
      }
      const viajesCounts = await fetchViajesCountsForExactConductorNames(names);
      logBlock(`partial=viajes n=${names.length}`, t0);
      return NextResponse.json({ viajesCounts, timingsMs: { viajes: nowMs() - tRequest } });
    }

    if (url.searchParams.get("partial") === "semaforo") {
      const t0 = nowMs();
      const semanaLabel =
        url.searchParams.get("semanaLabel")?.trim() || semanaLabelLiquidaciones();
      const semaforoById = await fetchLiquidacionesSemaforoBySemanaLabel(semanaLabel);
      const semaforoOptions = Array.from(
        new Set(
          Object.values(semaforoById)
            .map((s) => String(s).trim())
            .filter(Boolean),
        ),
      ).sort((a, b) => a.localeCompare(b, "es"));
      logBlock("partial=semaforo by semanaLabel", t0);
      return NextResponse.json({
        semanaLabel,
        semaforoById,
        semaforoOptions,
        timingsMs: { semaforo: nowMs() - tRequest },
      });
    }

    const tDrivers = nowMs();
    const { drivers, total } = await fetchAllApprovedDrivers();
    const msDrivers = logBlock(`drivers approved total=${drivers.length}`, tDrivers);

    const tControl = nowMs();
    const controlRows = await fetchControlRows();
    const msControl = logBlock(`control_operaciones rows=${controlRows.length}`, tControl);

    const controlById = controlByIdFromRows(controlRows);
    const semanaLabel = semanaLabelLiquidaciones();

    logBlock("GET total (drivers aprobados + control)", tRequest);

    return NextResponse.json({
      drivers,
      controlById,
      total,
      approvedCount: drivers.length,
      semanaLabel,
      /** Resumen diagnóstico (timeout histórico por mezcla de datasets + scan completo). */
      loadStrategy: {
        cause:
          "Antes: mezcla de datasets pesados en un solo request. Ahora: solo universo aprobado + control en carga base; enriquecimiento pesado sigue en parciales separados y acotados.",
        timingsMs: {
          drivers: msDrivers,
          control: msControl,
          total: nowMs() - tRequest,
        },
      },
    });
  } catch (err) {
    const message = formatApiError(err);
    console.error("[control-operaciones] GET error:", message);
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
