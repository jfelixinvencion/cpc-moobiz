import { NextRequest, NextResponse } from "next/server";

import { formatApiError } from "@/lib/format-api-error";
import type { DriverLiveAvailability } from "@/lib/control-operaciones-gps-filter";
import { SOLICITANTE_FILTER_EMPTY, type ControlSolicitanteCell } from "@/lib/control-operaciones-solicitante-tm-tt";
import { mapExcelRowToControlDriver, type ControlDriverExcelRow } from "@/lib/control-operaciones-map";
import { semanaLabelLiquidaciones } from "@/lib/control-operaciones-semana";
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
  `fecha_activacion:"Fecha Activacion"`,
].join(",");

const DRIVERS_INTERNAL_CHUNK = 150;
const MAX_DRIVER_IDS_SERV = 500;
const CONTROL_LIMIT = 50_000;
const DRIVER_LIVE_AVAILABILITY_CHUNK = 200;

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

function normalizeDriverLiveAvailability(value: unknown): DriverLiveAvailability {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw === "online") return "online";
  if (raw === "busy") return "busy";
  return "offline";
}

async function fetchDriverLiveAvailabilityByIds(
  driverIds: string[],
): Promise<Record<string, DriverLiveAvailability | null>> {
  const sb = getSupabaseAdmin();
  const out: Record<string, DriverLiveAvailability | null> = {};
  const uniq = [...new Set(driverIds.map((id) => String(id).trim()).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += DRIVER_LIVE_AVAILABILITY_CHUNK) {
    const part = uniq.slice(i, i + DRIVER_LIVE_AVAILABILITY_CHUNK);
    if (part.length === 0) continue;
    const { data, error } = await sb
      .schema("vista")
      .from("vw_driver_live_raw_flat")
      .select("id_user,availability")
      .in("id_user", part);
    if (error) throw error;
    for (const raw of data || []) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as Record<string, unknown>;
      const idUser = String(row.id_user ?? "").trim();
      if (!idUser) continue;
      out[idUser] = normalizeDriverLiveAvailability(row.availability);
    }
  }
  for (const id of uniq) {
    if (!Object.prototype.hasOwnProperty.call(out, id)) {
      out[id] = null;
    }
  }
  return out;
}

function normalizeFlNameValue(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function extractFlNameFromMoobizDriverRow(row: Record<string, unknown>): string | null {
  const direct = normalizeFlNameValue(row.fl_name);
  if (direct !== null) return direct;
  const raw = row.raw_data;
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as Record<string, unknown>;
      return normalizeFlNameValue(p.fl_name ?? p.flName);
    } catch {
      return null;
    }
  }
  if (typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    return normalizeFlNameValue(o.fl_name ?? o.flName);
  }
  return null;
}

/** fl_name por id_conductor (vista preferida; fallback public.moobiz_drivers.raw_data). */
async function fetchFlNameMapByDriverIds(driverIds: string[]): Promise<Record<string, string | null>> {
  const sb = getSupabaseAdmin();
  const out: Record<string, string | null> = {};
  const uniq = [...new Set(driverIds.map((id) => String(id).trim()).filter(Boolean))];

  for (let i = 0; i < uniq.length; i += DRIVER_LIVE_AVAILABILITY_CHUNK) {
    const part = uniq.slice(i, i + DRIVER_LIVE_AVAILABILITY_CHUNK);
    if (part.length === 0) continue;

    let flRows: Record<string, unknown>[] | null = null;

    try {
      const { data: dataFromView, error: errView } = await sb
        .schema("vista")
        .from("vw_moobiz_drivers_excel")
        .select('id_conductor:"ID Conductor", fl_name')
        .in("ID Conductor", part);

      if (!errView && dataFromView != null) {
        flRows = dataFromView as Record<string, unknown>[];
      } else {
        const { data: dataFromTable, error: errTable } = await sb
          .from("moobiz_drivers")
          .select("id, raw_data")
          .in("id", part);
        if (!errTable && dataFromTable != null) {
          flRows = dataFromTable as Record<string, unknown>[];
        } else {
          console.warn("[control-operaciones] Unable to fetch fl_name for ids chunk", {
            errView: errView?.message ?? errView,
            errTable: errTable?.message ?? errTable,
          });
          continue;
        }
      }
    } catch (e) {
      console.warn("[control-operaciones] Exception fetching fl_name chunk", e);
      continue;
    }

    for (const raw of flRows ?? []) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      const idKey = String(r.id_conductor ?? r["ID Conductor"] ?? r.id ?? "").trim();
      if (!idKey) continue;
      let fl: string | null = null;
      if (r.fl_name !== undefined && r.fl_name !== null) {
        fl = normalizeFlNameValue(r.fl_name);
      } else if (r.raw_data !== undefined) {
        fl = extractFlNameFromMoobizDriverRow(r);
      }
      out[idKey] = fl;
    }
  }

  return out;
}

