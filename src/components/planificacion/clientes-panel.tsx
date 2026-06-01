/**
 * COPIA INDEPENDIENTE: Do not modify original Seguimiento files.
 * Timeline por empresa (co_name) vía GET /api/clientes-operaciones.
 */
"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink, Layers, Loader2, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ClientesOperacionesServiceRow } from "@/lib/clientes-operaciones-types";
import { ClientesBucketBadge } from "@/components/planificacion/clientes-bucket-badge";
import { ClientesBucketsModal } from "@/components/planificacion/clientes-buckets-modal";
import { ClientesEmpresaBucketMenu } from "@/components/planificacion/clientes-empresa-bucket-menu";
import {
  deleteClientBucketApi,
  fetchClientBuckets,
  upsertClientBucketApi,
} from "@/lib/client-buckets-client";
import type { ClientBucketLevel, ClientBucketRow } from "@/lib/client-buckets-types";
import {
  empresaDisplayName,
  empresaRowKey,
  moobizActivesCompanyUrl,
  parseServiceDate,
  toText,
  UNKNOWN_COMPANY_ID,
} from "@/lib/clientes-operaciones-map";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  colorForClientesEstado,
  clientesEstadoBadgeRingClass,
  sortEstadoEntriesForMatrix,
  sortEstadosForLegend,
} from "@/lib/clientes-estado";
import {
  computeClientesTimelineAxisBounds,
  floorToLocalHourMs,
  indexOfCurrentHourInAxis,
} from "@/lib/clientes-timeline-axis";

type ClientesMatrixRow = ClientesOperacionesServiceRow;

const HOUR_MS = 60 * 60 * 1000;
const MIN_AXIS_HOURS = 24;
/** Altura aproximada para ver ~15 filas de empresas + cabecera de horas. */
const MATRIX_MAX_HEIGHT = "min(600px, calc(15 * 2.35rem + 48px))";

const ROW_ESTIMATE_PX = 40;
const COL_ESTIMATE_PX = 44;
const HEADER_ROW_HEIGHT = 48;
const NAME_COL_WIDTH = 280;

function parseDateFromRow(row: ClientesMatrixRow): Date | null {
  return parseServiceDate(row.fecha, row.fecha_registro);
}

function pickCoIdFromGroup(rows: ClientesMatrixRow[]): string | null {
  for (const r of rows) {
    const url = moobizActivesCompanyUrl(r.co_id);
    if (url) return toText(r.co_id);
  }
  return null;
}

function shortSlotLabel(ms: number): string {
  const d = new Date(ms);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  if (min === "00") return `${dd}/${mm} ${hh}h`;
  return `${dd}/${mm} ${hh}:${min}`;
}

function slotDateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function slotDateDisplay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

function slotHourDisplay(ts: number): string {
  return String(new Date(ts).getHours()).padStart(2, "0");
}

/** Viaje colocado en una celda (hora de visualización redondeada); `scheduledAt` = fecha/hora real del servicio. */
type ViajeSlotTrip = {
  estado: string;
  scheduledAt: Date;
};

