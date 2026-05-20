"use client";

import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
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
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SeguimientoOperaciones } from "@/components/seguimiento-operaciones";
import {
  LogsSyncHealthBanner,
  type SyncMonitorRow,
} from "@/components/logs-sync-health-banner";
import { DatosPendientesTable } from "@/components/DatosPendientesTable";
import { FlotaConductoresPanel } from "@/components/flota/FlotaConductoresPanel";
import { FlotaPendientesCard } from "@/components/flota-pendientes-card";
import { ProductividadPanel } from "@/components/dashboard/ProductividadPanel";
import { ServiciosMoobizCard } from "@/components/dashboard/ServiciosMoobizCard";
import { ControlOperacionesPanel } from "@/components/control-operaciones-panel";
import { OperacionesDriverFiltersProvider } from "@/context/operaciones-driver-filters-context";
import {
  SCHEDULE_PRODUCT_COLORS,
  SCHEDULE_STACK_ORDER,
  scheduleBucketForProducto,
} from "@/lib/product-categories";
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
  zona?: string | null;
};

type MoobizHistoryRow = {
  id: string | number;
  service_id?: string | null;
  date_finalized?: string | null;
  date_scheduled?: string | null;
  status?: string | null;
  user_name?: string | null;
  amount?: number | string | null;
  raw_data?: unknown;
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

/** Query `datosSub` para la vista en Flota (tab principal `value="datos"`). */
const DATOS_SUB_DATOS_PENDIENTES = "datos-pendientes" as const;
const DATOS_SUB_PENDIENTES = "pendientes" as const;
const DATOS_SUB_CONDUCTORES = "conductores" as const;
const OPERACIONES_SUB_CONTROL = "control" as const;
const OPERACIONES_SUB_SEGUIMIENTO = "seguimiento" as const;
const HISTORY_PAGE_SIZE = 50;
const CHART_AXIS = { fill: "#64748b", fontSize: 11 };
const CHART_GRID = "#e2e8f0";
const CHART_TOOLTIP_STYLE = {
  backgroundColor: "#0b1131",
  border: "1px solid rgba(0,230,118,0.35)",
  borderRadius: 8,
  color: "#fff",
  fontSize: 12,
};

const SCHEDULE_V2_OTHER_LIMA_KEY = "OTROS LIMA" as const;
const SCHEDULE_V2_OTHER_PROVINCIA_KEY = "OTROS PROVINCIA" as const;
const SCHEDULE_V2_STACK_ORDER = [
  ...SCHEDULE_STACK_ORDER.filter((key) => key !== "OTROS"),
  SCHEDULE_V2_OTHER_LIMA_KEY,
  SCHEDULE_V2_OTHER_PROVINCIA_KEY,
] as const;
type ScheduleV2ProductKey = (typeof SCHEDULE_V2_STACK_ORDER)[number];
const SCHEDULE_V2_PRODUCT_COLORS: Record<ScheduleV2ProductKey, string> = {
  BUS: SCHEDULE_PRODUCT_COLORS.BUS,
  FURGON: SCHEDULE_PRODUCT_COLORS.FURGON,
  VAN: SCHEDULE_PRODUCT_COLORS.VAN,
  SPRINTER: SCHEDULE_PRODUCT_COLORS.SPRINTER,
  LOGISTICA: SCHEDULE_PRODUCT_COLORS.LOGISTICA,
  "PROVINCIA VIP": SCHEDULE_PRODUCT_COLORS["PROVINCIA VIP"],
  "VIP LIMA": SCHEDULE_PRODUCT_COLORS["VIP LIMA"],
  "OTROS LIMA": "#94a3b8",
  "OTROS PROVINCIA": "#475569",
};

function ChartTooltipRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-white/80">{label}</span>
      <span className="font-semibold text-[#00e676]">{value}</span>
    </div>
  );
}

type ScheduleTimelineDatumV2 = {
  etiqueta: string;
  total: number;
  hourLabel: string;
  dateLabel: string;
  dateKey: string;
  showDayLabel: boolean;
  dayDividerBefore: boolean;
  BUS: number;
  FURGON: number;
  VAN: number;
  SPRINTER: number;
  LOGISTICA: number;
  "PROVINCIA VIP": number;
  "VIP LIMA": number;
  "OTROS LIMA": number;
  "OTROS PROVINCIA": number;
};

/** Ancho lógico por columna de franja (px): grosor de barras. */
const SCHEDULE_SLOT_PX = 28;

/** Entrada típica de Tooltip en BarChart apilado (Recharts). */
type ScheduleStackRechartsPayloadEntry = {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: ScheduleTimelineDatumV2;
};

type ScheduleStackBarTooltipV2Props = {
  active?: boolean;
  payload?: ReadonlyArray<ScheduleStackRechartsPayloadEntry>;
};