async function fetchServCountsByDriverIds(drIds: string[]): Promise<Record<string, number>> {
  const sb = getSupabaseAdmin();
  const counts = new Map<string, number>();
  const uniq = [...new Set(drIds.map((n) => String(n).trim()).filter(Boolean))].slice(0, MAX_DRIVER_IDS_SERV);
  const chunk = 80;
  console.log(`[control-operaciones][SERV] inicio carga SERV dr_id consultados=${uniq.length}`);
  for (let i = 0; i < uniq.length; i += chunk) {
    const part = uniq.slice(i, i + chunk);
    if (part.length === 0) continue;
    const { data, error } = await sb
      .schema("vista")
      .from("moobiz_services_maestra")
      .select("dr_id")
      .in("dr_id", part);
    if (error) throw error;
    for (const raw of data || []) {
      if (!raw || typeof raw !== "object") continue;
      const driverId = String((raw as { dr_id?: unknown }).dr_id ?? "").trim();
      if (!driverId) continue;
      counts.set(driverId, (counts.get(driverId) ?? 0) + 1);
    }
  }
  console.log(`[control-operaciones][SERV] cantidad de conteos recibidos=${counts.size}`);
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
    .select('"ID Operador","Solicitante",Estado,estado')
    .limit(3000);
  if (error) {
    console.warn("[control-operaciones] operators select(ID Operador,Solicitante) falló, fallback *:", error.message);
    const fb = await sb.schema("vista").from("vw_moobiz_operators").select("*").limit(3000);
    if (fb.error) throw fb.error;
    console.log("[operators] count (fallback *):", Array.isArray(fb.data) ? fb.data.length : 0);
    return normalizeOperatorRows(fb.data);
  }
  console.log("[operators] count:", Array.isArray(data) ? data.length : 0);
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
    const idOperador = String((row as Record<string, unknown>)["ID Operador"] ?? "").trim();
    const solicitante = String((row as Record<string, unknown>)["Solicitante"] ?? "").trim();
    if (!idOperador || !solicitante) continue;
    out.push({ value: idOperador, label: solicitante });
  }
  out.sort((a, b) => a.label.localeCompare(b.label, "es"));
  return out;
}

function normCellText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function fetchControlRows(): Promise<
  { id_conductor: string; solicitante_tm: string | null; solicitante_tt: string | null; observacion: string | null }[]
> {
  const sb = getSupabaseAdmin();
  const { data, error } = await sb
    .from("control_operaciones")
    .select("id_conductor, solicitante_tm, solicitante_tt, observacion")
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
        solicitante_tm: normCellText(o.solicitante_tm),
        solicitante_tt: normCellText(o.solicitante_tt),
        observacion: normCellText(o.observacion),
      };
    })
    .filter(Boolean) as {
    id_conductor: string;
    solicitante_tm: string | null;
    solicitante_tt: string | null;
    observacion: string | null;
  }[];
}

function controlByIdFromRows(
  controlRows: {
    id_conductor: string;
    solicitante_tm: string | null;
    solicitante_tt: string | null;
    observacion: string | null;
  }[],
): Record<string, ControlSolicitanteCell> {
  const controlById: Record<string, ControlSolicitanteCell> = {};
  for (const r of controlRows) {
    controlById[r.id_conductor] = {
      solicitante_tm: r.solicitante_tm,
      solicitante_tt: r.solicitante_tt,
      observacion: r.observacion,
    };
  }
  return controlById;
}

function operatorIdsMatchingSolicitanteLabels(
  labels: string[],
  operatorOptions: { value: string; label: string }[],
): Set<string> {
  const want = new Set(labels.map((l) => l.trim()).filter(Boolean));
  const ids = new Set<string>();
  for (const o of operatorOptions) {
    if (want.has(o.label) || want.has(o.value)) ids.add(o.value);
  }
  return ids;
}

