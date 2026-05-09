"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { ExternalLink, Loader2, MapPin, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from "react";

import { LiveDriverGpsDialog } from "@/components/LiveDriverGpsDialog";
import type { NearbyServiceMarker } from "@/components/LiveDriverMap";
import { gpsIconColorFromAvailability } from "@/lib/live-driver-gps-ui";
import {
  fetchLiveDriverLocationByConductorName,
  type DriverLiveAvailability,
  type DriverLiveLocationApiResponse,
  type DriverLiveLocationItem,
} from "@/lib/moobiz-live-driver-location-client";

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
  colorForSeguimientoEstado,
  seguimientoEstadoBadgeRingClass,
  sortEstadoEntriesForMatrix,
  sortEstadosForLegend,
} from "@/lib/seguimiento-estado";

type ViajeRow = {
  id?: string | number | null;
  conductor?: string | null;
  estado?: string | null;
  fecha?: string | null;
  fecha_registro?: string | null;
  producto?: string | null;
};

/** Fila API seguimiento (campos extra de `vista.moobiz_services_maestra`). */
type SeguimientoMatrixRow = ViajeRow & {
  dr_id?: string | number | null;
  org_lat?: number | null;
  org_lng?: number | null;
  dst_zone?: string;
  org_address?: string;
  prioridad_mapa?: number | null;
};

type LiveDriverMapProps = {
  lat: number;
  lng: number;
  fullName: string;
  plate: string;
  iconUrl?: string;
  nearbyServices?: NearbyServiceMarker[];
  /** Opcional: destino desde `vw_driver_live_raw_flat` (Control operaciones). */
  serviceDestination?: import("@/lib/moobiz-live-driver-location-client").DriverLiveServiceDestination | null;
};

const HOUR_MS = 60 * 60 * 1000;
const MIN_AXIS_HOURS = 24;
/** Altura aproximada para ver ~15 filas de conductores + cabecera de horas. */
const MATRIX_MAX_HEIGHT = "min(600px, calc(15 * 2.35rem + 48px))";

const ROW_ESTIMATE_PX = 40;
const COL_ESTIMATE_PX = 44;
const HEADER_ROW_HEIGHT = 48;
const NAME_COL_WIDTH = 220;

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

function parsePrioridadMapa(v: unknown): 1 | 2 | 3 {
  const n = typeof v === "number" ? v : Number(v);
  if (n === 1 || n === 2 || n === 3) return n;
  return 3;
}

function driverGpsCacheKey(conductorName: string, group: SeguimientoMatrixRow[]): string {
  const drIdRaw = group.map((r) => r.dr_id).find((v) => v != null && String(toText(v)) !== "");
  if (drIdRaw != null && String(toText(drIdRaw)) !== "") return String(drIdRaw).trim();
  return `name:${conductorName}`;
}

function buildNearbyMarkersFromSeguimientoRows(rows: SeguimientoMatrixRow[]): NearbyServiceMarker[] {
  const out: NearbyServiceMarker[] = [];
  for (const r of rows) {
    const lat = r.org_lat;
    const lng = r.org_lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const id = r.id;
    if (id === null || id === undefined) continue;
    if (String(id).trim() === "") continue;
    out.push({
      id,
      lat,
      lng,
      alt_date: toText(r.fecha) || toText(r.fecha_registro) || "",
      pr_name: toText(r.producto),
      dst_zone: toText(r.dst_zone),
      prioridad_mapa: parsePrioridadMapa(r.prioridad_mapa),
    });
  }
  return out;
}

function pickConductorDrId(rows: SeguimientoMatrixRow[]): string | null {
  for (const r of rows) {
    const raw = r.dr_id;
    if (raw === null || raw === undefined) continue;
    const s = String(raw).trim();
    if (s) return s;
  }
  return null;
}

