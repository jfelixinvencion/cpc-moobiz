"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
const MATRIX_MAX_HEIGHT = "min(600px, calc(15 * 2.35rem + 3.5rem))";

const ROW_ESTIMATE_PX = 40;
const COL_ESTIMATE_PX = 44;
const HEADER_ROW_HEIGHT = 40;
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

function normalizeEstadoKey(e: string): string {
  return e
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

const ESTADO_COLORS: Record<string, string> = {
  pendiente: "#94a3b8",
  "en camino": "#1e88e5",
  encamino: "#1e88e5",
  "en ruta": "#1565c0",
  completado: "#2e7d32",
  completada: "#2e7d32",
  cancelado: "#c62828",
  cancelada: "#c62828",
  asignado: "#6a1b9a",
  asignada: "#6a1b9a",
  aceptado: "#00897b",
  aceptada: "#00897b",
  programado: "#5d4037",
  programada: "#5d4037",
  "sin estado": "#78909c",
  finalizado: "#558b2f",
  finalizada: "#558b2f",
  iniciado: "#0277bd",
  iniciada: "#0277bd",
};

const FALLBACK_PALETTE = [
  "#7e57c2",
  "#ec407a",
  "#ffa726",
  "#26c6da",
  "#8d6e63",
  "#5c6bc0",
  "#ab47bc",
  "#42a5f5",
  "#789262",
  "#d4e157",
];

function colorForEstado(estado: string): string {
  const k = normalizeEstadoKey(estado);
  if (ESTADO_COLORS[k]) return ESTADO_COLORS[k];
  let h = 0;
  for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) | 0;
  return FALLBACK_PALETTE[Math.abs(h) % FALLBACK_PALETTE.length];
}

type CellAgg = Record<string, number>;

const EMPTY_CELL_AGG: CellAgg = {};

/** Interior de celda; compara por referencia de `agg` (misma entrada en el Map = mismo objeto). */
const MatrixCellBody = memo(function MatrixCellBody({ agg }: { agg: CellAgg | undefined }) {
  const { entries, total, multi } = useMemo(() => {
    const raw = agg ?? {};
    const entries = Object.entries(raw)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]) as [string, number][];
    const total = entries.reduce((a, [, v]) => a + v, 0);
    return { entries, total, multi: entries.length > 1 };
  }, [agg]);

  if (total === 0) {
    return <div className="h-full w-full bg-slate-50/90" />;
  }
  return (
    <>
      <div className="flex h-full min-h-0 w-full overflow-hidden">
        {entries.map(([estado, cnt]) => (
          <div
            key={estado}
            className="flex min-w-[3px] items-center justify-center text-[10px] font-semibold text-white"
            style={{
              flex: cnt,
              backgroundColor: colorForEstado(estado),
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
  startDate: string;
  endDate: string;
  empresa: string;
};

export function ConductorTimelineMatrix({ startDate, endDate, empresa }: ConductorMatrixProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<ViajeRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conductorSearch, setConductorSearch] = useState("");
  const [selectedRowCounts, setSelectedRowCounts] = useState<Set<number>>(new Set());
  const [hover, setHover] = useState<{
    conductor: string;
    slotLabel: string;
    byEstado: CellAgg;
    total: number;
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
  }, [load]);

  const legendEstados = useMemo(() => {
    const set = new Set<string>();
    for (const row of rows) {
      const e = toText(row.estado);
      if (e) set.add(e);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
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

    const slotsArr: { ts: number; label: string }[] = [];
    for (let t = nowFloor; t <= end; t += HOUR_MS) {
      slotsArr.push({ ts: t, label: shortSlotLabel(t) });
    }

    const cell = new Map<string, Map<number, CellAgg>>();
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
      if (!bySlot.has(ts)) bySlot.set(ts, {});
      const agg = bySlot.get(ts)!;
      agg[est] = (agg[est] ?? 0) + 1;
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
      <CardHeader className="border-b border-slate-100 py-3">
        <CardTitle className="text-base font-semibold text-slate-800">
          Programación por conductor
        </CardTitle>
        <p className="text-xs text-slate-500">
          Solo filas con conductor. Eje X desde la hora actual (mínimo {MIN_AXIS_HOURS} h); más horas con
          scroll horizontal. Conductores ordenados por volumen; scroll vertical (~15 filas visibles).
        </p>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {legendEstados.length > 0 && (
          <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              Estados (color)
            </span>
            {legendEstados.map((est) => (
              <span key={est} className="inline-flex items-center gap-1.5 text-xs text-slate-700">
                <span
                  className="inline-block size-3 shrink-0 rounded-sm ring-1 ring-black/10"
                  style={{ backgroundColor: colorForEstado(est) }}
                />
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
            className="pointer-events-none fixed z-[100] max-w-xs rounded-lg border border-slate-700 bg-[#0b1131] px-3 py-2 text-xs text-white shadow-xl"
            style={{ left: hover.x, top: hover.y }}
          >
            <p className="font-semibold text-[#00e676]">{hover.conductor}</p>
            <p className="text-white/80">{hover.slotLabel}</p>
            <p className="mt-1 text-white/60">Total filas: {hover.total}</p>
            {Object.entries(hover.byEstado).map(([est, n]) => (
              <div key={est} className="flex justify-between gap-4">
                <span>{est}</span>
                <span className="font-medium text-[#00e676]">{n}</span>
              </div>
            ))}
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
                          className="absolute flex items-end justify-center overflow-hidden border-r border-slate-200 px-0.5 pb-1 text-center text-[9px] leading-tight text-slate-600"
                          style={{
                            height: HEADER_ROW_HEIGHT,
                            width: vCol.size,
                            transform: `translateX(${vCol.start}px) translateY(0px)`,
                          }}
                        >
                          <span className="rotate-[-38deg] whitespace-nowrap">{slot.label}</span>
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
                          const agg = cellMap.get(name)?.get(slot.ts);
                          const raw = agg ?? {};
                          const entriesForHover = Object.entries(raw)
                            .filter(([, v]) => v > 0)
                            .sort((a, b) => b[1] - a[1]) as [string, number][];
                          const totalHover = entriesForHover.reduce((a, [, v]) => a + v, 0);

                          return (
                            <div
                              key={`${vRow.key}-${vCol.key}`}
                              className="absolute box-border overflow-hidden border-r border-slate-200 bg-white"
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
                                setHover({
                                  conductor: name,
                                  slotLabel: slot.label,
                                  byEstado: Object.fromEntries(entriesForHover),
                                  total: totalHover,
                                  x: e.clientX + 12,
                                  y: e.clientY + 12,
                                });
                              }}
                              onMouseLeave={() => setHover(null)}
                            >
                              <MatrixCellBody agg={agg ?? EMPTY_CELL_AGG} />
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