function filterDriversBySolicitanteParams(
  drivers: ControlDriverExcelRow[],
  controlById: Record<string, ControlSolicitanteCell>,
  solicitanteParams: string[],
  operatorOptions: { value: string; label: string }[],
): ControlDriverExcelRow[] {
  if (solicitanteParams.length === 0) return drivers;
  if (solicitanteParams.length === 1 && solicitanteParams[0] === SOLICITANTE_FILTER_EMPTY) {
    return drivers.filter((d) => {
      const c = controlById[d.id_conductor];
      return !normCellText(c?.solicitante_tm) && !normCellText(c?.solicitante_tt);
    });
  }
  const idSet = operatorIdsMatchingSolicitanteLabels(solicitanteParams, operatorOptions);
  if (idSet.size === 0) return [];
  return drivers.filter((d) => {
    const c = controlById[d.id_conductor];
    const tm = normCellText(c?.solicitante_tm);
    const tt = normCellText(c?.solicitante_tt);
    return (tm != null && idSet.has(tm)) || (tt != null && idSet.has(tt));
  });
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

    if (url.searchParams.get("partial") === "asignaciones") {
      const t0 = nowMs();
      const asignaciones = await fetchControlRows();
      logBlock("partial=asignaciones fetchControlRows", t0);
      return NextResponse.json({
        asignaciones,
        timingsMs: { asignaciones: nowMs() - tRequest },
      });
    }

    if (url.searchParams.get("partial") === "operators") {
      const t0 = nowMs();
      const operatorOptions = await fetchOperatorsActivos();
      logBlock("partial=operators", t0);
      return NextResponse.json({ operatorOptions, timingsMs: { operators: nowMs() - tRequest } });
    }

    if (url.searchParams.get("partial") === "serv") {
      const t0 = nowMs();
      const drIds = url.searchParams.getAll("d").map((s) => s.trim()).filter(Boolean);
      if (drIds.length === 0) {
        return NextResponse.json(
          { error: "Indica al menos un dr_id con el query repetido d= (conductores de la página cargada)." },
          { status: 400 },
        );
      }
      const servCounts = await fetchServCountsByDriverIds(drIds);
      logBlock(`partial=serv d=${drIds.length}`, t0);
      return NextResponse.json({ servCounts, timingsMs: { serv: nowMs() - tRequest } });
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

    const tGps = nowMs();
    const gpsAvailabilityById = await fetchDriverLiveAvailabilityByIds(
      drivers.map((driver) => driver.id_conductor),
    );
    const msGps = logBlock("gps availability from vw_driver_live_raw_flat", tGps);

    const tControl = nowMs();
    const controlRows = await fetchControlRows();
    const msControl = logBlock(`control_operaciones rows=${controlRows.length}`, tControl);

    const controlById = controlByIdFromRows(controlRows);
    const semanaLabel = semanaLabelLiquidaciones();

    const solicitanteParams = url.searchParams.getAll("solicitante").map((s) => s.trim()).filter(Boolean);
    let driversResponse = drivers;
    let gpsAvailabilityResponse = gpsAvailabilityById;
    if (solicitanteParams.length > 0) {
      const tSol = nowMs();
      const operatorOptions = await fetchOperatorsActivos();
      driversResponse = filterDriversBySolicitanteParams(
        drivers,
        controlById,
        solicitanteParams,
        operatorOptions,
      );
      const allowed = new Set(driversResponse.map((d) => d.id_conductor));
      const gpsFiltered: Record<string, DriverLiveAvailability | null> = {};
      for (const [k, v] of Object.entries(gpsAvailabilityById)) {
        if (allowed.has(k)) gpsFiltered[k] = v;
      }
      gpsAvailabilityResponse = gpsFiltered;
      logBlock(`solicitante filter params=${solicitanteParams.length} drivers=${driversResponse.length}`, tSol);
    }

    const tFlName = nowMs();
    const flNameById = await fetchFlNameMapByDriverIds(
      driversResponse.map((d) => String(d.id_conductor ?? "").trim()).filter(Boolean),
    );
    logBlock(`fl_name map drivers=${driversResponse.length}`, tFlName);

    const driversWithFlName = driversResponse.map((row) => {
      const idKey = String(
        row.id_conductor ?? (row as Record<string, unknown>)["ID Conductor"] ?? (row as { id?: unknown }).id ?? "",
      ).trim();
      return { ...row, fl_name: flNameById[idKey] ?? null };
    });

    logBlock("GET total (drivers aprobados + control)", tRequest);

    return NextResponse.json({
      drivers: driversWithFlName,
      gpsAvailabilityById: gpsAvailabilityResponse,
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
          gps: msGps,
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

type ControlBulkField = "solicitante_tm" | "solicitante_tt" | "observacion";

type UpsertRowInput = {
  id_conductor: string;
  solicitante_tm?: string | null;
  solicitante_tt?: string | null;
  observacion?: string | null;
};

type PostBody =
  | { rows: UpsertRowInput[]; bulk?: never }
  | { bulk: true; ids: string[]; field: ControlBulkField; value: string | null; rows?: never };

function normUnknown(v: unknown): string | null {
  if (v === undefined) return null;
  if (v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

async function upsertControlRowsMerged(
  sb: ReturnType<typeof getSupabaseAdmin>,
  rows: { id_conductor: string; solicitante_tm: string | null; solicitante_tt: string | null; observacion: string | null }[],
): Promise<void> {
  const { error } = await sb.from("control_operaciones").upsert(rows, { onConflict: "id_conductor" });
  if (error) throw error;
}

export async function POST(request: NextRequest) {
  try {
    assertQualityWriteAccess(request);
    const body = (await request.json()) as PostBody;

    if (body && typeof body === "object" && body.bulk === true) {
      const maybeRows = (body as { rows?: unknown }).rows;
      if (Array.isArray(maybeRows) && maybeRows.length > 0) {
        return NextResponse.json({ error: "No mezclar bulk con rows" }, { status: 400 });
      }
      const idsRaw = Array.isArray(body.ids) ? body.ids : [];
      const ids = [...new Set(idsRaw.map((x) => String(x).trim()).filter(Boolean))];
      if (ids.length === 0) {
        return NextResponse.json({ error: "ids vacío" }, { status: 400 });
      }
      if (ids.length > 500) {
        return NextResponse.json({ error: "Máximo 500 ids por solicitud" }, { status: 400 });
      }
      const field = body.field;
      if (field !== "solicitante_tm" && field !== "solicitante_tt" && field !== "observacion") {
        return NextResponse.json({ error: "field inválido" }, { status: 400 });
      }
      const value = normUnknown(body.value);

      const sb = getSupabaseAdmin();
      const { data: existing, error: selErr } = await sb
        .from("control_operaciones")
        .select("id_conductor, solicitante_tm, solicitante_tt, observacion")
        .in("id_conductor", ids);
      if (selErr) throw selErr;
      const byId = new Map<string, ControlSolicitanteCell & { id_conductor: string }>();
      for (const raw of existing || []) {
        if (!raw || typeof raw !== "object") continue;
        const o = raw as Record<string, unknown>;
        const id = String(o.id_conductor ?? "").trim();
        if (!id) continue;
        byId.set(id, {
          id_conductor: id,
          solicitante_tm: normCellText(o.solicitante_tm),
          solicitante_tt: normCellText(o.solicitante_tt),
          observacion: normCellText(o.observacion),
        });
      }
      const payload = ids.map((id) => {
        const cur = byId.get(id) ?? {
          id_conductor: id,
          solicitante_tm: null as string | null,
          solicitante_tt: null as string | null,
          observacion: null as string | null,
        };
        return {
          id_conductor: id,
          solicitante_tm: cur.solicitante_tm,
          solicitante_tt: cur.solicitante_tt,
          observacion: cur.observacion,
          [field]: value,
        };
      });
      await upsertControlRowsMerged(sb, payload);
      return NextResponse.json({ ok: true, bulk: true, updated: payload.length });
    }

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
        return {
          id_conductor: id,
          solicitante_tm: normUnknown(r.solicitante_tm),
          solicitante_tt: normUnknown(r.solicitante_tt),
          observacion: normUnknown(r.observacion),
        };
      })
      .filter(Boolean) as {
      id_conductor: string;
      solicitante_tm: string | null;
      solicitante_tt: string | null;
      observacion: string | null;
    }[];

    const sb = getSupabaseAdmin();
    await upsertControlRowsMerged(sb, payload);
    return NextResponse.json({ ok: true, upserted: payload.length });
  } catch (err) {
    const message = formatApiError(err);
    const status = message.startsWith("AUTH_REQUIRED") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
