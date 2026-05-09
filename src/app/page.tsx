"use client";

import {
  endOfISOWeek,
  format,
  formatDistanceToNow,
  getISOWeek,
  getISOWeeksInYear,
  getISOWeekYear,
  setISOWeek,
  setISOWeekYear,
  startOfISOWeek,
} from "date-fns";
import { es } from "date-fns/locale";
import {
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
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
import { Label } from "@/components/ui/label";
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
import { SeguimientoOperaciones } from "@/components/seguimiento-operaciones";
import {
  LogsSyncHealthBanner,
  type SyncMonitorRow,
} from "@/components/logs-sync-health-banner";
import { DatosPendientesTable } from "@/components/DatosPendientesTable";
import { ControlOperacionesPanel } from "@/components/control-operaciones-panel";
import {
  type ScheduleProductKey,
  SCHEDULE_PRODUCT_COLORS,
  SCHEDULE_STACK_ORDER,
  SCHEDULE_TOOLTIP_ORDER,
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

type ProductividadSeriesRow = { us_name: string; count: number };
type ProductividadApiResponse = {
  series?: ProductividadSeriesRow[];
  typeLogOptions?: string[];
  meta?: {
    year: number;
    week: number;
    rowCount: number;
    capped: boolean;
    start: string;
    end: string;
  } | null;
  error?: string;
};

const PROD_WEEKDAY_SELECT = [
  { value: "all", label: "Toda la semana" },
  { value: "1", label: "Lunes" },
  { value: "2", label: "Martes" },
  { value: "3", label: "Miércoles" },
  { value: "4", label: "Jueves" },
  { value: "5", label: "Viernes" },
  { value: "6", label: "Sábado" },
  { value: "7", label: "Domingo" },
] as const;

/** Semana ISO: lunes 00:00 → domingo fin (mismo criterio que la API si se envía `from`/`to`). */
function prodIsoWeekBounds(isoWeekYear: number, week: number): { start: Date; end: Date } {
  const ref = new Date(isoWeekYear, 5, 15, 12, 0, 0, 0);
  const inWeek = setISOWeek(setISOWeekYear(ref, isoWeekYear), week);
  return { start: startOfISOWeek(inWeek), end: endOfISOWeek(inWeek) };
}

function formatProdWeekSelectLabel(isoWeekYear: number, week: number): string {
  const { start, end } = prodIsoWeekBounds(isoWeekYear, week);
  return `Semana ${week} (${format(start, "dd/MM")} al ${format(end, "dd/MM")})`;
}

function defaultProdWeekKey(): string {
  const d = new Date();
  return `${getISOWeekYear(d)}-${getISOWeek(d)}`;
}

function parseProdWeekKey(key: string): { y: number; w: number } | null {
  const m = /^(\d{4})-(\d{1,2})$/.exec(key.trim());
  if (!m) return null;
  const y = Number.parseInt(m[1], 10);
  const w = Number.parseInt(m[2], 10);
  if (!Number.isFinite(y) || !Number.isFinite(w) || w < 1 || w > 53) return null;
  return { y, w };
}

function buildProdWeekSelectOptions(): { value: string; label: string }[] {
  const cy = getISOWeekYear(new Date());
  const out: { value: string; label: string }[] = [];
  for (const y of [cy - 1, cy, cy + 1]) {
    const weeksInYear = getISOWeeksInYear(new Date(y, 5, 15));
    for (let w = 1; w <= weeksInYear; w++) {
      out.push({ value: `${y}-${w}`, label: formatProdWeekSelectLabel(y, w) });
    }
  }
  out.sort((a, b) => {
    const pa = parseProdWeekKey(a.value);
    const pb = parseProdWeekKey(b.value);
    if (!pa || !pb) return 0;
    if (pa.y !== pb.y) return pb.y - pa.y;
    return pb.w - pa.w;
  });
  return out;
}

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
const OPERACIONES_SUB_CONTROL = "control" as const;
const OPERACIONES_SUB_CONDUCTORES_TIEMPO = "conductores-tiempo" as const;
const OPERACIONES_SUB_SEGUIMIENTO = "seguimiento" as const;
const HISTORY_PAGE_SIZE = 50;
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
  "VIP LIMA": number;
};
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

function scheduleVisibilityOnlyOne(key: ScheduleProductKey): Record<ScheduleProductKey, boolean> {
  const o = {} as Record<ScheduleProductKey, boolean>;
  for (const k of SCHEDULE_STACK_ORDER) {
    o[k] = k === key;
  }
  return o;
}

function scheduleOnlyProductVisible(
  vis: Record<ScheduleProductKey, boolean>,
  key: ScheduleProductKey,
): boolean {
  return SCHEDULE_STACK_ORDER.every((k) => (k === key ? vis[k] === true : vis[k] === false));
}

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

/** Entrada típica de Tooltip en BarChart apilado (Recharts). */
type ScheduleStackRechartsPayloadEntry = {
  dataKey?: unknown;
  name?: unknown;
  value?: unknown;
  color?: string;
  payload?: ScheduleTimelineDatum | ScheduleTimelineDatumV2;
};

type ScheduleStackBarTooltipProps = {
  active?: boolean;
  payload?: ReadonlyArray<ScheduleStackRechartsPayloadEntry>;
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

function scheduleTooltipOrderIndexForSort(dataKey: string): number {
  const order = SCHEDULE_TOOLTIP_ORDER as readonly string[];
  const i = order.indexOf(dataKey);
  return i === -1 ? 999 : i;
}

/**
 * Tooltip custom del gráfico de franjas: filtra por `Number(value) > 0`.
 * Recharts a veces entrega `value` como string; se coacciona antes de comparar.
 */
const ScheduleStackBarTooltip = memo(function ScheduleStackBarTooltip(props: ScheduleStackBarTooltipProps) {
  const { active, payload } = props;
  if (!active) return null;
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const datum = payload.find((e) => e?.payload != null)?.payload;
  if (!datum) return null;

  const isKnownProductKey = (k: string): k is ScheduleProductKey =>
    (SCHEDULE_STACK_ORDER as readonly string[]).includes(k);

  const rows: { key: ScheduleProductKey; label: string; value: number; swatch: string }[] = [];

  for (const entry of payload) {
    const keyStr = scheduleStackTooltipDataKeyAsString(entry);
    if (!keyStr || !isKnownProductKey(keyStr)) continue;

    const n = Number(entry.value);
    if (!Number.isFinite(n)) {
      if (process.env.NODE_ENV === "development" && entry.value != null && `${entry.value}`.trim() !== "") {
        console.debug(
          "[ScheduleStackBarTooltip] Valor no numérico en serie; se omite:",
          { dataKey: keyStr, value: entry.value },
        );
      }
      continue;
    }
    if (n <= 0) continue;

    const swatch =
      typeof entry.color === "string" && entry.color.length > 0
        ? entry.color
        : SCHEDULE_PRODUCT_COLORS[keyStr];

    rows.push({
      key: keyStr,
      label: keyStr === "OTROS" ? "Otros" : keyStr,
      value: n,
      swatch,
    });
  }

  rows.sort((a, b) => scheduleTooltipOrderIndexForSort(a.key) - scheduleTooltipOrderIndexForSort(b.key));

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
  const { refreshKey, triggerRefresh } = useRefreshData();
  const [syncing, setSyncing] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [dashboardData, setDashboardData] = useState<DashboardResponse | null>(null);
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
  const [reservasEmpresa, setReservasEmpresa] = useState("Todas");
  const [reservasStartDate, setReservasStartDate] = useState("");
  const [reservasEndDate, setReservasEndDate] = useState("");
  const [mainTab, setMainTab] = useState("dashboard");
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
  const [prodWeekKey, setProdWeekKey] = useState(() => defaultProdWeekKey());
  const [prodWeekday, setProdWeekday] = useState<string>("all");
  const [prodTypeLog, setProdTypeLog] = useState<string>("__all__");
  const [prodSeries, setProdSeries] = useState<ProductividadSeriesRow[]>([]);
  const [prodTypeOptions, setProdTypeOptions] = useState<string[]>([]);
  const [prodMeta, setProdMeta] = useState<ProductividadApiResponse["meta"]>(null);
  const [prodLoading, setProdLoading] = useState(false);
  const [prodError, setProdError] = useState<string | null>(null);
  const [scheduleProductVisibility, setScheduleProductVisibility] = useState<
    Record<(typeof SCHEDULE_STACK_ORDER)[number], boolean>
  >(() =>
    Object.fromEntries(SCHEDULE_STACK_ORDER.map((key) => [key, true])) as Record<
      ScheduleProductKey,
      boolean
    >,
  );
  const scheduleTimelineScrollRef = useRef<HTMLDivElement | null>(null);
  const scheduleTimelineDataRef = useRef<ScheduleTimelineDatum[]>([]);
  const scheduleScrollRafRef = useRef<number | null>(null);
  /** Doble click en leyenda: snapshot para restaurar; foco del producto aislado. */
  const scheduleLegendSessionRef = useRef<{
    restore: Record<ScheduleProductKey, boolean> | null;
    isolateFocus: ScheduleProductKey | null;
  }>({ restore: null, isolateFocus: null });
  const scheduleLegendClickTimerRef = useRef<{
    id: ReturnType<typeof setTimeout>;
    key: ScheduleProductKey;
  } | null>(null);
  const scheduleLegendSessionV2Ref = useRef<{
    restore: Record<ScheduleV2ProductKey, boolean> | null;
    isolateFocus: ScheduleV2ProductKey | null;
  }>({ restore: null, isolateFocus: null });
  const scheduleLegendClickTimerV2Ref = useRef<{
    id: ReturnType<typeof setTimeout>;
    key: ScheduleV2ProductKey;
  } | null>(null);
  const [scheduleLegendUiEpoch, setScheduleLegendUiEpoch] = useState(0);
  const [scheduleLegendHintOpen, setScheduleLegendHintOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return !window.localStorage.getItem("scheduleLegendHintSeen");
    } catch {
      return false;
    }
  });
  const [scheduleViewWindow, setScheduleViewWindow] = useState({ start: 0, end: 0 });
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [dashboardRefreshedAt, setDashboardRefreshedAt] = useState<Date | null>(null);
  const [dashboardAgeTick, setDashboardAgeTick] = useState(0);

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
    () =>
      new Set<string>([
        OPERACIONES_SUB_CONTROL,
        OPERACIONES_SUB_CONDUCTORES_TIEMPO,
        OPERACIONES_SUB_SEGUIMIENTO,
      ]),
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

  useEffect(() => {
    if (mainTab !== "operaciones") return;
    const raw = searchParams.get("operacionesSub");
    if (
      raw === OPERACIONES_SUB_CONTROL ||
      raw === OPERACIONES_SUB_CONDUCTORES_TIEMPO ||
      raw === OPERACIONES_SUB_SEGUIMIENTO
    ) {
      setOperacionesSubTab(raw);
      return;
    }
    setOperacionesSubTab(OPERACIONES_SUB_CONTROL);
    setOperacionesSubInUrl(OPERACIONES_SUB_CONTROL);
  }, [mainTab, searchParams, setOperacionesSubInUrl]);

  useEffect(() => {
    if (mainTab !== "datos") return;
    const raw = searchParams.get("datosSub");
    if (raw === DATOS_SUB_DATOS_PENDIENTES) return;
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

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await fetch("/api/extract", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Fallo al actualizar desde Moobiz.");
      setLastUpdate(new Date());
      triggerRefresh();
      setSyncNotice("Datos actualizados. El dashboard se sincronizo automaticamente.");
    } catch (err) {
      setSyncNotice(err instanceof Error ? err.message : "Error inesperado al actualizar.");
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

  const loadDashboardV2 = useCallback(async () => {
    setDashboardV2Loading(true);
    setDashboardV2Error(null);
    try {
      const params = new URLSearchParams();
      if (reservasStartDate) params.set("startDate", reservasStartDate);
      if (reservasEndDate) params.set("endDate", reservasEndDate);
      if (reservasEmpresa && reservasEmpresa !== "Todas") {
        params.set("empresa", reservasEmpresa);
      }
      const query = params.toString();
      const res = await fetch(`/api/dashboard-v2/reservas${query ? `?${query}` : ""}`, {
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
  }, [reservasStartDate, reservasEndDate, reservasEmpresa]);

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
    void loadDashboard();
  }, [mainTab, dashboardSubTab, loadDashboard, refreshKey]);

  useEffect(() => {
    if (mainTab !== "dashboard" || dashboardSubTab !== "reservas") return;
    void loadDashboardV2();
  }, [mainTab, dashboardSubTab, loadDashboardV2, refreshKey]);

  const loadProductividad = useCallback(async () => {
    setProdLoading(true);
    setProdError(null);
    try {
      const parsed = parseProdWeekKey(prodWeekKey);
      if (!parsed) throw new Error("Semana invalida.");
      const { start, end } = prodIsoWeekBounds(parsed.y, parsed.w);
      const p = new URLSearchParams();
      p.set("from", start.toISOString());
      p.set("to", end.toISOString());
      if (prodWeekday !== "all") p.set("weekday", prodWeekday);
      if (prodTypeLog !== "__all__") p.set("typeLogName", prodTypeLog);
      const res = await fetch(`/api/moobiz-logs-clean/productivity?${p.toString()}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as ProductividadApiResponse;
      if (!res.ok) throw new Error(body?.error || "No se pudo cargar productividad.");
      setProdSeries(Array.isArray(body.series) ? body.series : []);
      setProdTypeOptions(Array.isArray(body.typeLogOptions) ? body.typeLogOptions : []);
      setProdMeta(body.meta ?? null);
    } catch (e) {
      setProdError(e instanceof Error ? e.message : String(e));
      setProdSeries([]);
      setProdTypeOptions([]);
      setProdMeta(null);
    } finally {
      setProdLoading(false);
    }
  }, [prodWeekKey, prodWeekday, prodTypeLog]);

  useEffect(() => {
    if (mainTab !== "dashboard" || dashboardSubTab !== "productividad") return;
    void loadProductividad();
  }, [mainTab, dashboardSubTab, loadProductividad, refreshKey]);

  const prodWeekSelectOptions = useMemo(() => buildProdWeekSelectOptions(), []);
  const prodChartHeight = useMemo(
    () => Math.min(880, Math.max(300, prodSeries.length * 24 + 80)),
    [prodSeries.length],
  );

  const reservasEmpresaOptions = dashboardData?.filters.empresas ?? [];

  const scheduleChartData = dashboardData?.charts.pendingBySchedule ?? [];
  const scheduleChartWidth = Math.max(scheduleChartData.length * SCHEDULE_SLOT_PX, 320);
  const visibleScheduleKeys = useMemo(
    () => SCHEDULE_STACK_ORDER.filter((k) => scheduleProductVisibility[k]),
    [scheduleProductVisibility],
  );
  const visibleScheduleKeysV2 = useMemo(
    () => SCHEDULE_V2_STACK_ORDER.filter((k) => visibleProductsV2[k]),
    [visibleProductsV2],
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
        "VIP LIMA": 0,
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
      const sum = SCHEDULE_STACK_ORDER.reduce((acc, key) => acc + item[key], 0);
      item.total = sum > 0 ? sum : item.total;
    }

    return baseData;
  }, [dashboardData?.data, scheduleChartData]);

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

  const scrollScheduleChartToProduct = useCallback((key: ScheduleProductKey, turnedOn: boolean) => {
    if (!turnedOn) return;
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
  }, []);

  const toggleScheduleProduct = useCallback(
    (key: ScheduleProductKey) => {
      scheduleLegendSessionRef.current = { restore: null, isolateFocus: null };
      setScheduleLegendUiEpoch((e) => e + 1);
      setScheduleProductVisibility((prev) => {
        const turningOn = !prev[key];
        const next = { ...prev, [key]: !prev[key] };
        scrollScheduleChartToProduct(key, turningOn);
        return next;
      });
    },
    [scrollScheduleChartToProduct],
  );

  const handleScheduleLegendIsolate = useCallback(
    (key: ScheduleProductKey) => {
      setScheduleProductVisibility((vis) => {
        const session = scheduleLegendSessionRef.current;
        if (
          session.restore &&
          session.isolateFocus === key &&
          scheduleOnlyProductVisible(vis, key)
        ) {
          scheduleLegendSessionRef.current = { restore: null, isolateFocus: null };
          return { ...session.restore };
        }
        scheduleLegendSessionRef.current = { restore: { ...vis }, isolateFocus: key };
        queueMicrotask(() => {
          scrollScheduleChartToProduct(key, true);
        });
        return scheduleVisibilityOnlyOne(key);
      });
      setScheduleLegendUiEpoch((e) => e + 1);
    },
    [scrollScheduleChartToProduct],
  );

  const clearScheduleLegendPendingClick = useCallback(() => {
    const p = scheduleLegendClickTimerRef.current;
    if (p) {
      clearTimeout(p.id);
      scheduleLegendClickTimerRef.current = null;
    }
  }, []);

  const onScheduleLegendItemClick = useCallback(
    (key: ScheduleProductKey) => {
      const pending = scheduleLegendClickTimerRef.current;
      if (pending && pending.key === key) {
        clearTimeout(pending.id);
        scheduleLegendClickTimerRef.current = null;
        return;
      }
      if (pending) {
        clearTimeout(pending.id);
        scheduleLegendClickTimerRef.current = null;
      }
      const id = setTimeout(() => {
        scheduleLegendClickTimerRef.current = null;
        toggleScheduleProduct(key);
      }, 280);
      scheduleLegendClickTimerRef.current = { id, key };
    },
    [toggleScheduleProduct],
  );

  const onScheduleLegendItemDoubleClick = useCallback(
    (e: MouseEvent, key: ScheduleProductKey) => {
      e.preventDefault();
      clearScheduleLegendPendingClick();
      handleScheduleLegendIsolate(key);
    },
    [clearScheduleLegendPendingClick, handleScheduleLegendIsolate],
  );

  const onScheduleLegendItemKeyDown = useCallback(
    (e: KeyboardEvent, key: ScheduleProductKey) => {
      if (e.key === "Enter") {
        e.preventDefault();
        if (e.shiftKey) {
          clearScheduleLegendPendingClick();
          handleScheduleLegendIsolate(key);
        } else {
          clearScheduleLegendPendingClick();
          toggleScheduleProduct(key);
        }
      }
    },
    [clearScheduleLegendPendingClick, handleScheduleLegendIsolate, toggleScheduleProduct],
  );

  const restoreScheduleLegendView = useCallback(() => {
    const snap = scheduleLegendSessionRef.current.restore;
    if (!snap) return;
    scheduleLegendSessionRef.current = { restore: null, isolateFocus: null };
    setScheduleProductVisibility({ ...snap });
    setScheduleLegendUiEpoch((e) => e + 1);
  }, []);
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

  const dismissScheduleLegendHint = useCallback(() => {
    try {
      window.localStorage.setItem("scheduleLegendHintSeen", "1");
    } catch {
      /* ignore */
    }
    setScheduleLegendHintOpen(false);
  }, []);

  useEffect(
    () => () => {
      const p = scheduleLegendClickTimerRef.current;
      if (p) clearTimeout(p.id);
    },
    [],
  );
  useEffect(
    () => () => {
      const p = scheduleLegendClickTimerV2Ref.current;
      if (p) clearTimeout(p.id);
    },
    [],
  );

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

  const scheduleViewportChartWidth = Math.max(
    (scheduleViewEnd - scheduleViewStart) * SCHEDULE_SLOT_PX,
    240,
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
                <div className="max-w-[min(100%,220px)] truncate text-[10px] text-white/70 sm:max-w-none md:text-xs">
                  Ultima actualizacion:{" "}
                  <span className="font-medium text-white">
                    {lastUpdate ? lastUpdate.toLocaleString("es-PE") : "Sin datos"}
                  </span>
                </div>
                <Button
                  size="sm"
                  onClick={() => void handleSync()}
                  disabled={syncing}
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
            <DatosPendientesTable />
          </TabsContent>

          <TabsContent value="operaciones" className="mt-0 outline-none">
            <Tabs value={operacionesSubTab} onValueChange={handleOperacionesSubTabChange} className="w-full">
              <TabsList className="mb-3 grid h-auto min-h-10 w-full max-w-2xl grid-cols-1 gap-1 bg-slate-200/90 p-1 sm:grid-cols-3 sm:gap-0">
                <TabsTrigger
                  value={OPERACIONES_SUB_CONTROL}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Control
                </TabsTrigger>
                <TabsTrigger
                  value={OPERACIONES_SUB_CONDUCTORES_TIEMPO}
                  className="text-sm data-active:bg-white data-active:text-slate-900 data-active:shadow-sm sm:flex-1"
                >
                  Conductores en el tiempo
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
                    operacionesSubTab === OPERACIONES_SUB_CONDUCTORES_TIEMPO ? "block" : "hidden"
                  }
                  aria-hidden={operacionesSubTab !== OPERACIONES_SUB_CONDUCTORES_TIEMPO}
                >
                  <ConductorTimelineMatrix dataRevision={refreshKey} />
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
            {dashboardError && dashboardSubTab === "reservas" && (
              <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {dashboardError}
              </p>
            )}

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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <CardTitle className="text-base font-semibold text-slate-800">
                      Pendientes por franja de programacion
                    </CardTitle>
                    <p className="text-xs text-slate-500">
                      Desde la primera hora con viaje pendiente hasta la ultima. Minimo 24 h en el eje;
                      desplaza horizontalmente si hay mas franjas.
                    </p>
                  </div>
                  {(() => {
                    void scheduleLegendUiEpoch;
                    const session = scheduleLegendSessionRef.current;
                    const isolated =
                      session.isolateFocus !== null &&
                      scheduleOnlyProductVisible(scheduleProductVisibility, session.isolateFocus);
                    const canRestore = session.restore !== null;
                    return (
                      <div className="flex min-w-0 flex-col items-stretch gap-2 sm:max-w-[min(100%,520px)] sm:items-end">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {canRestore && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 shrink-0 text-xs"
                              onClick={restoreScheduleLegendView}
                            >
                              Restaurar vista
                            </Button>
                          )}
                          <div
                            className="flex flex-wrap justify-end gap-2"
                            title="Click: mostrar u ocultar en la grafica. Doble click: ver solo este producto. Teclado: Enter alterna; Mayus+Enter aísla."
                          >
                            {SCHEDULE_TOOLTIP_ORDER.map((key) => {
                              const vis = scheduleProductVisibility[key];
                              const isHidden = !vis;
                              const isIsolateChip =
                                isolated && session.isolateFocus === key;
                              const isDimmed = isolated && session.isolateFocus !== key;
                              return (
                                <button
                                  key={`legend-${key}`}
                                  type="button"
                                  tabIndex={0}
                                  onClick={() => onScheduleLegendItemClick(key)}
                                  onDoubleClick={(e) => onScheduleLegendItemDoubleClick(e, key)}
                                  onKeyDown={(e) => onScheduleLegendItemKeyDown(e, key)}
                                  className={`inline-flex cursor-pointer items-center rounded-md border border-transparent px-2 py-0.5 text-[10px] font-semibold text-white outline-offset-2 transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-400 ${
                                    isHidden ? "opacity-40" : isDimmed ? "opacity-50" : ""
                                  } ${isIsolateChip ? "z-[1] ring-2 ring-white shadow-md" : ""}`}
                                  style={{ backgroundColor: SCHEDULE_PRODUCT_COLORS[key] }}
                                  aria-pressed={vis}
                                  aria-label={
                                    key === "OTROS"
                                      ? `Otros, ${vis ? "visible" : "oculto"} en la grafica`
                                      : `${key}, ${vis ? "visible" : "oculto"} en la grafica`
                                  }
                                >
                                  {key === "OTROS" ? "Otros" : key}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                        {scheduleLegendHintOpen && (
                          <div className="flex max-w-full flex-col gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-left sm:items-end">
                            <p className="text-[10px] leading-snug text-slate-600">
                              <span className="font-semibold text-slate-700">Leyenda:</span> click para
                              mostrar u ocultar · doble click para ver solo ese producto (otro doble click o
                              &quot;Restaurar vista&quot; revierte).
                            </p>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="h-6 self-end px-2 text-[10px]"
                              onClick={dismissScheduleLegendHint}
                            >
                              Entendido
                            </Button>
                          </div>
                        )}
                      </div>
                    );
                  })()}
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
                          <Tooltip content={<ScheduleStackBarTooltip />} />
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

              <TabsContent value="productividad" className="mt-0 space-y-4 outline-none">
                {prodError && (
                  <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    {prodError}
                  </p>
                )}
                <div className="rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        Semana (lun–dom)
                      </span>
                      <Select value={prodWeekKey} onValueChange={setProdWeekKey}>
                        <SelectTrigger className="h-9 w-full border-slate-200 bg-white text-sm">
                          <SelectValue placeholder="Semana" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {prodWeekSelectOptions.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        Día de la semana
                      </span>
                      <Select value={prodWeekday} onValueChange={setProdWeekday}>
                        <SelectTrigger className="h-9 w-full border-slate-200 bg-white text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PROD_WEEKDAY_SELECT.map((o) => (
                            <SelectItem key={o.value} value={o.value}>
                              {o.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">
                        type_log_name
                      </span>
                      <Select value={prodTypeLog} onValueChange={setProdTypeLog}>
                        <SelectTrigger className="h-9 w-full border-slate-200 bg-white text-sm">
                          <SelectValue placeholder="Todos" />
                        </SelectTrigger>
                        <SelectContent className="max-h-60">
                          <SelectItem value="__all__">Todos</SelectItem>
                          {prodTypeOptions.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  {prodLoading && (
                    <p className="mt-3 text-xs text-slate-500">Cargando registros de logs...</p>
                  )}
                  {!prodLoading && prodMeta?.capped && (
                    <p className="mt-3 text-xs text-amber-700">
                      Se alcanzó el límite de filas en la semana; el conteo puede estar truncado.
                    </p>
                  )}
                </div>

                <Card className="border-slate-200 bg-white shadow-sm">
                  <CardHeader className="space-y-1 py-3">
                    <CardTitle className="text-base font-semibold text-slate-800">
                      Registros por usuario (moobiz_logs_clean)
                    </CardTitle>
                    <p className="text-xs text-slate-500">
                      Eje Y: us_name · Eje X: cantidad de filas · Semana calendario ISO (lun–dom), dia
                      opcional (1=lun … 7=dom), type_log_name.
                    </p>
                  </CardHeader>
                  <CardContent className="pb-4">
                    <div style={{ height: prodChartHeight }} className="w-full min-h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={prodSeries}
                          layout="vertical"
                          margin={{ top: 8, right: 20, left: 8, bottom: 8 }}
                        >
                          <CartesianGrid stroke={CHART_GRID} horizontal={false} />
                          <XAxis
                            type="number"
                            tick={CHART_AXIS}
                            tickLine={false}
                            axisLine={{ stroke: CHART_GRID }}
                            allowDecimals={false}
                          />
                          <YAxis
                            dataKey="us_name"
                            type="category"
                            width={140}
                            tick={{ ...CHART_AXIS, fontSize: 10 }}
                            tickFormatter={(v) =>
                              String(v).length > 22 ? `${String(v).slice(0, 20)}…` : String(v)
                            }
                            tickLine={false}
                            axisLine={{ stroke: CHART_GRID }}
                          />
                          <Tooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null;
                              const p = payload[0].payload as ProductividadSeriesRow;
                              return (
                                <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
                                  <ChartTooltipRow label="Usuario" value={p.us_name} />
                                  <ChartTooltipRow label="Registros" value={p.count} />
                                </div>
                              );
                            }}
                          />
                          <Bar
                            dataKey="count"
                            name="Registros"
                            fill="#00e676"
                            radius={[0, 4, 4, 0]}
                            maxBarSize={22}
                            isAnimationActive={false}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    {!prodLoading && prodSeries.length === 0 && (
                      <p className="mt-2 text-center text-xs text-slate-500">
                        Sin datos para los filtros seleccionados.
                      </p>
                    )}
                  </CardContent>
                </Card>
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

export default function Page() {
  return (
    <Suspense fallback={<div>Cargando...</div>}>
      <DashboardContent />
    </Suspense>
  );
}
