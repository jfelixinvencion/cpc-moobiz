"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  colorForConductorEstado,
  sortEstadoEntriesForMatrix,
  sortEstadosForLegend,
} from "@/lib/conductor-estado";

type ViajeRow = {
  id?: string | number | null;
  conductor?: string | null;
  estado?: string | null;
  fecha?: string | null;
  fecha_registro?: string | null;
};

const HOUR_MS = 60 * 60 * 1000;
const MIN_AXIS_HOURS = 24;
/** Altura aproximada para ver ~15 filas de conductores + cabecera de horas. */
const MATRIX_MAX_HEIGHT = "min(600px, calc(15 * 2.35rem + 48px))";

const ROW_ESTIMATE_PX = 40;
const COL_ESTIMATE_PX = 44;
const HEADER_ROW_HEIGHT = 48;
const NAME_COL_WIDTH = 168;

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function parseDateFromRow(row: ViajeRow): Date | null {
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

function floorToHour(d: Date): number {
  const x = new Date(d.getTime());
  x.setMinutes(0, 0, 0);
  x.setMilliseconds(0);
  return x.getTime();
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
const MatrixCellBody = memo(function MatrixCellBody({ trips }: { trips: ViajeSlotTrip[] | undefined }) {
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
    <>
      <div className="relative flex h-full min-h-0 w-full gap-0.5 overflow-hidden rounded-md bg-slate-100/90 p-0.5">
        {entries.map(([estado, cnt]) => (
          <div
            key={estado}
            className="flex min-w-[3px] items-center justify-center overflow-hidden rounded-md text-[10px] font-semibold text-white shadow-sm ring-1 ring-black/5"
            style={{
              flex: cnt,
              backgroundColor: colorForConductorEstado(estado),
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
    </>
  );
});

export type ConductorMatrixProps = {
  startDate?: string;
  endDate?: string;
  empresa?: string;
  /** Cuando cambia (p. ej. tras sincronizar Moobiz), se vuelve a cargar la matriz. */
  dataRevision?: number;
};

export function ConductorTimelineMatrix({
  startDate = "",
  endDate = "",
  empresa = "Todas",
  dataRevision = 0,
}: ConductorMatrixProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<ViajeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conductorSearch, setConductorSearch] = useState("");
  const [selectedRowCounts, setSelectedRowCounts] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{
    conductor: string;
    total: number;
    trips: ViajeSlotTrip[];
    x: number;
    y: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const params = new URLSearchParams({ scope: "matrixRows" });
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      if (empresa && empresa !== "Todas") params.set("empresa", empresa);
      const res = await fetch(`/api/viajes?${params.toString()}`, { cache: "no-store" });
      const json = (await res.json()) as { data?: ViajeRow[]; error?: string };
      if (!res.ok) throw new Error(json?.error || "Error al cargar matriz");
      setRows(Array.isArray(json.data) ? json.data : []);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate, empresa]);

  useEffect(() => {
    void load();
  }, [load, dataRevision]);

  const legendEstados = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const e = toText(row.estado);
      if (e) set.add(e);
    }
    return sortEstadosForLegend(Array.from(set));
  }, [rows]);

  const { slots, conductorOrder, cellMap, conductorTotals } = useMemo(() => {
    const nowFloor = floorToHour(new Date());
    let maxSlot = nowFloor;
    for (const row of rows) {
      const d = parseDateFromRow(row);
      if (!d) continue;
      const t = floorToHour(d);
      if (t > maxSlot) maxSlot = t;
    }
    const minEnd = nowFloor + (MIN_AXIS_HOURS - 1) * HOUR_MS;
    const end = Math.max(maxSlot, minEnd);

    const slotsArr: MatrixSlot[] = [];
    for (let t = nowFloor; t <= end; t += HOUR_MS) {
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
      const c = toText(row.conductor);
      if (!c) continue;
      const d = parseDateFromRow(row);
      if (!d) continue;
      const ts = floorToHour(d);
      if (ts < nowFloor || ts > end) continue;
      const est = toText(row.estado) || "Sin estado";
      if (!cell.has(c)) cell.set(c, new Map());
      const bySlot = cell.get(c)!;
      if (!bySlot.has(ts)) bySlot.set(ts, []);
      const list = bySlot.get(ts)!;
      list.push({ estado: est, scheduledAt: new Date(d.getTime()) });
      totals.set(c, (totals.get(c) ?? 0) + 1);
    }

    const order = Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name]) => name);

    return { slots: slotsArr, conductorOrder: order, cellMap: cell, conductorTotals: totals };
  }, [rows]);

  const distinctTotals = useMemo(() => {
    const s = new Set<number>();
    for (const v of conductorTotals.values()) s.add(v);
    return Array.from(s).sort((a, b) => a - b);
  }, [conductorTotals]);

  const filteredConductors = useMemo(() => {
    const q = conductorSearch.trim().toLowerCase();
    return conductorOrder.filter((name) => {
      if (q && !name.toLowerCase().includes(q)) return false;
      const total = conductorTotals.get(name) ?? 0;
      if (selectedRowCounts.size > 0 && !selectedRowCounts.has(total)) return false;
      return true;
    });
  }, [conductorOrder, conductorTotals, conductorSearch, selectedRowCounts]);

  const rowCount = filteredConductors.length;
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
    const off = columnVirtualizer.getOffsetForIndex(0, "start");
    const start = off?.[0] ?? 0;
    const vis = columnVirtualizer.getVirtualItems();
    const v0 = vis.find((v) => v.index === 0);
    const w = v0?.size ?? COL_ESTIMATE_PX;
    return start + w / 2;
  }, [slots.length, columnVirtualizer, colCount, columnScrollToken]);

  const toggleCount = (n: number) => {
    setSelectedRowCounts((prev) => {
      const next = new Set(prev);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  };

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 py-2">
        <CardTitle className="text-base font-semibold text-slate-800">
          Programación por conductor
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-2">
        {legendEstados.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Estados (color)
            </span>
            {legendEstados.map((est) => (
              <span
                key={est}
                className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ring-black/10"
                style={{ backgroundColor: colorForConductorEstado(est) }}
              >
                {est}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="flex-1 space-y-2">
            <Label className="text-xs text-slate-600">Filtrar por cantidad de filas (conductor)</Label>
            <div className="flex flex-wrap gap-2">
              {distinctTotals.map((n) => (
                <label
                  key={n}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selectedRowCounts.has(n)}
                    onChange={() => toggleCount(n)}
                  />
                  {n} fila{n === 1 ? "" : "s"}
                </label>
              ))}
              {distinctTotals.length === 0 && (
                <span className="text-xs text-slate-500">Sin datos para filtrar</span>
              )}
            </div>
            {selectedRowCounts.size > 0 && (
              <Button
                variant="ghost"
                size="xs"
                className="h-7 text-xs"
                onClick={() => setSelectedRowCounts(new Set())}
              >
                Limpiar filtros de cantidad
              </Button>
            )}
          </div>
          <div className="w-full max-w-sm space-y-1">
            <Label className="text-xs text-slate-600">Nombre del conductor</Label>
            <Input
              value={conductorSearch}
              onChange={(e) => setConductorSearch(e.target.value)}
              placeholder="Buscar..."
              className="h-9 text-sm"
            />
          </div>
        </div>

        {err && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">{err}</p>
        )}
        {loading && <p className="text-sm text-slate-500">Cargando matriz...</p>}

        {!loading && filteredConductors.length === 0 && (
          <p className="text-sm text-slate-500">No hay conductores que cumplan los filtros.</p>
        )}

        {hover && (
          <div
            className="pointer-events-none fixed z-[100] max-h-[min(70vh,22rem)] max-w-sm overflow-y-auto rounded-lg border border-slate-700 bg-[#0b1131] px-3 py-2 text-xs text-white shadow-xl"
            style={{ left: hover.x, top: hover.y }}
          >
            <p className="font-bold text-white">{hover.conductor}</p>
            <p className="mt-1 text-white/80">Total filas: {hover.total}</p>
            <div className="mt-2 space-y-1.5">
              {hover.trips.map((trip, i) => (
                <div
                  key={`${trip.scheduledAt.getTime()}-${i}-${trip.estado}`}
                  className="flex items-center justify-between gap-3 text-[11px]"
                >
                  <span
                    className="max-w-[55%] truncate rounded-md px-2 py-0.5 font-semibold text-white"
                    style={{ backgroundColor: colorForConductorEstado(trip.estado) }}
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

        {filteredConductors.length > 0 && colCount > 0 && (
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
                {/* Cabecera: sticky arriba; esquina sticky izquierda con z-index mayor */}
                <div
                  className="sticky top-0 z-40 flex bg-slate-100"
                  style={{ height: HEADER_ROW_HEIGHT, width: totalInnerWidth }}
                >
                  <div
                    className="sticky left-0 z-[55] flex shrink-0 items-center border-b border-r border-slate-200 px-2 text-[10px] font-semibold uppercase tracking-wide text-slate-600"
                    style={{
                      width: NAME_COL_WIDTH,
                      height: HEADER_ROW_HEIGHT,
                      boxSizing: "border-box",
                    }}
                  >
                    Conductor
                  </div>
                  <div
                    className="relative shrink-0 border-b border-slate-200 bg-slate-100"
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
                          className="absolute flex flex-col items-center justify-end overflow-hidden border-r border-slate-200 bg-slate-100 px-0.5 pb-0.5 text-center"
                          style={{
                            height: HEADER_ROW_HEIGHT,
                            width: vCol.size,
                            transform: `translateX(${vCol.start}px) translateY(0px)`,
                          }}
                        >
                          <div className="flex h-[15px] w-full items-end justify-center leading-none">
                            {slot.showDateLabel ? (
                              <span className="text-[13px] font-bold text-slate-800">{slot.dateDisplay}</span>
                            ) : null}
                          </div>
                          <span className="mt-0.5 text-[10px] font-medium tabular-nums text-slate-600">
                            {slot.hourDisplay}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Filas virtualizadas */}
                {rowVirtualizer.getVirtualItems().map((vRow) => {
                  const name = filteredConductors[vRow.index];
                  if (!name) return null;
                  const totalRows = conductorTotals.get(name) ?? 0;

                  return (
                    <div
                      key={vRow.key}
                      data-index={vRow.index}
                      className="absolute left-0 top-0 flex bg-white"
                      style={{
                        width: totalInnerWidth,
                        height: vRow.size,
                        transform: `translateX(0px) translateY(${vRow.start}px)`,
                      }}
                    >
                      <div
                        className="sticky left-0 z-30 flex shrink-0 items-center border-b border-r border-slate-200 bg-white px-2 text-xs font-medium text-slate-800"
                        style={{
                          width: NAME_COL_WIDTH,
                          height: vRow.size,
                          boxSizing: "border-box",
                        }}
                      >
                        <span className="line-clamp-2">{name}</span>
                        <Badge variant="secondary" className="ml-1 shrink-0 text-[10px]">
                          {totalRows}
                        </Badge>
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
                          const tripsCell = cellMap.get(name)?.get(slot.ts) ?? EMPTY_TRIPS;
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
                                  conductor: name,
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

                <div
                  className="pointer-events-none absolute z-[38]"
                  style={{
                    left: NAME_COL_WIDTH,
                    top: 0,
                    width: columnVirtualizer.getTotalSize(),
                    height: totalInnerHeight,
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
      </CardContent>
    </Card>
  );
}
