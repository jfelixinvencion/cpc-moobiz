"use client";

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ConductorTimelineMatrix } from "@/components/conductor-timeline-matrix";
import { MouseRevealHeaderLayout } from "@/components/mouse-reveal-header-layout";
import { useRefreshData } from "@/context/refresh-data-context";

type Viaje = {
  id: string | number;
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

type DashboardResponse = {
  data: Viaje[];
  kpi: { totalPendientes: number };
  charts: {
    estadoDistribution: Array<{ estado: string; total: number }>;
    pendingByEmpresa: Array<{ empresa: string; total: number }>;
    pendingBySchedule: Array<{ etiqueta: string; total: number }>;
    topOrigens: Array<{ label: string; total: number }>;
    topDestinos: Array<{ label: string; total: number }>;
  };
  filters: { empresas: string[] };
};

const PAGE_SIZE = 50;
const PIE_COLORS = [
  "#00e676",
  "#1e88e5",
  "#5ad8a6",
  "#90caf9",
  "#66bb6a",
  "#42a5f5",
  "#26a69a",
  "#9ccc65",
];

const CHART_AXIS = { fill: "#64748b", fontSize: 11 };
const CHART_GRID = "#e2e8f0";
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#0b1131",
  border: "1px solid rgba(0,230,118,0.35)",
  borderRadius: 8,
  color: "#fff",
  fontSize: 12,
};

function ChartTooltipRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-white/80">{label}</span>
      <span className="font-semibold text-[#00e676]">{value}</span>
    </div>
  );
}

type ScheduleTimelineDatum = {
  etiqueta: string;
  total: number;
  hourLabel: string;
  dateLabel: string;
  dateKey: string;
  showDayLabel: boolean;
  dayDividerBefore: boolean;
  OTROS: number;
  BUS: number;
  FURGON: number;
  VAN: number;
  SPRINTER: number;
  LOGISTICA: number;
  "PROVINCIA VIP": number;
};

const SCHEDULE_CRITICAL_PRODUCTS = [
  "BUS",
  "FURGON",
  "VAN",
  "SPRINTER",
  "LOGISTICA",
  "PROVINCIA VIP",
] as const;
const SCHEDULE_OTHER_KEY = "OTROS" as const;
const SCHEDULE_STACK_ORDER = [SCHEDULE_OTHER_KEY, ...SCHEDULE_CRITICAL_PRODUCTS] as const;
const SCHEDULE_TOOLTIP_ORDER = [...SCHEDULE_CRITICAL_PRODUCTS, SCHEDULE_OTHER_KEY] as const;
const SCHEDULE_PRODUCT_COLORS: Record<(typeof SCHEDULE_STACK_ORDER)[number], string> = {
  OTROS: "#d1d5db",
  BUS: "#1d4ed8",
  FURGON: "#16a34a",
  VAN: "#f97316",
  SPRINTER: "#06b6d4",
  LOGISTICA: "#7c3aed",
  "PROVINCIA VIP": "#e11d48",
};

/** Ancho lógico por columna de franja (px): scroll, ventana visible y grosor de barras. */
const SCHEDULE_SLOT_PX = 28;
/** Columnas extra a cada lado del viewport para scroll suave. */
const SCHEDULE_VIEW_BUFFER_COLUMNS = 16;

function buildScheduleWindowSlice(
  full: ScheduleTimelineDatum[],
  start: number,
  end: number,
): ScheduleTimelineDatum[] {
  const n = full.length;
  if (n === 0 || end <= start) return [];
  const s = Math.max(0, Math.min(start, n - 1));
  const e = Math.max(s + 1, Math.min(end, n));
  const prevDateKey = s > 0 ? (full[s - 1]?.dateKey ?? "") : "";
  return full.slice(s, e).map((row, i) => {
    if (i > 0) return row;
    return {
      ...row,
      dayDividerBefore: s > 0 && Boolean(row.dateKey) && row.dateKey !== prevDateKey,
    };
  });
}

type ScheduleTooltipRenderProps = {
  active?: boolean;
  payload?: ReadonlyArray<{ payload?: ScheduleTimelineDatum }>;
};

const ScheduleProductTooltip = memo(function ScheduleProductTooltip(props: ScheduleTooltipRenderProps) {
  const { active, payload } = props;
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  const detailRows = SCHEDULE_TOOLTIP_ORDER.map((k) => ({
    key: k,
    label: k === "OTROS" ? "Otros" : k,
    value: p[k],
  })).filter((x) => x.value > 0);
  return (
    <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
      <ChartTooltipRow label="Franja" value={p.etiqueta} />
      {detailRows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-white/90">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: SCHEDULE_PRODUCT_COLORS[row.key] }}
            />
            {row.label}
          </span>
          <span className="font-semibold text-white">{row.value}</span>
        </div>
      ))}
      <ChartTooltipRow label="Total columna" value={p.total} />
    </div>
  );
});