function formatScheduledDdMmHhmm(d: Date): string {
  if (Number.isNaN(d.getTime())) return "";
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm} ${hh}:${min}`;
}

type MatrixSlot = {
  ts: number;
  label: string;
  dateKey: string;
  dateDisplay: string;
  hourDisplay: string;
  showDateLabel: boolean;
};

const EMPTY_TRIPS: ViajeSlotTrip[] = [];

/** Interior de celda; `trips` es la lista de servicios en esa franja horaria (referencia estable por celda en el Map). */
const MatrixCellBody = memo(function MatrixCellBody({
  trips,
}: {
  trips: ViajeSlotTrip[] | undefined;
}) {
  const { entries, total, multi } = useMemo(() => {
    const list = trips ?? [];
    const counts = new Map<string, number>();
    for (const t of list) {
      counts.set(t.estado, (counts.get(t.estado) ?? 0) + 1);
    }
    const filtered = [...counts.entries()].filter(([, v]) => v > 0) as [string, number][];
    const entries = sortEstadoEntriesForMatrix(filtered);
    const total = list.length;
    return { entries, total, multi: entries.length > 1 };
  }, [trips]);

  if (total === 0) {
    return <div className="h-full w-full rounded-md bg-slate-50/90" />;
  }
  return (
    <div className="relative h-full w-full rounded-md">
      <div className="relative flex h-full min-h-0 w-full gap-0.5 overflow-hidden rounded-md bg-slate-100/90 p-0.5">
        {entries.map(([estado, cnt]) => (
          <div
            key={estado}
            className={`flex min-w-[3px] items-center justify-center overflow-hidden rounded-md text-[10px] font-semibold text-white shadow-sm ring-1 ${clientesEstadoBadgeRingClass(estado, "cell")}`}
            style={{
              flex: cnt,
              backgroundColor: colorForClientesEstado(estado),
            }}
          >
            {!multi ? cnt : null}
          </div>
        ))}
      </div>
      {multi ? (
        <span className="pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)]">
          {total}
        </span>
      ) : null}
    </div>
  );
});

export type ClientesPanelProps = {
  startDate?: string;
  endDate?: string;
  /** Cuando cambia (p. ej. tras sincronizar Moobiz), se vuelve a cargar la matriz. */
  dataRevision?: number;
};

/** Filtro por bolsa persistida (public.Empresas_Criticas). */
export type ClientesBucketFilter = "all" | "level1" | "level2" | "level3";

function resolveCoIdForEmpresaKey(
  empresaKey: string,
  groupRows: ClientesMatrixRow[],
): string | null {
  const fromRows = pickCoIdFromGroup(groupRows);
  if (fromRows) return fromRows;
  if (empresaKey && !empresaKey.startsWith(UNKNOWN_COMPANY_ID)) return empresaKey;
  return null;
}

export function ClientesPanel({
  startDate = "",
  endDate = "",
  dataRevision = 0,
}: ClientesPanelProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<ClientesMatrixRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [empresaSearch, setEmpresaSearch] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const router = useRouter();
  const [bucketFilter, setBucketFilter] = useState<ClientesBucketFilter>("all");
  const [buckets, setBuckets] = useState<ClientBucketRow[]>([]);
  const [bucketsModalOpen, setBucketsModalOpen] = useState(false);
  const [bucketActionBusy, setBucketActionBusy] = useState(false);
  const [toast, setToast] = useState<{ message: string; error?: boolean } | null>(null);
  const [hover, setHover] = useState<{
    empresa: string;
    total: number;
    trips: ViajeSlotTrip[];
    x: number;
    y: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const qs = params.toString();
      const url = qs ? `/api/clientes-operaciones?${qs}` : "/api/clientes-operaciones";
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as { data?: ClientesMatrixRow[]; error?: string };
      if (!res.ok) throw new Error(json?.error || "Error al cargar clientes");
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  /** POST /api/moobiz-services/sync (sincroniza public.moobiz_services) y refresca la matriz. */
  const syncMoobizServices = useCallback(async () => {
    if (syncBusy) return;
    setSyncBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/moobiz-services/sync", {
        method: "POST",
        cache: "no-store",
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        const msg =
          typeof data.error === "string" && data.error.trim()
            ? data.error
            : `No se pudo sincronizar Moobiz (HTTP ${res.status}).`;
        throw new Error(msg);
      }
      router.refresh();
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al sincronizar Moobiz");
    } finally {
      setSyncBusy(false);
    }
  }, [syncBusy, router, load]);

  useEffect(() => {
    void load();
  }, [load, dataRevision]);

  const showToast = useCallback((message: string, isError = false) => {
    setToast({ message, error: isError });
    window.setTimeout(() => setToast(null), 4000);
  }, []);

  const loadBuckets = useCallback(async () => {
    try {
      const data = await fetchClientBuckets();
      setBuckets(data);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Error al cargar bolsas", true);
    }
  }, [showToast]);

  useEffect(() => {
    void loadBuckets();
  }, [loadBuckets, dataRevision]);

  const bucketsByCoId = useMemo(() => {
    const m = new Map<string, ClientBucketLevel>();
    for (const b of buckets) {
      m.set(b.co_id, b.bucket_level);
    }
    return m;
  }, [buckets]);

  const handleAssignBucket = useCallback(
    async (coId: string, coName: string, level: ClientBucketLevel) => {
      if (!coId) return;
      setBucketActionBusy(true);
      try {
        const row = await upsertClientBucketApi({
          co_id: coId,
          co_name: coName,
          bucket_level: level,
        });
        setBuckets((prev) => [...prev.filter((b) => b.co_id !== coId), row]);
        showToast(`${coName} → Nivel ${level}`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al asignar", true);
      } finally {
        setBucketActionBusy(false);
      }
    },
    [showToast],
  );

  const handleRemoveBucket = useCallback(
    async (coId: string, coName: string) => {
      if (!coId) return;
      setBucketActionBusy(true);
      try {
        await deleteClientBucketApi(coId);
        setBuckets((prev) => prev.filter((b) => b.co_id !== coId));
        showToast(`${coName} quitada de bolsas`);
      } catch (e) {
        showToast(e instanceof Error ? e.message : "Error al quitar", true);
      } finally {
        setBucketActionBusy(false);
      }
    },
    [showToast],
  );

  const rowsByEmpresa = useMemo(() => {
    const m = new Map<string, ClientesMatrixRow[]>();
    for (const row of rows) {
      const key = empresaRowKey(row.co_id, row.co_name);
      if (!m.has(key)) m.set(key, []);
      m.get(key)!.push(row);
    }
    return m;
  }, [rows]);

  const displayNameByEmpresaKey = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of rows) {
      const key = empresaRowKey(row.co_id, row.co_name);
      m.set(key, empresaDisplayName(row.co_name, row.co_id));
    }
    return m;
  }, [rows]);

  const legendEstados = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const e = toText(row.estado);
      if (e) set.add(e);
    }
    return sortEstadosForLegend(Array.from(set));
  }, [rows]);

  const { slots, empresaOrder, cellMap, empresaTotals } = useMemo(() => {
    const { axisStartMs, axisEndMs } = computeClientesTimelineAxisBounds({
      rows: rows.map((row) => ({
        estado: toText(row.estado),
        serviceAt: parseDateFromRow(row),
      })),
      minAxisHours: MIN_AXIS_HOURS,
    });

    const slotsArr: MatrixSlot[] = [];
    for (let t = axisStartMs; t <= axisEndMs; t += HOUR_MS) {
      slotsArr.push({
        ts: t,
        label: shortSlotLabel(t),
        dateKey: slotDateKey(t),
        dateDisplay: slotDateDisplay(t),
        hourDisplay: slotHourDisplay(t),
        showDateLabel: false,
      });
    }

    const byDay = new Map<string, number[]>();
    slotsArr.forEach((s, i) => {
      const k = s.dateKey;
      if (!byDay.has(k)) byDay.set(k, []);
      byDay.get(k)!.push(i);
    });
    for (const indices of byDay.values()) {
      const mid = indices[Math.floor((indices.length - 1) / 2)] ?? indices[0];
      if (mid !== undefined) slotsArr[mid].showDateLabel = true;
    }

    const cell = new Map<string, Map<number, ViajeSlotTrip[]>>();
    const totals = new Map<string, number>();

    for (const row of rows) {
      const key = empresaRowKey(row.co_id, row.co_name);
      const d = parseDateFromRow(row);
      if (!d) continue;
      const ts = floorToLocalHourMs(d);
      if (ts < axisStartMs || ts > axisEndMs) continue;
      const est = toText(row.estado) || "Sin estado";
      if (!cell.has(key)) cell.set(key, new Map());
      const bySlot = cell.get(key)!;
      if (!bySlot.has(ts)) bySlot.set(ts, []);
      const list = bySlot.get(ts)!;
      list.push({ estado: est, scheduledAt: new Date(d.getTime()) });
      totals.set(key, (totals.get(key) ?? 0) + 1);
    }

    const order = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([key]) => key);

    return { slots: slotsArr, empresaOrder: order, cellMap: cell, empresaTotals: totals };
  }, [rows]);

  const filteredEmpresas = useMemo(() => {
    const q = empresaSearch.trim().toLowerCase();
    const requiredLevel =
      bucketFilter === "level1" ? 1 : bucketFilter === "level2" ? 2 : bucketFilter === "level3" ? 3 : null;

    return empresaOrder.filter((key) => {
      const label = displayNameByEmpresaKey.get(key) ?? key;
      const groupRows = rowsByEmpresa.get(key) ?? [];
      const coId = resolveCoIdForEmpresaKey(key, groupRows);

      if (requiredLevel != null) {
        if (!coId || bucketsByCoId.get(coId) !== requiredLevel) return false;
      }
      if (q && !label.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [
    empresaOrder,
    empresaSearch,
    displayNameByEmpresaKey,
    bucketFilter,
    bucketsByCoId,
    rowsByEmpresa,
  ]);

  const rowCount = filteredEmpresas.length;
  const colCount = slots.length;

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 6,
    paddingStart: HEADER_ROW_HEIGHT,
  });

  const columnVirtualizer = useVirtualizer({
    horizontal: true,
    count: colCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => COL_ESTIMATE_PX,
    overscan: 8,
  });

  const totalInnerWidth = NAME_COL_WIDTH + columnVirtualizer.getTotalSize();
  const totalInnerHeight = rowVirtualizer.getTotalSize();

  const dayDividerColumnIndices = useMemo(() => {
    const r: number[] = [];
    for (let i = 1; i < slots.length; i++) {
      if (slots[i].dateKey !== slots[i - 1].dateKey) r.push(i);
    }
    return r;
  }, [slots]);

  const columnScrollToken = columnVirtualizer.scrollOffset ?? 0;

  const dayDividerLeftPx = useMemo(() => {
    return dayDividerColumnIndices.map((i) => {
      const off = columnVirtualizer.getOffsetForIndex(i, "start");
      return off?.[0] ?? i * COL_ESTIMATE_PX;
    });
  }, [dayDividerColumnIndices, columnVirtualizer, colCount, columnScrollToken]);

  const nowHourCenterPx = useMemo(() => {
    if (slots.length === 0) return null;
    const nowIdx = indexOfCurrentHourInAxis(slots);
    if (nowIdx < 0) return null;
    const off = columnVirtualizer.getOffsetForIndex(nowIdx, "start");
    const start = off?.[0] ?? nowIdx * COL_ESTIMATE_PX;
    const vis = columnVirtualizer.getVirtualItems();
    const vCol = vis.find((v) => v.index === nowIdx);
    const w = vCol?.size ?? COL_ESTIMATE_PX;
    return start + w / 2;
  }, [slots, columnVirtualizer, colCount, columnScrollToken]);

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 py-2">
        <CardTitle className="text-base font-semibold text-slate-800">Clientes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {toast && (
          <p
            className={`rounded-md border px-3 py-2 text-sm ${
              toast.error
                ? "border-red-200 bg-red-50 text-red-800"
                : "border-emerald-200 bg-emerald-50 text-emerald-900"
            }`}
            role="status"
          >
            {toast.message}
          </p>
        )}
        {legendEstados.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Estados (color)
            </span>
            {legendEstados.map((est) => (
              <span
                key={est}
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ${clientesEstadoBadgeRingClass(est, "pill")}`}
                style={{ backgroundColor: colorForClientesEstado(est) }}
              >
                {est}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:flex-1">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-xs text-slate-600">Nombre de la empresa</Label>
              <Input
                value={empresaSearch}
                onChange={(e) => setEmpresaSearch(e.target.value)}
                placeholder="Buscar..."
                className="h-9 text-sm"
              />
            </div>
            <div className="w-full shrink-0 space-y-1 sm:w-[min(100%,220px)]">
              <Label className="text-xs text-slate-600">Bolsa</Label>
              <Select
                value={bucketFilter}
                onValueChange={(v) => setBucketFilter(v as ClientesBucketFilter)}
              >
                <SelectTrigger className="h-9 w-full border-slate-200 bg-white text-sm">
                  <SelectValue placeholder="Filtro" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="level1">Nivel 1</SelectItem>
                  <SelectItem value="level2">Nivel 2</SelectItem>
                  <SelectItem value="level3">Nivel 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-9 shrink-0 gap-1.5 border-slate-300 text-xs"
            onClick={() => setBucketsModalOpen(true)}
          >
            <Layers className="h-3.5 w-3.5" aria-hidden />
            Gestionar bolsas
          </Button>
          <Button
            type="button"
            size="sm"
            variant="default"
            disabled={syncBusy}
            onClick={() => void syncMoobizServices()}
            className="h-9 shrink-0 gap-1.5 bg-[#0b1131] px-3 text-xs text-white hover:bg-[#0b1131]/90"
            title="Sincronizar public.moobiz_services y refrescar matriz desde vista.moobiz_services_maestra."
          >
            {syncBusy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            )}
            {syncBusy ? "Actualizando..." : "Actualizar Moobiz"}
          </Button>
        </div>

        {err && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>
        )}
        {loading && <p className="text-sm text-slate-500">Cargando matriz...</p>}

        {!loading && filteredEmpresas.length === 0 && (
          <p className="text-sm text-slate-500">No hay empresas que cumplan los filtros.</p>
        )}

        {hover && (
          <div
            className="pointer-events-none fixed z-[100] max-h-[min(70vh,22rem)] max-w-sm overflow-y-auto rounded-lg border border-slate-700 bg-[#0b1131] px-3 py-2 text-xs text-white shadow-xl"
            style={{ left: hover.x, top: hover.y }}
          >
            <p className="font-bold text-white">{hover.empresa}</p>
            <p className="mt-1 text-white/80">Total filas: {hover.total}</p>
            <div className="mt-2 space-y-1.5">
              {hover.trips.map((trip, i) => (
                <div
                  key={`${trip.scheduledAt.getTime()}-${i}-${trip.estado}`}
                  className="flex items-center justify-between gap-3 text-[11px]"
                >
                  <span
                    className={`max-w-[55%] truncate rounded-md px-2 py-0.5 font-semibold text-white shadow-sm ring-1 ${clientesEstadoBadgeRingClass(trip.estado, "pill")}`}
                    style={{ backgroundColor: colorForClientesEstado(trip.estado) }}
                  >
                    {trip.estado}
                  </span>
                  <span className="shrink-0 tabular-nums text-white/90">
                    {formatScheduledDdMmHhmm(trip.scheduledAt)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {filteredEmpresas.length > 0 && colCount > 0 && (
          <div
            className="rounded-lg border border-slate-200"
            style={{ maxHeight: MATRIX_MAX_HEIGHT }}
          >
            <div
              ref={parentRef}
              className="h-full max-h-[inherit] overflow-auto [-webkit-overflow-scrolling:touch]"
            >
              <div
                className="relative bg-slate-200"
                style={{
                  width: totalInnerWidth,
                  height: totalInnerHeight,
                }}
              >
                {/* Cabecera: sticky + isolate para capas; overflow visible (scroll en el padre). */}
                <div
                  className="sticky top-0 z-50 isolate flex overflow-visible bg-slate-100"
                  style={{ height: HEADER_ROW_HEIGHT, width: totalInnerWidth }}
                >
                  <div
                    className="sticky left-0 z-[60] flex shrink-0 items-center justify-between gap-1 border-b border-r border-slate-200 bg-slate-100 px-2 pr-1 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                    style={{
                      width: NAME_COL_WIDTH,
                      height: HEADER_ROW_HEIGHT,
                      boxSizing: "border-box",
                    }}
                  >
                    <span className="truncate">Empresa</span>
                    <ExternalLink
                      className="h-3.5 w-3.5 shrink-0 text-blue-500 opacity-80"
                      aria-hidden
                    />
                  </div>
                  <div
                    className="relative z-[50] shrink-0 overflow-visible border-b border-slate-200 bg-slate-100"
                    style={{
                      width: columnVirtualizer.getTotalSize(),
                      height: HEADER_ROW_HEIGHT,
                    }}
                  >
                    {columnVirtualizer.getVirtualItems().map((vCol) => {
                      const slot = slots[vCol.index];
                      if (!slot) return null;
                      return (
                        <div
                          key={vCol.key}
                          className="absolute z-[51] flex flex-col items-center justify-end overflow-visible border-r border-slate-200 bg-slate-100 pb-0.5 pl-0.5 pr-2 text-center"
                          style={{
                            height: HEADER_ROW_HEIGHT,
                            width: vCol.size,
                            transform: `translateX(${vCol.start}px) translateY(0px)`,
                          }}
                        >
                          <div className="relative z-[52] flex min-h-[15px] w-full items-end justify-center overflow-visible bg-slate-100 leading-none">
                            {slot.showDateLabel ? (
                              <span className="relative z-[70] mr-0.5 inline-block whitespace-nowrap rounded-sm bg-slate-100 py-px pl-1.5 pr-3 text-[13px] font-bold leading-tight text-slate-800">
                                {slot.dateDisplay}
                              </span>
                            ) : null}
                          </div>
                          <span className="relative z-[52] mt-0.5 whitespace-nowrap bg-slate-100 pr-1 text-[10px] font-medium tabular-nums text-slate-600">
                            {slot.hourDisplay}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Filas virtualizadas */}
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const empresaKey = filteredEmpresas[vRow.index];
                  if (!empresaKey) return null;
                  const displayName = displayNameByEmpresaKey.get(empresaKey) ?? empresaKey;
                  const totalRows = empresaTotals.get(empresaKey) ?? 0;
                  const groupRows = rowsByEmpresa.get(empresaKey) ?? [];
                  const coId = resolveCoIdForEmpresaKey(empresaKey, groupRows);
                  const moobizHref = moobizActivesCompanyUrl(coId ?? "");
                  const bucketLevel = coId ? bucketsByCoId.get(coId) : undefined;

                  return (
                    <div
                      key={vRow.key}
                      data-index={vRow.index}
                      className={`absolute left-0 top-0 flex ${
                        bucketLevel ? "bg-amber-50/50" : "bg-white"
                      }`}
                      style={{
                        width: totalInnerWidth,
                        height: vRow.size,
                        transform: `translateX(0px) translateY(${vRow.start}px)`,
                      }}
                    >
                      <div
                        className={`sticky left-0 z-30 flex w-full shrink-0 items-center justify-between gap-1 border-b border-r border-slate-200 px-1.5 text-xs font-medium text-slate-800 ${
                          bucketLevel ? "bg-amber-50/80" : "bg-white"
                        }`}
                        style={{
                          width: NAME_COL_WIDTH,
                          height: vRow.size,
                          boxSizing: "border-box",
                        }}
                      >
                        <span className="line-clamp-2 min-w-0 flex-1" title={displayName}>
                          {displayName}
                        </span>
                        <div className="flex shrink-0 items-center gap-0.5">
                          {bucketLevel != null && <ClientesBucketBadge level={bucketLevel} />}
                          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] tabular-nums">
                            {totalRows}
                          </Badge>
                          <ClientesEmpresaBucketMenu
                            coId={coId ?? ""}
                            coName={displayName}
                            currentLevel={bucketLevel ?? null}
                            disabled={bucketActionBusy || !coId}
                            onAssign={(lvl) => void handleAssignBucket(coId!, displayName, lvl)}
                            onRemove={() => void handleRemoveBucket(coId!, displayName)}
                          />
                          {moobizHref ? (
                            <a
                              href={moobizHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir empresa en Moobiz"
                              aria-label={`Abrir ${displayName} en Moobiz`}
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center text-blue-500 hover:text-blue-600"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : (
                            <span
                              className="inline-flex cursor-not-allowed items-center justify-center text-slate-300"
                              title="Sin co_id de empresa"
                              aria-hidden
                            >
                              <ExternalLink className="h-4 w-4" />
                            </span>
                          )}
                        </div>
                      </div>

                      <div
                        className="relative shrink-0 border-b border-slate-200"
                        style={{
                          width: columnVirtualizer.getTotalSize(),
                          height: vRow.size,
                        }}
                      >
                        {columnVirtualizer.getVirtualItems().map((vCol) => {
                          const slot = slots[vCol.index];
                          if (!slot) return null;
                          const tripsCell = cellMap.get(empresaKey)?.get(slot.ts) ?? EMPTY_TRIPS;
                          const totalHover = tripsCell.length;

                          return (
                            <div
                              key={`${vRow.key}-${vCol.key}`}
                              className="absolute box-border overflow-hidden border-r border-slate-200 bg-slate-100 p-[2px]"
                              style={{
                                height: vRow.size,
                                width: vCol.size,
                                transform: `translateX(${vCol.start}px) translateY(0px)`,
                              }}
                              onMouseEnter={(e) => {
                                if (totalHover === 0) {
                                  setHover(null);
                                  return;
                                }
                                const sorted = [...tripsCell].sort(
                                  (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
                                );
                                setHover({
                                  empresa: displayName,
                                  total: sorted.length,
                                  trips: sorted,
                                  x: e.clientX + 12,
                                  y: e.clientY + 12,
                                });
                              }}
                              onMouseLeave={() => setHover(null)}
                            >
                              <MatrixCellBody trips={tripsCell} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}

                {/* Líneas verticales solo sobre la cuadrícula (no atraviesan la cabecera: evita tapar fechas). */}
                <div
                  className="pointer-events-none absolute z-[10]"
                  style={{
                    left: NAME_COL_WIDTH,
                    top: HEADER_ROW_HEIGHT,
                    width: columnVirtualizer.getTotalSize(),
                    height: Math.max(0, totalInnerHeight - HEADER_ROW_HEIGHT),
                  }}
                  aria-hidden
                >
                  {dayDividerLeftPx.map((left, idx) => (
                    <div
                      key={`day-line-${dayDividerColumnIndices[idx]!}`}
                      className="absolute top-0 h-full w-0 border-l border-dashed border-slate-400/35"
                      style={{ left }}
                    />
                  ))}
                  {nowHourCenterPx != null ? (
                    <div
                      className="absolute top-0 h-full w-px -translate-x-1/2 bg-[rgba(0,191,165,0.35)]"
                      style={{ left: nowHourCenterPx }}
                    />
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        )}

        <ClientesBucketsModal
          open={bucketsModalOpen}
          onOpenChange={setBucketsModalOpen}
          buckets={buckets}
          onBucketsChange={setBuckets}
          onToast={showToast}
        />
      </CardContent>
    </Card>
  );
}