function scheduleStackTooltipDataKeyAsString(entry: ScheduleStackRechartsPayloadEntry): string {
  const raw = entry.dataKey ?? entry.name;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

const ScheduleStackBarTooltipV2 = memo(function ScheduleStackBarTooltipV2(
  props: ScheduleStackBarTooltipV2Props,
) {
  const { active, payload } = props;
  if (!active) return null;
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const datum = payload.find((e) => e?.payload != null)?.payload;
  if (!datum) return null;

  const isKnownProductKey = (k: string): k is ScheduleV2ProductKey =>
    (SCHEDULE_V2_STACK_ORDER as readonly string[]).includes(k);

  const rows: { key: ScheduleV2ProductKey; label: string; value: number; swatch: string }[] = [];

  for (const entry of payload) {
    const keyStr = scheduleStackTooltipDataKeyAsString(entry);
    if (!keyStr || !isKnownProductKey(keyStr)) continue;

    const n = Number(entry.value);
    if (!Number.isFinite(n) || n <= 0) continue;

    const swatch =
      typeof entry.color === "string" && entry.color.length > 0
        ? entry.color
        : SCHEDULE_V2_PRODUCT_COLORS[keyStr];

    rows.push({
      key: keyStr,
      label:
        keyStr === SCHEDULE_V2_OTHER_LIMA_KEY
          ? "Otros Lima"
          : keyStr === SCHEDULE_V2_OTHER_PROVINCIA_KEY
            ? "Otros Provincia"
            : keyStr,
      value: n,
      swatch,
    });
  }

  rows.sort(
    (a, b) => SCHEDULE_V2_STACK_ORDER.indexOf(a.key) - SCHEDULE_V2_STACK_ORDER.indexOf(b.key),
  );
  if (rows.length === 0) return null;
  const columnTotal = rows.reduce((sum, r) => sum + r.value, 0);

  return (
    <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
      <ChartTooltipRow label="Franja" value={datum.etiqueta} />
      {rows.map((row) => (
        <div key={row.key} className="flex items-center justify-between gap-3 text-xs">
          <span className="inline-flex items-center gap-1.5 text-white/90">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ backgroundColor: row.swatch }}
            />
            {row.label}
          </span>
          <span className="font-semibold text-white">{row.value}</span>
        </div>
      ))}
      <ChartTooltipRow label="Total columna" value={columnTotal} />
    </div>
  );
});

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

function formatDateTimeCell(value: unknown): string {
  const s = asText(value);
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-PE", { dateStyle: "short", timeStyle: "short" });
}

function historyStatusBadgeClass(status: unknown): string {
  const s = asText(status).toLowerCase();
  if (s.includes("cancel")) return "bg-red-100 text-red-700 border-red-200";
  if (s.includes("final") || s.includes("complete")) return "bg-emerald-100 text-emerald-700 border-emerald-200";
  if (s.includes("pend")) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-slate-100 text-slate-700 border-slate-200";
}

function DashboardContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { refreshKey } = useRefreshData();
  const [dashboardV2Loading, setDashboardV2Loading] = useState(false);
  const [dashboardV2Error, setDashboardV2Error] = useState<string | null>(null);
  const [dashboardV2Data, setDashboardV2Data] = useState<DashboardResponse | null>(null);
  const [syncingServices, setSyncingServices] = useState(false);
  const [syncingServicesError, setSyncingServicesError] = useState<string | null>(null);
  const [visibleProductsV2, setVisibleProductsV2] = useState<Record<ScheduleV2ProductKey, boolean>>(
    () =>
      Object.fromEntries(SCHEDULE_V2_STACK_ORDER.map((key) => [key, true])) as Record<
        ScheduleV2ProductKey,
        boolean
      >,
  );
  const [mainTab, setMainTab] = useState("dashboard");
  const [datosSubTab, setDatosSubTab] = useState<string>(DATOS_SUB_DATOS_PENDIENTES);
  const [operacionesSubTab, setOperacionesSubTab] = useState<string>(OPERACIONES_SUB_CONTROL);
  const [historyUserSearch, setHistoryUserSearch] = useState("");
  const [historyDateFrom, setHistoryDateFrom] = useState("");
  const [historyDateTo, setHistoryDateTo] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyRows, setHistoryRows] = useState<MoobizHistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [syncMonitorRow, setSyncMonitorRow] = useState<SyncMonitorRow | null>(null);
  const [syncMonitorLoading, setSyncMonitorLoading] = useState(true);
  const [syncMonitorError, setSyncMonitorError] = useState<string | null>(null);
  const [dashboardSubTab, setDashboardSubTab] = useState("reservas");
  const scheduleLegendSessionV2Ref = useRef<{
    restore: Record<ScheduleV2ProductKey, boolean> | null;
    isolateFocus: ScheduleV2ProductKey | null;
  }>({ restore: null, isolateFocus: null });
  const scheduleLegendClickTimerV2Ref = useRef<{
    id: ReturnType<typeof setTimeout>;
    key: ScheduleV2ProductKey;
  } | null>(null);

  const setDatosSubInUrl = useCallback(
    (value: string) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set("datosSub", value);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const setOperacionesSubInUrl = useCallback(
    (value: string) => {
      const p = new URLSearchParams(searchParams.toString());
      p.set("operacionesSub", value);
      const qs = p.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const handleMainTabChange = useCallback(
    (value: string) => {
      if (value === "calidad") {
        router.push("/calidad");
        return;
      }
      setMainTab(value);
      const p = new URLSearchParams(searchParams.toString());
      let changed = false;
      if (value !== "datos" && p.has("datosSub")) {
        p.delete("datosSub");
        changed = true;
      }
      if (value !== "operaciones" && p.has("operacionesSub")) {
        p.delete("operacionesSub");
        changed = true;
      }
      if (changed) {
        const qs = p.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
      }
    },
    [pathname, router, searchParams],
  );

  const operacionesSubAllowed = useMemo(
    () => new Set<string>([OPERACIONES_SUB_CONTROL, OPERACIONES_SUB_SEGUIMIENTO]),
    [],
  );

  const handleOperacionesSubTabChange = useCallback(
    (value: string) => {
      if (!operacionesSubAllowed.has(value)) return;
      setOperacionesSubTab(value);
      setOperacionesSubInUrl(value);
    },
    [operacionesSubAllowed, setOperacionesSubInUrl],
  );

  const datosSubAllowed = useMemo(
    () =>
      new Set<string>([
        DATOS_SUB_DATOS_PENDIENTES,
        DATOS_SUB_PENDIENTES,
        DATOS_SUB_CONDUCTORES,
      ]),
    [],
  );

  const handleDatosSubTabChange = useCallback(
    (value: string) => {
      if (!datosSubAllowed.has(value)) return;
      setDatosSubTab(value);
      setDatosSubInUrl(value);
    },
    [datosSubAllowed, setDatosSubInUrl],
  );

  useEffect(() => {
    if (mainTab !== "operaciones") return;
    const raw = searchParams.get("operacionesSub");
    if (raw === OPERACIONES_SUB_CONTROL || raw === OPERACIONES_SUB_SEGUIMIENTO) {
      setOperacionesSubTab(raw);
      return;
    }
    setOperacionesSubTab(OPERACIONES_SUB_CONTROL);
    setOperacionesSubInUrl(OPERACIONES_SUB_CONTROL);
  }, [mainTab, searchParams, setOperacionesSubInUrl]);

  useEffect(() => {
    if (mainTab !== "datos") return;
    const raw = searchParams.get("datosSub");
    if (
      raw === DATOS_SUB_DATOS_PENDIENTES ||
      raw === DATOS_SUB_PENDIENTES ||
      raw === DATOS_SUB_CONDUCTORES
    ) {
      setDatosSubTab(raw);
      return;
    }
    setDatosSubTab(DATOS_SUB_DATOS_PENDIENTES);
    setDatosSubInUrl(DATOS_SUB_DATOS_PENDIENTES);
  }, [mainTab, searchParams, setDatosSubInUrl]);

  useEffect(() => {
    setHistoryPage(1);
  }, [historyUserSearch, historyDateFrom, historyDateTo]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const p = new URLSearchParams();
      p.set("page", String(historyPage));
      p.set("pageSize", String(HISTORY_PAGE_SIZE));
      const userQ = historyUserSearch.trim();
      if (userQ) p.set("user", userQ);
      if (historyDateFrom) p.set("dateFrom", historyDateFrom);
      if (historyDateTo) p.set("dateTo", historyDateTo);

      const res = await fetch(`/api/moobiz-history?${p.toString()}`, { cache: "no-store" });
      const body = (await res.json()) as {
        data?: MoobizHistoryRow[];
        total?: number;
        error?: string;
      };
      if (!res.ok) throw new Error(body?.error || "No se pudo cargar historial.");
      setHistoryRows(Array.isArray(body.data) ? body.data : []);
      setHistoryTotal(typeof body.total === "number" ? body.total : 0);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : String(e));
      setHistoryRows([]);
      setHistoryTotal(0);
    } finally {
      setHistoryLoading(false);
    }
  }, [historyPage, historyUserSearch, historyDateFrom, historyDateTo]);

  useEffect(() => {
    if (mainTab !== "historial") return;
    void loadHistory();
  }, [mainTab, loadHistory, refreshKey]);

  useEffect(() => {
    let cancelled = false;
    async function loadSyncMonitor() {
      setSyncMonitorLoading(true);
      setSyncMonitorError(null);
      try {
        const res = await fetch("/api/sync-monitor/latest", { cache: "no-store" });
        const body = (await res.json()) as { row?: SyncMonitorRow | null; error?: string | null };
        if (cancelled) return;
        if (!res.ok) {
          setSyncMonitorRow(null);
          setSyncMonitorError(body?.error ?? "No se pudo cargar sync_monitor.");
          return;
        }
        setSyncMonitorRow(body.row ?? null);
        setSyncMonitorError(body.error ?? null);
      } catch (e) {
        if (cancelled) return;
        setSyncMonitorRow(null);
        setSyncMonitorError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setSyncMonitorLoading(false);
      }
    }
    void loadSyncMonitor();
    return () => {
      cancelled = true;
    };
  }, []);

  const historyTotalPages = useMemo(
    () => Math.max(1, Math.ceil(historyTotal / HISTORY_PAGE_SIZE)),
    [historyTotal],
  );
  const historyPageClamped = Math.min(historyPage, historyTotalPages);

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

  const loadDashboardV2 = useCallback(async () => {
    setDashboardV2Loading(true);
    setDashboardV2Error(null);
    try {
      const res = await fetch("/api/dashboard-v2/reservas", {
        cache: "no-store",
      });
      const data = (await res.json()) as DashboardResponse & { error?: string };
      if (!res.ok) throw new Error(data?.error || "No se pudo cargar servicios pendientes.");
      setDashboardV2Data(data);
    } catch (err) {
      setDashboardV2Error(err instanceof Error ? err.message : "Error inesperado en servicios pendientes.");
    } finally {
      setDashboardV2Loading(false);
    }
  }, []);

  const handleSyncServicesV2 = useCallback(async () => {
    setSyncingServices(true);
    setSyncingServicesError(null);
    try {
      const res = await fetch("/api/moobiz-services/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        throw new Error(body?.error || "No se pudo sincronizar servicios.");
      }
      await loadDashboardV2();
    } catch (err) {
      setSyncingServicesError(
        err instanceof Error ? err.message : "Error inesperado al sincronizar servicios.",
      );
    } finally {
      setSyncingServices(false);
    }
  }, [loadDashboardV2]);

  useEffect(() => {
    if (mainTab !== "dashboard" || dashboardSubTab !== "reservas") return;
    void loadDashboardV2();
  }, [mainTab, dashboardSubTab, loadDashboardV2, refreshKey]);

  const visibleScheduleKeysV2 = useMemo(
    () => SCHEDULE_V2_STACK_ORDER.filter((k) => visibleProductsV2[k]),
    [visibleProductsV2],
  );

  const scheduleV2ChartData = dashboardV2Data?.charts.pendingBySchedule ?? [];
  const scheduleV2ChartWidth = Math.max(scheduleV2ChartData.length * SCHEDULE_SLOT_PX, 320);
  const scheduleV2TimelineData = useMemo<ScheduleTimelineDatumV2[]>(() => {
    const grouped = scheduleV2ChartData.reduce<Record<string, Array<{ index: number; time: string }>>>(
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

    const baseData = scheduleV2ChartData.map((item, index) => {
      const { time, date, dateKey } = parseScheduleLabelParts(item.etiqueta);
      const hour24 = extractHour24FromScheduleEtiqueta(item.etiqueta);
      const prevDateKey =
        index > 0 ? parseScheduleLabelParts(scheduleV2ChartData[index - 1]?.etiqueta).dateKey : "";

      return {
        etiqueta: item.etiqueta,
        total: item.total,
        hourLabel: hour24 !== null ? String(hour24).padStart(2, "0") : time ? time.slice(0, 2) : "",
        dateLabel: date,
        dateKey,
        showDayLabel: centerIndexByDay.get(dateKey || `fallback-${index}`) === index,
        dayDividerBefore: index > 0 && Boolean(dateKey) && dateKey !== prevDateKey,
        BUS: 0,
        FURGON: 0,
        VAN: 0,
        SPRINTER: 0,
        LOGISTICA: 0,
        "PROVINCIA VIP": 0,
        "VIP LIMA": 0,
        "OTROS LIMA": 0,
        "OTROS PROVINCIA": 0,
      };
    });

    const bySlot = new Map<string, ScheduleTimelineDatumV2>();
    for (const item of baseData) {
      const hour = extractHour24FromScheduleEtiqueta(item.etiqueta);
      const slotKey = `${item.dateKey}|${hour !== null ? String(hour).padStart(2, "0") : ""}`;
      bySlot.set(slotKey, item);
    }

    for (const viaje of dashboardV2Data?.data ?? []) {
      const d = parseViajeScheduledDate(viaje);
      if (!d) continue;
      const slotKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}|${String(d.getHours()).padStart(2, "0")}`;
      const slot = bySlot.get(slotKey);
      if (!slot) continue;
      const bucket = scheduleBucketForProducto(viaje.producto);
      if (bucket === "OTROS") {
        const zona = asText(viaje.zona).toUpperCase();
        if (zona === "PROVINCIA") {
          slot["OTROS PROVINCIA"] += 1;
        } else {
          slot["OTROS LIMA"] += 1;
        }
      } else {
        slot[bucket] += 1;
      }
    }

    for (const item of baseData) {
      const sum = visibleScheduleKeysV2.reduce((acc, key) => acc + item[key], 0);
      item.total = sum > 0 ? sum : item.total;
    }

    return baseData;
  }, [dashboardV2Data?.data, scheduleV2ChartData, visibleScheduleKeysV2]);

  const scheduleV2YAxisMax = useMemo(() => {
    let m = 0;
    for (const row of scheduleV2TimelineData) {
      if (row.total > m) m = row.total;
    }
    return Math.max(1, m);
  }, [scheduleV2TimelineData]);

  const scheduleV2DatumByEtiqueta = useMemo(() => {
    const map = new Map<string, ScheduleTimelineDatumV2>();
    for (const row of scheduleV2TimelineData) {
      map.set(row.etiqueta, row);
    }
    return map;
  }, [scheduleV2TimelineData]);
  const scheduleV2PendingTotalVisible = useMemo(
    () =>
      scheduleV2TimelineData.reduce(
        (acc, row) =>
          acc +
          SCHEDULE_V2_STACK_ORDER.reduce(
            (rowAcc, key) => rowAcc + (visibleProductsV2[key] ? row[key] : 0),
            0,
          ),
        0,
      ),
    [scheduleV2TimelineData, visibleProductsV2],
  );

  const toggleScheduleProductV2 = useCallback((key: ScheduleV2ProductKey) => {
    scheduleLegendSessionV2Ref.current = { restore: null, isolateFocus: null };
    setVisibleProductsV2((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);
  const handleScheduleLegendIsolateV2 = useCallback((key: ScheduleV2ProductKey) => {
    setVisibleProductsV2((vis) => {
      const session = scheduleLegendSessionV2Ref.current;
      const onlyFocused = SCHEDULE_V2_STACK_ORDER.every((k) =>
        k === key ? vis[k] === true : vis[k] === false,
      );
      if (session.restore && session.isolateFocus === key && onlyFocused) {
        scheduleLegendSessionV2Ref.current = { restore: null, isolateFocus: null };
        return { ...session.restore };
      }
      scheduleLegendSessionV2Ref.current = { restore: { ...vis }, isolateFocus: key };
      const next = {} as Record<ScheduleV2ProductKey, boolean>;
      for (const k of SCHEDULE_V2_STACK_ORDER) {
        next[k] = k === key;
      }
      return next;
    });
  }, []);
  const clearScheduleLegendPendingClickV2 = useCallback(() => {
    const p = scheduleLegendClickTimerV2Ref.current;
    if (p) {
      clearTimeout(p.id);
      scheduleLegendClickTimerV2Ref.current = null;
    }
  }, []);
  const onScheduleLegendItemClickV2 = useCallback(
    (key: ScheduleV2ProductKey) => {
      const pending = scheduleLegendClickTimerV2Ref.current;
      if (pending && pending.key === key) {
        clearTimeout(pending.id);
        scheduleLegendClickTimerV2Ref.current = null;
        return;
      }
      if (pending) {
        clearTimeout(pending.id);
        scheduleLegendClickTimerV2Ref.current = null;
      }
      const id = setTimeout(() => {
        scheduleLegendClickTimerV2Ref.current = null;
        toggleScheduleProductV2(key);
      }, 280);
      scheduleLegendClickTimerV2Ref.current = { id, key };
    },
    [toggleScheduleProductV2],
  );
  const onScheduleLegendItemDoubleClickV2 = useCallback(
    (e: MouseEvent, key: ScheduleV2ProductKey) => {
      e.preventDefault();
      clearScheduleLegendPendingClickV2();
      handleScheduleLegendIsolateV2(key);
    },
    [clearScheduleLegendPendingClickV2, handleScheduleLegendIsolateV2],
  );
  const onScheduleLegendItemKeyDownV2 = useCallback(
    (e: KeyboardEvent, key: ScheduleV2ProductKey) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          clearScheduleLegendPendingClickV2();
          handleScheduleLegendIsolateV2(key);
        } else {
          clearScheduleLegendPendingClickV2();
          toggleScheduleProductV2(key);
        }
      }
    },
    [clearScheduleLegendPendingClickV2, handleScheduleLegendIsolateV2, toggleScheduleProductV2],
  );

  useEffect(
    () => () => {
      const p = scheduleLegendClickTimerV2Ref.current;
      if (p) clearTimeout(p.id);
    },
    [],
  );

  const ScheduleV2XAxisTick = useMemo(
    () =>
      function ScheduleV2XAxisTickFn(props: { x?: number; y?: number; payload?: { value: unknown } }) {
        const { x = 0, y = 0, payload } = props;
        const entry = scheduleV2DatumByEtiqueta.get(asText(payload?.value));
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
    [scheduleV2DatumByEtiqueta],
  );

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <Tabs value={mainTab} onValueChange={handleMainTabChange} className="flex min-h-0 flex-1 flex-col">
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

            <TabsList className="h-8 w-full max-w-2xl flex-wrap bg-white/10 p-0.5 md:h-9">
              <TabsTrigger
                value="dashboard"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Dashboard
              </TabsTrigger>
              <TabsTrigger
                value="operaciones"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Operaciones
              </TabsTrigger>
              <TabsTrigger
                value="datos"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Flota
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Logs
              </TabsTrigger>
              <TabsTrigger
                value="historial"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Historial
              </TabsTrigger>
              <TabsTrigger
                value="calidad"
                className="flex-1 text-xs data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Calidad
              </TabsTrigger>
            </TabsList>

              </div>
            </div>
          }
        >
        <div className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 md:px-6">
          <TabsContent value="datos" className="mt-0 space-y-4 outline-none">
            <Tabs value={datosSubTab} onValueChange={handleDatosSubTabChange} className="w-full">
              <TabsList className="mb-3 grid h-auto min-h-10 w-full max-w-4xl grid-cols-1 gap-1 bg-slate-200/90 p-1 sm:grid-cols-3 sm:gap-0">
                <TabsTrigger
                  value={DATOS_SUB_DATOS_PENDIENTES}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Datos Pendientes
                </TabsTrigger>
                <TabsTrigger
                  value={DATOS_SUB_PENDIENTES}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Pendientes
                </TabsTrigger>
                <TabsTrigger
                  value={DATOS_SUB_CONDUCTORES}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Conductores
                </TabsTrigger>
              </TabsList>
              <TabsContent value={DATOS_SUB_DATOS_PENDIENTES} className="mt-0 space-y-4 outline-none">
                <DatosPendientesTable />
              </TabsContent>
              <TabsContent value={DATOS_SUB_PENDIENTES} className="mt-0 space-y-4 outline-none">
                <FlotaPendientesCard />
              </TabsContent>
              <TabsContent value={DATOS_SUB_CONDUCTORES} className="mt-0 space-y-4 outline-none">
                <FlotaConductoresPanel />
              </TabsContent>
            </Tabs>
          </TabsContent>

          <TabsContent value="operaciones" className="mt-0 outline-none">
            <OperacionesDriverFiltersProvider>
            <Tabs value={operacionesSubTab} onValueChange={handleOperacionesSubTabChange} className="w-full">
              <TabsList className="mb-3 grid h-auto min-h-10 w-full max-w-2xl grid-cols-1 gap-1 bg-slate-200/90 p-1 sm:grid-cols-2 sm:gap-0">
                <TabsTrigger
                  value={OPERACIONES_SUB_CONTROL}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Control
                </TabsTrigger>
                <TabsTrigger
                  value={OPERACIONES_SUB_SEGUIMIENTO}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Seguimiento
                </TabsTrigger>
              </TabsList>
              <div className="mt-0">
                <div
                  className={operacionesSubTab === OPERACIONES_SUB_CONTROL ? "block" : "hidden"}
                  aria-hidden={operacionesSubTab !== OPERACIONES_SUB_CONTROL}
                >
                  <ControlOperacionesPanel />
                </div>
                <div
                  className={
                    operacionesSubTab === OPERACIONES_SUB_SEGUIMIENTO ? "block" : "hidden"
                  }
                  aria-hidden={operacionesSubTab !== OPERACIONES_SUB_SEGUIMIENTO}
                >
                  <SeguimientoOperaciones dataRevision={refreshKey} />
                </div>
              </div>
            </Tabs>
            </OperacionesDriverFiltersProvider>
          </TabsContent>

          <TabsContent value="logs" className="mt-0 space-y-4 outline-none">
            <LogsSyncHealthBanner
              row={syncMonitorRow}
              fetchError={syncMonitorError}
              loading={syncMonitorLoading}
            />
          </TabsContent>

          <TabsContent value="historial" className="mt-0 space-y-4 outline-none">
            <div className="rounded-lg border border-white/10 bg-[#0b1131] text-white shadow-sm">
              <div className="grid grid-cols-1 gap-3 border-t border-white/10 px-3 py-3 md:grid-cols-3 md:px-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="history-user" className="text-[10px] font-medium uppercase tracking-wide text-white/70">
                    Usuario
                  </Label>
                  <Input
                    id="history-user"
                    value={historyUserSearch}
                    onChange={(e) => setHistoryUserSearch(e.target.value)}
                    placeholder="Buscar por usuario..."
                    className="h-9 border-white/20 bg-white/10 text-xs text-white placeholder:text-white/50 md:text-sm"
                    autoComplete="off"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="history-from" className="text-[10px] font-medium uppercase tracking-wide text-white/70">
                    Desde (finalizado)
                  </Label>
                  <Input
                    id="history-from"
                    type="date"
                    value={historyDateFrom}
                    onChange={(e) => setHistoryDateFrom(e.target.value)}
                    className="h-9 border-white/20 bg-white/10 text-xs text-white md:text-sm [color-scheme:dark]"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="history-to" className="text-[10px] font-medium uppercase tracking-wide text-white/70">
                    Hasta (finalizado)
                  </Label>
                  <Input
                    id="history-to"
                    type="date"
                    value={historyDateTo}
                    onChange={(e) => setHistoryDateTo(e.target.value)}
                    className="h-9 border-white/20 bg-white/10 text-xs text-white md:text-sm [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>

            <Card className="border-slate-200 bg-white text-slate-900 shadow-sm">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-3">
                <CardTitle className="text-base font-semibold">Historial de viajes</CardTitle>
                <Badge variant="secondary" className="bg-slate-100 text-slate-700">
                  {historyTotal} registro{historyTotal === 1 ? "" : "s"}
                </Badge>
              </CardHeader>
              <CardContent className="space-y-4 pt-4">
                {historyError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {historyError}
                  </p>
                )}
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <Table>
                    <TableHeader>
                      <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                        <TableHead>ID</TableHead>
                        <TableHead>Servicio</TableHead>
                        <TableHead>Usuario</TableHead>
                        <TableHead>Estado</TableHead>
                        <TableHead>Monto</TableHead>
                        <TableHead>Programado</TableHead>
                        <TableHead>Finalizado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {historyLoading ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                            Cargando historial…
                          </TableCell>
                        </TableRow>
                      ) : historyRows.length === 0 ? (
                        <TableRow>
                          <TableCell colSpan={7} className="py-10 text-center text-sm text-slate-500">
                            No hay registros para los filtros seleccionados.
                          </TableCell>
                        </TableRow>
                      ) : (
                        historyRows.map((row, idx) => {
                          const rowKey = row.id != null ? String(row.id) : `history-${historyPage}-${idx}`;
                          return (
                            <TableRow key={rowKey} className="border-slate-100 text-sm hover:bg-slate-50/80">
                              <TableCell className="font-mono text-xs">{asText(row.id) || "—"}</TableCell>
                              <TableCell className="text-xs">{asText(row.service_id) || "—"}</TableCell>
                              <TableCell className="text-xs">{asText(row.user_name) || "—"}</TableCell>
                              <TableCell>
                                <Badge
                                  variant="outline"
                                  className={`border text-[11px] ${historyStatusBadgeClass(row.status)}`}
                                >
                                  {asText(row.status) || "Sin estado"}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs">S/ {formatMoney(row.amount)}</TableCell>
                              <TableCell className="text-xs">{formatDateTimeCell(row.date_scheduled)}</TableCell>
                              <TableCell className="text-xs">{formatDateTimeCell(row.date_finalized)}</TableCell>
                            </TableRow>
                          );
                        })
                      )}
                    </TableBody>
                  </Table>
                </div>
                <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                  <p className="text-xs text-slate-600">
                    Página {historyPageClamped} de {historyTotalPages} · {HISTORY_PAGE_SIZE} por página
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((prev) => Math.max(1, prev - 1))}
                      disabled={historyPageClamped <= 1 || historyLoading}
                    >
                      Anterior
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setHistoryPage((prev) => Math.min(historyTotalPages, prev + 1))}
                      disabled={historyPageClamped >= historyTotalPages || historyLoading}
                    >
                      Siguiente
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="dashboard" className="mt-0 space-y-4 outline-none">
            <Tabs value={dashboardSubTab} onValueChange={setDashboardSubTab} className="w-full">
              <TabsList className="mb-3 grid h-auto min-h-10 w-full max-w-3xl grid-cols-1 gap-1 bg-slate-200/90 p-1 sm:grid-cols-2 sm:gap-0">
                <TabsTrigger
                  value="reservas"
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Reservas
                </TabsTrigger>
                <TabsTrigger
                  value="productividad"
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Productividad
                </TabsTrigger>
              </TabsList>

              <TabsContent value="reservas" className="mt-0 space-y-4 outline-none">
            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="space-y-1 py-3">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-sm font-semibold text-slate-800">Servicios pendientes</CardTitle>
                  <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-8 shrink-0 text-xs"
                      onClick={() => void handleSyncServicesV2()}
                      disabled={syncingServices}
                    >
                      {syncingServices ? (
                        <>
                          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                          Actualizando...
                        </>
                      ) : (
                        <>
                          <RefreshCw className="mr-1 h-3.5 w-3.5" />
                          Actualizar
                        </>
                      )}
                    </Button>
                    <div className="rounded-lg border border-[#00e676]/40 bg-[#00e676]/15 px-3 py-1 text-right">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-700">
                        {scheduleV2PendingTotalVisible.toLocaleString("es-PE")} pendientes
                      </p>
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_V2_STACK_ORDER.map((key) => {
                    const visible = visibleProductsV2[key];
                    return (
                      <button
                        key={`v2-toggle-${key}`}
                        type="button"
                        onClick={() => onScheduleLegendItemClickV2(key)}
                        onDoubleClick={(e) => onScheduleLegendItemDoubleClickV2(e, key)}
                        onKeyDown={(e) => onScheduleLegendItemKeyDownV2(e, key)}
                        className={`inline-flex cursor-pointer items-center rounded-md border border-transparent px-2 py-0.5 text-[10px] font-semibold text-white outline-offset-2 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400 ${
                          visible ? "" : "opacity-40"
                        }`}
                        style={{ backgroundColor: SCHEDULE_V2_PRODUCT_COLORS[key] }}
                        aria-pressed={visible}
                        aria-label={
                          key === SCHEDULE_V2_OTHER_LIMA_KEY
                            ? `Otros Lima, ${visible ? "visible" : "oculto"} en la grafica`
                            : key === SCHEDULE_V2_OTHER_PROVINCIA_KEY
                              ? `Otros Provincia, ${visible ? "visible" : "oculto"} en la grafica`
                            : `${key}, ${visible ? "visible" : "oculto"} en la grafica`
                        }
                      >
                        {key === SCHEDULE_V2_OTHER_LIMA_KEY
                          ? "OTROS LIMA"
                          : key === SCHEDULE_V2_OTHER_PROVINCIA_KEY
                            ? "OTROS PROVINCIA"
                            : key}
                      </button>
                    );
                  })}
                </div>
                {dashboardV2Error ? (
                  <p className="text-xs text-red-600">{dashboardV2Error}</p>
                ) : dashboardV2Loading ? (
                  <p className="text-xs text-slate-500">Cargando servicios pendientes...</p>
                ) : null}
                {syncingServicesError ? (
                  <p className="text-xs text-red-600">{syncingServicesError}</p>
                ) : null}
              </CardHeader>
              <CardContent className="pb-4">
                <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-slate-100 bg-slate-50/50 [-webkit-overflow-scrolling:touch]">
                  <div className="relative" style={{ width: scheduleV2ChartWidth, height: 350 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={scheduleV2TimelineData}
                        margin={{ top: 10, right: 12, left: 4, bottom: 28 }}
                      >
                        <CartesianGrid stroke={CHART_GRID} vertical={false} />
                        {scheduleV2TimelineData
                          .filter((item) => item.dayDividerBefore)
                          .map((item) => (
                            <ReferenceLine
                              key={`v2-divider-${item.etiqueta}`}
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
                          tick={<ScheduleV2XAxisTick />}
                          interval={0}
                          height={48}
                        />
                        <YAxis
                          tick={CHART_AXIS}
                          width={40}
                          tickLine={false}
                          axisLine={{ stroke: CHART_GRID }}
                          allowDecimals={false}
                          domain={[0, scheduleV2YAxisMax]}
                        />
                        <Tooltip content={<ScheduleStackBarTooltipV2 />} />
                        {visibleScheduleKeysV2.map((key, idx) => (
                          <Bar
                            key={`v2-${key}`}
                            dataKey={key}
                            name={
                              key === SCHEDULE_V2_OTHER_LIMA_KEY
                                ? "Otros Lima"
                                : key === SCHEDULE_V2_OTHER_PROVINCIA_KEY
                                  ? "Otros Provincia"
                                  : key
                            }
                            stackId="productos"
                            isAnimationActive={false}
                            barSize={SCHEDULE_SLOT_PX - 8}
                            maxBarSize={SCHEDULE_SLOT_PX - 6}
                            fill={SCHEDULE_V2_PRODUCT_COLORS[key]}
                            radius={
                              idx === visibleScheduleKeysV2.length - 1
                                ? [4, 4, 0, 0]
                                : [0, 0, 0, 0]
                            }
                          />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>
            <ServiciosMoobizCard />
          </TabsContent>

              <TabsContent value="productividad" className="mt-0 w-full max-w-none px-0 outline-none">
                {/* Recuperar ancho útil frente al px-4/md:px-6 del shell sin afectar otras subpestañas */}
                <div className="-mx-4 min-w-0 w-[calc(100%+2rem)] max-w-none md:-mx-6 md:w-[calc(100%+3rem)]">
                  <ProductividadPanel />
                </div>
              </TabsContent>
            </Tabs>
          </TabsContent>
        </div>
        </MouseRevealHeaderLayout>
      </Tabs>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