function normalizeProductoKey(value: unknown): string {
  return asText(value)
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function scheduleBucketForProducto(value: unknown): (typeof SCHEDULE_STACK_ORDER)[number] {
  const key = normalizeProductoKey(value);
  const compact = key.replace(/\s+/g, "");
  if (key === "VIP" || compact === "PROVINCIAVIP") {
    return "PROVINCIA VIP";
  }
  if ((SCHEDULE_CRITICAL_PRODUCTS as readonly string[]).includes(key)) {
    return key as (typeof SCHEDULE_STACK_ORDER)[number];
  }
  return SCHEDULE_OTHER_KEY;
}

function parseScheduleLabelParts(value: unknown): { time: string; date: string; dateKey: string } {
  const raw = asText(value);
  if (!raw) return { time: "", date: "", dateKey: "" };

  const timeMatch = raw.match(
    /(\d{1,2})\s*:\s*(\d{2})(?::\s*(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i,
  );
  const dateMatch = raw.match(/(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?/);

  const time = timeMatch ? `${timeMatch[1]}:${timeMatch[2]}${timeMatch[3] ? `:${timeMatch[3]}` : ""}${timeMatch[4] ? ` ${timeMatch[4]}` : ""}` : "";
  const day = dateMatch ? dateMatch[1].padStart(2, "0") : "";
  const month = dateMatch ? dateMatch[2].padStart(2, "0") : "";
  const year = dateMatch?.[3]
    ? dateMatch[3].length === 2
      ? `20${dateMatch[3]}`
      : dateMatch[3]
    : String(new Date().getFullYear());
  const date = day && month ? `${day}/${month}/${year}` : "";
  const dateKey = day && month ? `${year}-${month}-${day}` : "";

  if (!time && !date) {
    const trimmed = raw.length > 10 ? `${raw.slice(0, 10)}…` : raw;
    return { time: trimmed, date: "", dateKey: "" };
  }

  return { time, date, dateKey };
}

/** Hora 0–23 desde la etiqueta de franja (soporta 24h y 12h con AM/PM). */
function extractHour24FromScheduleEtiqueta(raw: string): number | null {
  const m = raw.match(
    /(\d{1,2})\s*:\s*(\d{2})(?::\s*(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?/i,
  );
  if (!m) return null;
  let h = Number(m[1]);
  const mer = m[4] ? m[4].toLowerCase().replace(/\./g, "").trim() : "";
  if (mer.startsWith("p")) {
    if (h < 12) h += 12;
  } else if (mer.startsWith("a")) {
    if (h === 12) h = 0;
  }
  if (!Number.isFinite(h) || h < 0 || h > 23) return null;
  return h;
}

function parseViajeScheduledDate(v: Viaje): Date | null {
  const candidate = asText(v.fecha) || asText(v.fecha_registro);
  if (!candidate) return null;
  const isoTry = new Date(candidate);
  if (!Number.isNaN(isoTry.getTime())) return isoTry;
  const m = candidate.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?)?/i,
  );
  if (!m) return null;
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

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function formatMoney(value: unknown): string {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num)) return asText(value) || "0";
  return num.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function HomePage() {
  const router = useRouter();
  const { refreshKey, triggerRefresh } = useRefreshData();
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const [empresaFilter, setEmpresaFilter] = useState("TODAS");
  const [estadoFilter, setEstadoFilter] = useState("TODOS");
  const [conductorFilter, setConductorFilter] = useState("TODOS");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null);
  const [reservasEmpresa, setReservasEmpresa] = useState("Todas");
  const [reservasStartDate, setReservasStartDate] = useState("");
  const [reservasEndDate, setReservasEndDate] = useState("");
  const [mainTab, setMainTab] = useState("datos");
  const [dashboardSubTab, setDashboardSubTab] = useState("reservas");
  const [scheduleProductVisibility, setScheduleProductVisibility] = useState<
    Record<(typeof SCHEDULE_STACK_ORDER)[number], boolean>
  >({
    OTROS: true,
    BUS: true,
    FURGON: true,
    VAN: true,
    SPRINTER: true,
    LOGISTICA: true,
    "PROVINCIA VIP": true,
  });
  const scheduleTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const scheduleTimelineDataRef = useRef<ScheduleTimelineDatum[]>([]);
  const scheduleScrollRafRef = useRef<number | null>(null);
  const [scheduleViewWindow, setScheduleViewWindow] = useState({ start: 0, end: 0 });
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [dashboardRefreshedAt, setDashboardRefreshedAt] = useState<Date | null>(null);
  const [dashboardAgeTick, setDashboardAgeTick] = useState(0);

  const loadViajes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/viajes?scope=all", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudieron cargar los viajes.");
      const records = Array.isArray(data?.data) ? data.data : [];
      setViajes(records);
      setLastUpdate(new Date());
      setSelectedIds([]);
      setPage(1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al cargar viajes.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadViajes();
  }, [loadViajes]);

  useEffect(() => {
    if (!syncNotice) return;
    const t = window.setTimeout(() => setSyncNotice(null), 4500);
    return () => window.clearTimeout(t);
  }, [syncNotice]);

  useEffect(() => {
    if (!dashboardRefreshedAt) return;
    const id = window.setInterval(() => setDashboardAgeTick((n) => n + 1), 10000);
    return () => window.clearInterval(id);
  }, [dashboardRefreshedAt]);

  const empresas = useMemo(() => {
    return Array.from(new Set(viajes.map((v) => asText(v.empresa)).filter(Boolean))).sort();
  }, [viajes]);

  const estados = useMemo(() => {
    return Array.from(new Set(viajes.map((v) => asText(v.estado)).filter(Boolean))).sort();
  }, [viajes]);

  const conductores = useMemo(() => {
    return Array.from(new Set(viajes.map((v) => asText(v.conductor)).filter(Boolean))).sort();
  }, [viajes]);

  const filteredViajes = useMemo(() => {
    const query = search.trim().toLowerCase();
    return viajes.filter((v) => {
      const empresaOk = empresaFilter === "TODAS" || asText(v.empresa) === empresaFilter;
      const estadoOk = estadoFilter === "TODOS" || asText(v.estado) === estadoFilter;
      const conductorOk =
        conductorFilter === "TODOS" || asText(v.conductor) === conductorFilter;
      const textOk =
        !query ||
        [
          v.id,
          v.empresa,
          v.usuario,
          v.conductor,
          v.estado,
          v.pasajero,
          v.fecha,
          v.producto,
          v.monto,
          v.origen,
          v.destino,
          v.operador,
        ]
          .map((x) => asText(x).toLowerCase())
          .some((value) => value.includes(query));

      return empresaOk && estadoOk && conductorOk && textOk;
    });
  }, [conductorFilter, empresaFilter, estadoFilter, search, viajes]);

  const totalPages = Math.max(1, Math.ceil(filteredViajes.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);

  const pageItems = useMemo(() => {
    const start = (currentPage - 1) * PAGE_SIZE;
    return filteredViajes.slice(start, start + PAGE_SIZE);
  }, [currentPage, filteredViajes]);

  useEffect(() => {
    setPage(1);
  }, [empresaFilter, estadoFilter, conductorFilter, search]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const pageIds = pageItems.map((v) => asText(v.id)).filter(Boolean);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id));

  const toggleRow = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const togglePage = () => {
    setSelectedIds((prev) => {
      const prevSet = new Set(prev);
      if (allPageSelected) {
        return prev.filter((id) => !pageIds.includes(id));
      }
      pageIds.forEach((id) => prevSet.add(id));
      return Array.from(prevSet);
    });
  };

  const handleDelete = async (ids: string[]) => {
    if (ids.length === 0) return;
    setDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/viajes", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "No se pudieron eliminar los viajes.");
      await loadViajes();
      triggerRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al eliminar.");
    } finally {
      setDeleting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/auth/logout", {
        method: "POST",
      });
    } finally {
      router.replace("/login");
      router.refresh();
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    try {
      const res = await fetch("/api/extract", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Fallo al actualizar desde Moobiz.");
      await loadViajes();
      triggerRefresh();
      setSyncNotice("Datos actualizados. El dashboard se sincronizo automaticamente.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado al actualizar.");
    } finally {
      setSyncing(false);
    }
  };

  const loadDashboard = useCallback(async () => {
    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const params = new URLSearchParams();
      if (reservasStartDate) params.set("startDate", reservasStartDate);
      if (reservasEndDate) params.set("endDate", reservasEndDate);
      if (reservasEmpresa && reservasEmpresa !== "Todas") {
        params.set("empresa", reservasEmpresa);
      }
      const query = params.toString();
      const res = await fetch(`/api/viajes${query ? `?${query}` : ""}`, { cache: "no-store" });
      const data = (await res.json()) as DashboardResponse & { error?: string };
      if (!res.ok) throw new Error(data?.error || "No se pudo cargar el dashboard.");
      setDashboardData(data);
      setDashboardRefreshedAt(new Date());
    } catch (err) {
      setDashboardError(err instanceof Error ? err.message : "Error inesperado en dashboard.");
    } finally {
      setDashboardLoading(false);
    }
  }, [reservasStartDate, reservasEndDate, reservasEmpresa]);

  useEffect(() => {
    if (mainTab !== "dashboard" || dashboardSubTab !== "reservas") return;
    void loadDashboard();
  }, [mainTab, dashboardSubTab, loadDashboard, refreshKey]);

  const reservasEmpresaOptions = dashboardData?.filters.empresas ?? [];

  const scheduleChartData = dashboardData?.charts.pendingBySchedule ?? [];
  const scheduleChartWidth = Math.max(scheduleChartData.length * SCHEDULE_SLOT_PX, 320);
  const visibleScheduleKeys = useMemo(
    () => SCHEDULE_STACK_ORDER.filter((k) => scheduleProductVisibility[k]),
    [scheduleProductVisibility],
  );
  const scheduleTimelineData = useMemo<ScheduleTimelineDatum[]>(() => {
    const grouped = scheduleChartData.reduce<Record<string, Array<{ index: number; time: string }>>>(
      (acc, item, index) => {
        const parts = parseScheduleLabelParts(item.etiqueta);
        const key = parts.dateKey || `fallback-${index}`;
        if (!acc[key]) acc[key] = [];
        acc[key].push({ index, time: parts.time });
        return acc;
      },
      {},
    );

    const centerIndexByDay = new Map<string, number>();
    Object.entries(grouped).forEach(([dateKey, items]) => {
      centerIndexByDay.set(dateKey, items[Math.floor((items.length - 1) / 2)]?.index ?? -1);
    });

    const baseData = scheduleChartData.map((item, index) => {
      const { time, date, dateKey } = parseScheduleLabelParts(item.etiqueta);
      const hour24 = extractHour24FromScheduleEtiqueta(item.etiqueta);
      const prevDateKey =
        index > 0 ? parseScheduleLabelParts(scheduleChartData[index - 1]?.etiqueta).dateKey : "";

      return {
        etiqueta: item.etiqueta,
        total: item.total,
        hourLabel: hour24 !== null ? String(hour24).padStart(2, "0") : time ? time.slice(0, 2) : "",
        dateLabel: date,
        dateKey,
        showDayLabel: centerIndexByDay.get(dateKey || `fallback-${index}`) === index,
        dayDividerBefore: index > 0 && Boolean(dateKey) && dateKey !== prevDateKey,
        OTROS: 0,
        BUS: 0,
        FURGON: 0,
        VAN: 0,
        SPRINTER: 0,
        LOGISTICA: 0,
        "PROVINCIA VIP": 0,
      };
    });

    const bySlot = new Map<string, ScheduleTimelineDatum>();
    for (const item of baseData) {
      const hour = extractHour24FromScheduleEtiqueta(item.etiqueta);
      const slotKey = `${item.dateKey}|${hour !== null ? String(hour).padStart(2, "0") : ""}`;
      bySlot.set(slotKey, item);
    }

    for (const viaje of dashboardData?.data ?? []) {
      const d = parseViajeScheduledDate(viaje);
      if (!d) continue;
      const slotKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}|${String(d.getHours()).padStart(2, "0")}`;
      const slot = bySlot.get(slotKey);
      if (!slot) continue;
      const bucket = scheduleBucketForProducto(viaje.producto);
      slot[bucket] += 1;
    }

    for (const item of baseData) {
      const sum =
        item.OTROS +
        item.BUS +
        item.FURGON +
        item.VAN +
        item.SPRINTER +
        item.LOGISTICA +
        item["PROVINCIA VIP"];
      item.total = sum > 0 ? sum : item.total;
    }

    return baseData;
  }, [dashboardData?.data, scheduleChartData]);

  scheduleTimelineDataRef.current = scheduleTimelineData;

  const scheduleSlotCount = scheduleTimelineData.length;
  const scheduleViewUnset = scheduleViewWindow.end === 0 && scheduleSlotCount > 0;
  const scheduleViewStart = scheduleViewUnset ? 0 : scheduleViewWindow.start;
  const scheduleViewEnd = scheduleViewUnset ? scheduleSlotCount : scheduleViewWindow.end;

  const scheduleChartViewportSlice = useMemo(
    () => buildScheduleWindowSlice(scheduleTimelineData, scheduleViewStart, scheduleViewEnd),
    [scheduleTimelineData, scheduleViewStart, scheduleViewEnd],
  );

  const scheduleYAxisMax = useMemo(() => {
    let m = 0;
    for (const row of scheduleTimelineData) {
      if (row.total > m) m = row.total;
    }
    return Math.max(1, m);
  }, [scheduleTimelineData]);

  const scheduleDatumByEtiqueta = useMemo(() => {
    const map = new Map<string, ScheduleTimelineDatum>();
    for (const row of scheduleTimelineData) {
      map.set(row.etiqueta, row);
    }
    return map;
  }, [scheduleTimelineData]);

  const syncScheduleViewport = useCallback(() => {
    const el = scheduleTimelineScrollRef.current;
    const n = scheduleTimelineDataRef.current.length;
    if (!el || n === 0) {
      setScheduleViewWindow((prev) => (prev.start === 0 && prev.end === 0 ? prev : { start: 0, end: 0 }));
      return;
    }
    const buffer = SCHEDULE_VIEW_BUFFER_COLUMNS;
    const scrollLeft = el.scrollLeft;
    const clientW = Math.max(1, el.clientWidth);
    const totalW = Math.max(n * SCHEDULE_SLOT_PX, 320);
    const slotW = totalW / n;
    const first = Math.max(0, Math.floor(scrollLeft / slotW) - buffer);
    const rawLast = Math.ceil((scrollLeft + clientW) / slotW) + buffer;
    const last = Math.min(n, Math.max(first + 1, rawLast));
    setScheduleViewWindow((prev) => {
      if (prev.start === first && prev.end === last) return prev;
      return { start: first, end: last };
    });
  }, []);

  const onScheduleChartScroll = useCallback(() => {
    if (scheduleScrollRafRef.current != null) return;
    scheduleScrollRafRef.current = window.requestAnimationFrame(() => {
      scheduleScrollRafRef.current = null;
      syncScheduleViewport();
    });
  }, [syncScheduleViewport]);

  useLayoutEffect(() => {
    scheduleTimelineDataRef.current = scheduleTimelineData;
    syncScheduleViewport();
  }, [scheduleTimelineData, syncScheduleViewport]);

  useEffect(
    () => () => {
      if (scheduleScrollRafRef.current != null) {
        cancelAnimationFrame(scheduleScrollRafRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    const el = scheduleTimelineScrollRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      syncScheduleViewport();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [syncScheduleViewport]);

  const toggleScheduleProduct = useCallback((key: (typeof SCHEDULE_STACK_ORDER)[number]) => {
    setScheduleProductVisibility((prev) => {
      const turningOn = !prev[key];
      const next = { ...prev, [key]: !prev[key] };
      if (turningOn) {
        const rows = scheduleTimelineDataRef.current;
        queueMicrotask(() => {
          const container = scheduleTimelineScrollRef.current;
          if (!container) return;
          const n = rows.length || 1;
          const idx = rows.findIndex((row) => (row[key] ?? 0) > 0);
          if (idx < 0) {
            container.scrollTo({ left: 0, behavior: "smooth" });
            return;
          }
          const slotWidth = container.scrollWidth / n;
          const slotCenter = idx * slotWidth + slotWidth / 2;
          const maxLeft = Math.max(0, container.scrollWidth - container.clientWidth);
          const targetLeft = Math.max(0, Math.min(maxLeft, slotCenter - container.clientWidth / 2));
          container.scrollTo({ left: targetLeft, behavior: "smooth" });
        });
      }
      return next;
    });
  }, []);

  const dashboardAgeLabel = useMemo(() => {
    void dashboardAgeTick;
    if (!dashboardRefreshedAt) return null;
    return formatDistanceToNow(dashboardRefreshedAt, { addSuffix: true, locale: es });
  }, [dashboardRefreshedAt, dashboardAgeTick]);

  const ScheduleXAxisTick = useMemo(
    () =>
      function ScheduleXAxisTickFn(props: { x?: number; y?: number; payload?: { value: unknown } }) {
        const { x = 0, y = 0, payload } = props;
        const entry = scheduleDatumByEtiqueta.get(asText(payload?.value));
        if (!entry) return null;
        return (
          <g transform={`translate(${x},${y})`}>
            {entry.hourLabel ? (
              <text
                x={0}
                y={0}
                dy={2}
                textAnchor="middle"
                style={{ fontSize: 10, fontWeight: 500, fill: CHART_AXIS.fill }}
              >
                {entry.hourLabel}
              </text>
            ) : null}
            {entry.showDayLabel && entry.dateLabel ? (
              <text
                x={0}
                y={0}
                dy={20}
                textAnchor="middle"
                style={{ fontSize: 12, fontWeight: 700, fill: "#334155" }}
              >
                {entry.dateLabel}
              </text>
            ) : null}
          </g>
        );
      },
    [scheduleDatumByEtiqueta],
  );

  const scheduleViewportChartWidth = Math.max(
    (scheduleViewEnd - scheduleViewStart) * SCHEDULE_SLOT_PX,
    240,
  );

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <Tabs value={mainTab} onValueChange={setMainTab} className="flex min-h-0 flex-1 flex-col">
        <MouseRevealHeaderLayout
          header={
            <div className="border-b border-white/10 text-white">
              <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 py-2 md:px-6">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                <span className="text-xl font-bold tracking-tight text-[#00e676] md:text-2xl">moobiz.</span>
                <span className="text-xs text-white/60 md:text-sm">Panel de viajes</span>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <div className="max-w-[min(100%,220px)] truncate text-[10px] text-white/70 sm:max-w-none md:text-xs">
                  Ultima actualizacion:{" "}
                  <span className="font-medium text-white">
                    {lastUpdate ? lastUpdate.toLocaleString("es-PE") : "Sin datos"}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleSync()}
                  disabled={syncing || loading}
                  className="h-8 shrink-0 bg-[#00e676] px-3 text-xs font-semibold text-[#0b1131] hover:bg-[#00c765] md:h-9 md:text-sm"
                >
                  {syncing ? "Actualizando..." : "Actualizar"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleLogout()}
                  className="h-8 shrink-0 border-[#00e676]/45 bg-transparent text-xs text-[#00e676] hover:bg-[#00e676]/15 hover:text-[#00e676] md:h-9"
                >
                  Cerrar sesion
                </Button>
              </div>
            </div>

            <TabsList className="h-8 w-full max-w-md bg-white/10 p-0.5 md:h-9">
              <TabsTrigger
                value="datos"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Datos
              </TabsTrigger>
              <TabsTrigger
                value="dashboard"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Dashboard
              </TabsTrigger>
            </TabsList>

            {mainTab === "datos" && (
              <div className="flex flex-col gap-2 border-t border-white/10 pt-2 pb-1">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
                  <Select value={empresaFilter} onValueChange={setEmpresaFilter}>
                    <SelectTrigger className="h-9 w-full border-white/20 bg-white/10 text-xs text-white md:text-sm">
                      <SelectValue placeholder="Empresa" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODAS">Todas las empresas</SelectItem>
                      {empresas.map((empresa) => (
                        <SelectItem key={empresa} value={empresa}>
                          {empresa}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={estadoFilter} onValueChange={setEstadoFilter}>
                    <SelectTrigger className="h-9 w-full border-white/20 bg-white/10 text-xs text-white md:text-sm">
                      <SelectValue placeholder="Estado" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todos los estados</SelectItem>
                      {estados.map((estado) => (
                        <SelectItem key={estado} value={estado}>
                          {estado}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={conductorFilter} onValueChange={setConductorFilter}>
                    <SelectTrigger className="h-9 w-full border-white/20 bg-white/10 text-xs text-white md:text-sm">
                      <SelectValue placeholder="Conductor" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TODOS">Todos los conductores</SelectItem>
                      {conductores.map((conductor) => (
                        <SelectItem key={conductor} value={conductor}>
                          {conductor}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Buscar..."
                    className="h-9 border-white/20 bg-white/10 text-xs text-white placeholder:text-white/50 md:text-sm lg:col-span-2"
                  />
                  <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-2 xl:col-span-1 xl:justify-end">
                    {selectedIds.length > 0 && (
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => void handleDelete(selectedIds)}
                        disabled={deleting}
                      >
                        {deleting ? "..." : `Eliminar (${selectedIds.length})`}
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
              </div>
            </div>
          }
        >
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6">
          <TabsContent value="datos" className="mt-0 outline-none">
            <Card className="border-slate-200 bg-white text-slate-900 shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-3">
                <CardTitle className="text-base font-semibold">Viajes activos</CardTitle>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                  Mostrando {pageItems.length} de {filteredViajes.length}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {error && (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {error}
                  </p>
                )}
                <div className="overflow-hidden rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                        <TableHead className="w-10 text-slate-700">
                          <input
                            type="checkbox"
                            checked={allPageSelected}
                            onChange={togglePage}
                            aria-label="Seleccionar pagina"
                          />
                        </TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">ID</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Empresa</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Usuario</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Conductor</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Estado</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Pasajero</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Fecha</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Producto</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Monto</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Origen</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Destino</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Operador</TableHead>
                        <TableHead className="text-xs font-semibold text-slate-700">Acciones</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {loading ? (
                        <TableRow>
                          <TableCell colSpan={14} className="py-10 text-center text-sm text-slate-500">
                            Cargando datos...
                          </TableCell>
                        </TableRow>
                      ) : pageItems.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={14} className="py-10 text-center text-sm text-slate-500">
                            No hay viajes para los filtros seleccionados.
                          </TableCell>
                        </TableRow>
                      ) : (
                        pageItems.map((viaje) => {
                          const id = asText(viaje.id);
                          return (
                            <TableRow key={id} className="border-slate-100 text-sm hover:bg-slate-50/80">
                              <TableCell>
                                <input
                                  type="checkbox"
                                  checked={selectedSet.has(id)}
                                  onChange={() => toggleRow(id)}
                                  aria-label={`Seleccionar viaje ${id}`}
                                />
                              </TableCell>
                              <TableCell className="font-mono text-xs">{id}</TableCell>
                              <TableCell className="max-w-[140px] truncate text-xs">
                                {asText(viaje.empresa)}
                              </TableCell>
                              <TableCell className="max-w-[120px] truncate text-xs">
                                {asText(viaje.usuario)}
                              </TableCell>
                              <TableCell className="max-w-[120px] truncate text-xs">
                                {asText(viaje.conductor)}
                              </TableCell>
                              <TableCell className="text-xs">{asText(viaje.estado)}</TableCell>
                              <TableCell className="max-w-[100px] truncate text-xs">
                                {asText(viaje.pasajero)}
                              </TableCell>
                              <TableCell className="whitespace-normal text-xs">
                                {asText(viaje.fecha)}
                              </TableCell>
                              <TableCell className="max-w-[100px] truncate text-xs">
                                {asText(viaje.producto)}
                              </TableCell>
                              <TableCell className="text-xs">{formatMoney(viaje.monto)}</TableCell>
                              <TableCell className="max-w-[140px] truncate text-xs">
                                {asText(viaje.origen)}
                              </TableCell>
                              <TableCell className="max-w-[140px] truncate text-xs">
                                {asText(viaje.destino)}
                              </TableCell>
                              <TableCell className="max-w-[100px] truncate text-xs">
                                {asText(viaje.operador)}
                              </TableCell>
                              <TableCell>
                                <Button
                                  variant="destructive"
                                  size="xs"
                                  onClick={() => void handleDelete([id])}
                                  disabled={deleting}
                                >
                                  Eliminar
                                </Button>
                              </TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <p className="text-xs text-slate-600">
                    Pagina {currentPage} de {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                      disabled={currentPage === 1}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
                      disabled={currentPage >= totalPages}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="mt-0 space-y-4 outline-none">
            {dashboardError && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {dashboardError}
              </p>
            )}

            <Tabs value={dashboardSubTab} onValueChange={setDashboardSubTab} className="w-full">
              <TabsList className="mb-3 h-10 w-full max-w-xl bg-slate-200/90 p-1">
                <TabsTrigger
                  value="reservas"
                  className="flex-1 text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm"
                >
                  Reservas
                </TabsTrigger>
                <TabsTrigger
                  value="conductores"
                  className="flex-1 text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm"
                >
                  Conductores en el tiempo
                </TabsTrigger>
              </TabsList>

              <TabsContent value="conductores" className="mt-0 outline-none">
                <ConductorTimelineMatrix dataRevision={refreshKey} />
              </TabsContent>

              <TabsContent value="reservas" className="mt-0 space-y-4 outline-none">
                <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm sm:flex-row sm:items-start sm:justify-between">
                  <div className="order-2 grid w-full min-w-0 flex-1 grid-cols-1 gap-2 sm:order-1 sm:grid-cols-[minmax(0,1.2fr)] sm:gap-3">
                    <div className="flex min-w-0 flex-col gap-1 sm:col-span-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        Empresa
                      </span>
                      <Select value={reservasEmpresa} onValueChange={setReservasEmpresa}>
                        <SelectTrigger className="h-9 w-full min-w-0 border-slate-200 bg-white text-sm">
                          <SelectValue placeholder="Empresa" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Todas">Todas</SelectItem>
                          {reservasEmpresaOptions.map((empresa) => (
                            <SelectItem key={empresa} value={empresa}>
                              {empresa}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="order-1 shrink-0 self-end rounded-lg border border-[#00e676]/40 bg-[#00e676]/15 px-4 py-2 sm:order-2 sm:self-auto sm:min-w-[140px]">
                    <p className="text-[10px] uppercase tracking-wide text-slate-600/90">
                      Pendientes (filtro)
                    </p>
                    <p className="text-2xl font-bold leading-none text-[#00e676]">
                      {dashboardData?.kpi.totalPendientes ?? 0}
                    </p>
                  </div>
                </div>
                {dashboardLoading && (
                  <p className="text-xs text-slate-500">Actualizando graficos...</p>
                )}
                {!dashboardLoading && dashboardAgeLabel && (
                  <p className="text-[10px] text-slate-500">
                    Graficos del dashboard actualizados {dashboardAgeLabel} (segun empresa seleccionada arriba).
                  </p>
                )}
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="space-y-3 py-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <CardTitle className="text-base font-semibold text-slate-800">
                      Pendientes por franja de programacion
                    </CardTitle>
                    <p className="text-xs text-slate-500">
                      Desde la primera hora con viaje pendiente hasta la ultima. Minimo 24 h en el eje;
                      desplaza horizontalmente si hay mas franjas.
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
                    {SCHEDULE_TOOLTIP_ORDER.map((key) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => toggleScheduleProduct(key)}
                        className={`rounded-md border px-2 py-1 text-[10px] font-semibold transition ${
                          scheduleProductVisibility[key]
                            ? "border-slate-300 bg-white text-slate-700"
                            : "border-slate-200 bg-slate-100 text-slate-400"
                        }`}
                      >
                        <span
                          className="mr-1 inline-block h-2 w-2 rounded-full"
                          style={{ backgroundColor: SCHEDULE_PRODUCT_COLORS[key] }}
                        />
                        {key === "OTROS" ? "Otros" : key}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_TOOLTIP_ORDER.map((key) => (
                    <span
                      key={`legend-${key}`}
                      className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold text-white"
                      style={{ backgroundColor: SCHEDULE_PRODUCT_COLORS[key] }}
                    >
                      {key === "OTROS" ? "Otros" : key}
                    </span>
                  ))}
                </div>
              </CardHeader>
              <CardContent className="pb-4">
                <div
                  ref={scheduleTimelineScrollRef}
                  onScroll={onScheduleChartScroll}
                  className="overflow-x-auto overflow-y-hidden rounded-lg border border-slate-100 bg-slate-50/50 [-webkit-overflow-scrolling:touch]"
                >
                  <div className="relative" style={{ width: scheduleChartWidth, height: 350 }}>
                    <div
                      className="absolute top-0"
                      style={{
                        left: scheduleViewStart * SCHEDULE_SLOT_PX,
                        width: scheduleViewportChartWidth,
                        height: 350,
                      }}
                    >
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={scheduleChartViewportSlice}
                          margin={{ top: 10, right: 12, left: 4, bottom: 28 }}
                        >
                          <CartesianGrid stroke={CHART_GRID} vertical={false} />
                          {scheduleChartViewportSlice
                            .filter((item) => item.dayDividerBefore)
                            .map((item) => (
                              <ReferenceLine
                                key={`divider-${item.etiqueta}`}
                                x={item.etiqueta}
                                position="start"
                                ifOverflow="visible"
                                stroke="rgba(6, 182, 212, 0.3)"
                                strokeDasharray="4 4"
                                strokeWidth={1}
                              />
                            ))}
                          <XAxis
                            dataKey="etiqueta"
                            tickLine={false}
                            axisLine={{ stroke: CHART_GRID }}
                            tick={<ScheduleXAxisTick />}
                            interval={0}
                            height={48}
                          />
                          <YAxis
                            tick={CHART_AXIS}
                            width={40}
                            tickLine={false}
                            axisLine={{ stroke: CHART_GRID }}
                            allowDecimals={false}
                            domain={[0, scheduleYAxisMax]}
                          />
                          <Tooltip content={ScheduleProductTooltip} />
                          {visibleScheduleKeys.map((key, idx) => (
                            <Bar
                              key={key}
                              dataKey={key}
                              name={key === "OTROS" ? "Otros" : key}
                              stackId="productos"
                              isAnimationActive={false}
                              barSize={SCHEDULE_SLOT_PX - 8}
                              maxBarSize={SCHEDULE_SLOT_PX - 6}
                              fill={SCHEDULE_PRODUCT_COLORS[key]}
                              radius={
                                idx === visibleScheduleKeys.length - 1
                                  ? [4, 4, 0, 0]
                                  : [0, 0, 0, 0]
                              }
                            />
                          ))}
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold text-slate-800">
                    Distribucion global por estado
                  </CardTitle>
                  <p className="text-xs text-slate-500">
                    Segun empresa seleccionada arriba.
                  </p>
                </CardHeader>
                <CardContent className="h-[300px] pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                      <Pie
                        data={dashboardData?.charts.estadoDistribution ?? []}
                        dataKey="total"
                        nameKey="estado"
                        cx="50%"
                        cy="50%"
                        innerRadius={40}
                        outerRadius={88}
                        paddingAngle={1}
                      >
                        {(dashboardData?.charts.estadoDistribution ?? []).map((_, idx) => (
                          <Cell key={idx} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as { estado: string; total: number };
                          return (
                            <div className="min-w-[160px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
                              <p className="text-[11px] font-semibold text-white/90">Estado</p>
                              <ChartTooltipRow label={p.estado} value={p.total} />
                            </div>
                          );
                        }}
                      />
                      <Legend
                        wrapperStyle={{ fontSize: 11 }}
                        formatter={(value) => (
                          <span className="text-slate-600">{String(value)}</span>
                        )}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold text-slate-800">
                    Pendientes por empresa
                  </CardTitle>
                </CardHeader>
                <CardContent className="h-[300px] pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dashboardData?.charts.pendingByEmpresa ?? []}
                      layout="vertical"
                      margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                      <XAxis type="number" tick={CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                      <YAxis
                        dataKey="empresa"
                        type="category"
                        width={100}
                        tick={{ ...CHART_AXIS, fontSize: 10 }}
                        tickFormatter={(v) => (String(v).length > 18 ? `${String(v).slice(0, 16)}…` : String(v))}
                        tickLine={false}
                        axisLine={{ stroke: CHART_GRID }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as { empresa: string; total: number };
                          return (
                            <div className="min-w-[180px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
                              <ChartTooltipRow label="Empresa" value={p.empresa} />
                              <ChartTooltipRow label="Viajes pendientes" value={p.total} />
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="total" name="Viajes" fill="#00e676" radius={[0, 4, 4, 0]} maxBarSize={22} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold text-slate-800">Top 10 origenes</CardTitle>
                </CardHeader>
                <CardContent className="h-[280px] pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dashboardData?.charts.topOrigens ?? []}
                      layout="vertical"
                      margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                      <XAxis type="number" tick={CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                      <YAxis
                        dataKey="label"
                        type="category"
                        width={110}
                        tick={{ ...CHART_AXIS, fontSize: 9 }}
                        tickFormatter={(v) => (String(v).length > 20 ? `${String(v).slice(0, 18)}…` : String(v))}
                        tickLine={false}
                        axisLine={{ stroke: CHART_GRID }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as { label: string; total: number };
                          return (
                            <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
                              <ChartTooltipRow label="Origen" value={p.label} />
                              <ChartTooltipRow label="Viajes pendientes" value={p.total} />
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="total" fill="#00e676" radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold text-slate-800">Top 10 destinos</CardTitle>
                </CardHeader>
                <CardContent className="h-[280px] pb-4">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dashboardData?.charts.topDestinos ?? []}
                      layout="vertical"
                      margin={{ top: 4, right: 12, left: 4, bottom: 4 }}
                    >
                      <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                      <XAxis type="number" tick={CHART_AXIS} tickLine={false} axisLine={{ stroke: CHART_GRID }} />
                      <YAxis
                        dataKey="label"
                        type="category"
                        width={110}
                        tick={{ ...CHART_AXIS, fontSize: 9 }}
                        tickFormatter={(v) => (String(v).length > 20 ? `${String(v).slice(0, 18)}…` : String(v))}
                        tickLine={false}
                        axisLine={{ stroke: CHART_GRID }}
                      />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const p = payload[0].payload as { label: string; total: number };
                          return (
                            <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
                              <ChartTooltipRow label="Destino" value={p.label} />
                              <ChartTooltipRow label="Viajes pendientes" value={p.total} />
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey="total" fill="#1e88e5" radius={[0, 4, 4, 0]} maxBarSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </div>
        </MouseRevealHeaderLayout>
      </Tabs>

      {syncNotice ? (
        <div
          role="status"
          className="fixed bottom-4 right-4 z-[60] max-w-sm rounded-lg border border-[#00e676]/40 bg-[#0b1131] px-4 py-3 text-sm text-white shadow-lg"
        >
          <p className="font-medium text-[#00e676]">Listo</p>
          <p className="mt-1 text-white/90">{syncNotice}</p>
        </div>
      ) : null}
    </main>
  );
}