function moobizActivesDriverUrl(driverId: string | null): string | null {
  if (driverId === null || driverId === undefined) return null;
  const s = String(driverId).trim();
  if (!s) return null;
  return `https://app.moobiz.pe/actives?id_driver=${encodeURIComponent(s)}`;
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
const MatrixCellBody = memo(function MatrixCellBody({
  trips,
  overlapHighlight,
}: {
  trips: ViajeSlotTrip[] | undefined;
  overlapHighlight?: boolean;
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

  const showOverlapAlert = Boolean(overlapHighlight && total >= 2);

  if (total === 0) {
    return <div className="h-full w-full rounded-md bg-slate-50/90" />;
  }
  return (
    <div
      className={`relative h-full w-full rounded-md ${
        showOverlapAlert ? "ring-2 ring-red-600 ring-offset-0" : ""
      }`}
    >
      <div className="relative flex h-full min-h-0 w-full gap-0.5 overflow-hidden rounded-md bg-slate-100/90 p-0.5">
        {entries.map(([estado, cnt]) => (
          <div
            key={estado}
            className={`flex min-w-[3px] items-center justify-center overflow-hidden rounded-md text-[10px] font-semibold text-white shadow-sm ring-1 ${seguimientoEstadoBadgeRingClass(estado, "cell")}`}
            style={{
              flex: cnt,
              backgroundColor: colorForSeguimientoEstado(estado),
            }}
          >
            {!multi ? (showOverlapAlert ? null : cnt) : null}
          </div>
        ))}
      </div>
      {multi ? (
        <span
          className={`pointer-events-none absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-[0_1px_1px_rgba(0,0,0,0.85)] ${
            showOverlapAlert
              ? "rounded-full bg-red-600 px-1.5 py-0.5 shadow-md ring-1 ring-white/30"
              : ""
          }`}
        >
          {total}
        </span>
      ) : showOverlapAlert ? (
        <span className="pointer-events-none absolute right-0.5 top-0.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-orange-600 px-1 text-[9px] font-bold leading-none text-white shadow ring-1 ring-white/40">
          {total}
        </span>
      ) : null}
    </div>
  );
});

export type SeguimientoOperacionesProps = {
  startDate?: string;
  endDate?: string;
  /** Cuando cambia (p. ej. tras sincronizar Moobiz), se vuelve a cargar la matriz. */
  dataRevision?: number;
};

/** Valores del desplegable Seguimiento (matriz seguimiento operaciones). */
export type SeguimientoOverlapFilter =
  | "all"
  | "suspicious"
  | "level1"
  | "level2"
  | "level3";

export function SeguimientoOperaciones({
  startDate = "",
  endDate = "",
  dataRevision = 0,
}: SeguimientoOperacionesProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const [rows, setRows] = useState<SeguimientoMatrixRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [conductorSearch, setConductorSearch] = useState("");
  const [syncBusy, setSyncBusy] = useState(false);
  const router = useRouter();
  /** Filtro local de seguimiento (cliente): 2+ misma hora / niveles 1–3. */
  const [serviceOverlapFilter, setServiceOverlapFilter] = useState<SeguimientoOverlapFilter>("all");
  /** Primera columna horaria visible (izquierda); niveles 1–3 usan 1ª y/o 2ª columna visible. */
  const [leftVisibleColumnIndex, setLeftVisibleColumnIndex] = useState(0);
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
      const params = new URLSearchParams();
      if (startDate) params.set("startDate", startDate);
      if (endDate) params.set("endDate", endDate);
      const qs = params.toString();
      const url = qs ? `/api/seguimiento-operaciones?${qs}` : "/api/seguimiento-operaciones";
      const res = await fetch(url, { cache: "no-store" });
      const json = (await res.json()) as { data?: SeguimientoMatrixRow[]; error?: string };
      if (!res.ok) throw new Error(json?.error || "Error al cargar seguimiento");
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

  const rowsByConductor = useMemo(() => {
    const m = new Map<string, SeguimientoMatrixRow[]>();
    for (const row of rows) {
      const c = toText(row.conductor);
      if (!c) continue;
      if (!m.has(c)) m.set(c, []);
      m.get(c)!.push(row);
    }
    return m;
  }, [rows]);

  const liveLocationCacheRef = useRef<Map<string, DriverLiveLocationApiResponse>>(new Map());
  const [gpsAvailByDriverId, setGpsAvailByDriverId] = useState<Record<string, DriverLiveAvailability>>({});
  const [gpsModalOpen, setGpsModalOpen] = useState(false);
  const [gpsModalDriver, setGpsModalDriver] = useState<{ id: string; name: string } | null>(null);
  const [gpsModalMarkers, setGpsModalMarkers] = useState<NearbyServiceMarker[]>([]);
  const [gpsModalState, setGpsModalState] = useState<{
    status: "idle" | "loading" | "success" | "error";
    item: DriverLiveLocationItem | null;
  }>({ status: "idle", item: null });
  const [LiveMapComponent, setLiveMapComponent] = useState<ComponentType<LiveDriverMapProps> | null>(
    null,
  );

  const rememberGpsAvailability = useCallback((driverId: string, entry: DriverLiveLocationApiResponse) => {
    if (!entry.ok || !entry.item) return;
    setGpsAvailByDriverId((prev) => {
      if (prev[driverId] === entry.item!.availability) return prev;
      return { ...prev, [driverId]: entry.item!.availability };
    });
  }, []);

  const loadLiveMapChunk = useCallback(() => {
    void import("@/components/LiveDriverMap").then((mod) => {
      setLiveMapComponent(() => mod.default);
    });
  }, []);

  const openGpsModalForConductor = useCallback(
    async (conductorDisplayName: string) => {
      const group = rowsByConductor.get(conductorDisplayName) ?? [];
      const cacheKey = driverGpsCacheKey(conductorDisplayName, group);

      setGpsModalDriver({ id: cacheKey, name: conductorDisplayName });
      setGpsModalOpen(true);
      setGpsModalMarkers(buildNearbyMarkersFromSeguimientoRows(group));
      setLiveMapComponent(null);

      const cached = liveLocationCacheRef.current.get(cacheKey);
      const hasCachedItem = Boolean(cached?.ok && cached.item);
      if (cached?.ok && cached.item) {
        rememberGpsAvailability(cacheKey, cached);
        setGpsModalState({
          status: "success",
          item: cached.item,
        });
        loadLiveMapChunk();
      } else {
        setGpsModalState({ status: "loading", item: null });
      }

      try {
        const normalized = await fetchLiveDriverLocationByConductorName(conductorDisplayName);
        rememberGpsAvailability(cacheKey, normalized);
        if (!normalized.ok || !normalized.item) {
          if (!hasCachedItem) {
            setGpsModalState({ status: "error", item: null });
          }
          return;
        }
        liveLocationCacheRef.current.set(cacheKey, normalized);
        setGpsModalState({
          status: "success",
          item: normalized.item,
        });
        loadLiveMapChunk();
      } catch {
        if (!hasCachedItem) {
          setGpsModalState({ status: "error", item: null });
        }
      }
    },
    [rowsByConductor, rememberGpsAvailability, loadLiveMapChunk],
  );

  const handleGpsDialogOpenChange = useCallback((open: boolean) => {
    setGpsModalOpen(open);
    if (!open) {
      setGpsModalState({ status: "idle", item: null });
      setGpsModalDriver(null);
      setGpsModalMarkers([]);
      setLiveMapComponent(null);
    }
  }, []);

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

  /** Conductores con al menos una celda (misma hora) con 2 o más servicios. */
  const conductorsWithSlotOverlap = useMemo(() => {
    const out = new Set<string>();
    for (const [name, bySlot] of cellMap) {
      for (const trips of bySlot.values()) {
        if (trips.length >= 2) {
          out.add(name);
          break;
        }
      }
    }
    return out;
  }, [cellMap]);

  /** Nivel 1: en la primera columna visible debe existir al menos un "Aceptado". */
  const conductorsWithLevel1 = useMemo(() => {
    const out = new Set<string>();
    const firstTs = slots[leftVisibleColumnIndex]?.ts;
    if (firstTs == null) return out;
    for (const [name, bySlot] of cellMap) {
      const trips = bySlot.get(firstTs) ?? EMPTY_TRIPS;
      if (trips.some((t) => t.estado === "Aceptado")) out.add(name);
    }
    return out;
  }, [cellMap, slots, leftVisibleColumnIndex]);

  /** Nivel 2: en la primera columna visible algún viaje "Iniciado" o "Esperando". */
  const conductorsWithLevel2 = useMemo(() => {
    const out = new Set<string>();
    const firstTs = slots[leftVisibleColumnIndex]?.ts;
    if (firstTs == null) return out;
    for (const [name, bySlot] of cellMap) {
      const firstTrips = bySlot.get(firstTs) ?? EMPTY_TRIPS;
      if (firstTrips.some((t) => t.estado === "Iniciado" || t.estado === "Esperando"))
        out.add(name);
    }
    return out;
  }, [cellMap, slots, leftVisibleColumnIndex]);

  /** Nivel 3: en la segunda columna visible algún viaje "Aceptado". */
  const conductorsWithLevel3 = useMemo(() => {
    const out = new Set<string>();
    const secondTs = slots[leftVisibleColumnIndex + 1]?.ts;
    if (secondTs == null) return out;
    for (const [name, bySlot] of cellMap) {
      const trips = bySlot.get(secondTs) ?? EMPTY_TRIPS;
      if (trips.some((t) => t.estado === "Aceptado")) out.add(name);
    }
    return out;
  }, [cellMap, slots, leftVisibleColumnIndex]);

  const filteredConductors = useMemo(() => {
    const q = conductorSearch.trim().toLowerCase();
    return conductorOrder.filter((name) => {
      if (serviceOverlapFilter === "suspicious") {
        if (!conductorsWithSlotOverlap.has(name)) return false;
      } else if (serviceOverlapFilter === "level1") {
        if (!conductorsWithLevel1.has(name)) return false;
      } else if (serviceOverlapFilter === "level2") {
        if (!conductorsWithLevel2.has(name)) return false;
      } else if (serviceOverlapFilter === "level3") {
        if (!conductorsWithLevel3.has(name)) return false;
      }
      if (q && !name.toLowerCase().includes(q)) return false;
      const total = conductorTotals.get(name) ?? 0;
      if (selectedRowCounts.size > 0 && !selectedRowCounts.has(total)) return false;
      return true;
    });
  }, [
    conductorOrder,
    conductorTotals,
    conductorSearch,
    selectedRowCounts,
    serviceOverlapFilter,
    conductorsWithSlotOverlap,
    conductorsWithLevel1,
    conductorsWithLevel2,
    conductorsWithLevel3,
  ]);

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

  useEffect(() => {
    const el = parentRef.current;
    if (!el) return;
    const updateLeftVisibleColumn = () => {
      const gridScrollLeft = Math.max(0, el.scrollLeft - NAME_COL_WIDTH);
      const idx = Math.max(0, Math.floor(gridScrollLeft / COL_ESTIMATE_PX));
      setLeftVisibleColumnIndex((prev) => (prev === idx ? prev : idx));
    };
    updateLeftVisibleColumn();
    el.addEventListener("scroll", updateLeftVisibleColumn, { passive: true });
    window.addEventListener("resize", updateLeftVisibleColumn);
    return () => {
      el.removeEventListener("scroll", updateLeftVisibleColumn);
      window.removeEventListener("resize", updateLeftVisibleColumn);
    };
  }, []);

  return (
    <>
      <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="border-b border-slate-100 py-2">
        <CardTitle className="text-base font-semibold text-slate-800">
          Seguimiento operaciones
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
                className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold text-white shadow-sm ring-1 ${seguimientoEstadoBadgeRingClass(est, "pill")}`}
                style={{ backgroundColor: colorForSeguimientoEstado(est) }}
              >
                {est}
              </span>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-3 rounded-lg border border-slate-100 bg-slate-50/80 p-3 lg:flex-row lg:flex-wrap lg:items-end">
          <div className="flex-1 space-y-2">
            <Label className="text-xs text-slate-600">Filtrar por cantidad de filas (conductor)</Label>
            <div className="flex flex-wrap items-center gap-2">
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
              <Button
                type="button"
                size="sm"
                variant="default"
                disabled={syncBusy}
                onClick={() => void syncMoobizServices()}
                className="ml-auto h-8 gap-1.5 bg-[#0b1131] px-3 text-xs text-white hover:bg-[#0b1131]/90"
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
          <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-xs text-slate-600">Nombre del conductor</Label>
              <Input
                value={conductorSearch}
                onChange={(e) => setConductorSearch(e.target.value)}
                placeholder="Buscar..."
                className="h-9 text-sm"
              />
            </div>
            <div className="w-full shrink-0 space-y-1 sm:w-[min(100%,280px)]">
              <Label className="text-xs text-slate-600">Seguimiento</Label>
              <Select
                value={serviceOverlapFilter}
                onValueChange={(v) => setServiceOverlapFilter(v as SeguimientoOverlapFilter)}
              >
                <SelectTrigger className="h-9 w-full border-slate-200 bg-white text-sm">
                  <SelectValue placeholder="Filtro" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="suspicious">2+ en misma hora</SelectItem>
                  <SelectItem value="level1">Nivel 1</SelectItem>
                  <SelectItem value="level2">Nivel 2</SelectItem>
                  <SelectItem value="level3">Nivel 3</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
                    className={`max-w-[55%] truncate rounded-md px-2 py-0.5 font-semibold text-white shadow-sm ring-1 ${seguimientoEstadoBadgeRingClass(trip.estado, "pill")}`}
                    style={{ backgroundColor: colorForSeguimientoEstado(trip.estado) }}
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
                    <span className="truncate">Conductor</span>
                    <span className="flex shrink-0 items-center gap-1.5 opacity-80" aria-hidden>
                      <MapPin className="h-3.5 w-3.5 text-slate-400" />
                      <ExternalLink className="h-3.5 w-3.5 text-blue-500" />
                    </span>
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
                  const name = filteredConductors[vRow.index];
                  if (!name) return null;
                  const totalRows = conductorTotals.get(name) ?? 0;
                  const groupRows = rowsByConductor.get(name) ?? [];
                  const gpsKey = driverGpsCacheKey(name, groupRows);
                  const drId = pickConductorDrId(groupRows);
                  if (!drId) {
                    console.error(
                      `[seguimiento] Conductor "${name}" sin dr_id en vista.moobiz_services_maestra; no se construye URL Moobiz.`,
                    );
                  }
                  const moobizHref = moobizActivesDriverUrl(drId);

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
                        className="sticky left-0 z-30 flex w-full shrink-0 items-center justify-between gap-1 border-b border-r border-slate-200 bg-white px-1.5 text-xs font-medium text-slate-800"
                        style={{
                          width: NAME_COL_WIDTH,
                          height: vRow.size,
                          boxSizing: "border-box",
                        }}
                      >
                        <span className="line-clamp-2 min-w-0 flex-1" title={name}>
                          {name}
                        </span>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] tabular-nums">
                            {totalRows}
                          </Badge>
                          <button
                            type="button"
                            title="Ver ubicación GPS"
                            onClick={() => {
                              void openGpsModalForConductor(name);
                            }}
                            className="inline-flex items-center justify-center transition hover:opacity-85"
                          >
                            <MapPin
                              className="h-4 w-4"
                              style={{
                                color: gpsIconColorFromAvailability(
                                  gpsAvailByDriverId[gpsKey] ?? null,
                                ),
                              }}
                            />
                          </button>
                          {moobizHref ? (
                            <a
                              href={moobizHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Abrir conductor en Moobiz"
                              onClick={(e) => e.stopPropagation()}
                              className="inline-flex items-center justify-center text-blue-500 hover:text-blue-600"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          ) : (
                            <span
                              className="inline-flex cursor-not-allowed items-center justify-center text-slate-300"
                              title="Sin dr_id del conductor"
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
                              <MatrixCellBody
                                trips={tripsCell}
                                overlapHighlight={serviceOverlapFilter === "suspicious"}
                              />
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
      </CardContent>
    </Card>

    <LiveDriverGpsDialog
      open={gpsModalOpen}
      onOpenChange={handleGpsDialogOpenChange}
      driverTitle={gpsModalDriver?.name ?? null}
      gpsModalState={gpsModalState}
      nearbyServices={gpsModalMarkers}
      LiveMapComponent={LiveMapComponent}
      mapKey={gpsModalDriver?.id ?? null}
    />
    </>
  );
}
