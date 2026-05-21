"use client";

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
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

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  SCHEDULE_PRODUCT_COLORS,
  SCHEDULE_STACK_ORDER,
  scheduleBucketForProducto,
} from "@/lib/product-categories";

type Viaje = {
  id: string | number;
  empresa?: string | null;
  fecha?: string | null;
  fecha_registro?: string | null;
  producto?: string | null;
  zona?: string | null;
};

type DashboardResponse = {
  data: Viaje[];
  charts: {
    pendingBySchedule: Array<{ etiqueta: string; total: number }>;
  };
  filters: { empresas: string[] };
};

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

const EMPRESA_HIGHLIGHT_FILL = "#00e676";
const EMPRESA_REMAINDER_FILL = "#E6EEF5";
const EMPRESA_REMAINDER_KEY = "__empresaRemainder" as const;
const EMPRESA_HIGHLIGHT_KEY = "__empresaHighlight" as const;

const SCHEDULE_SLOT_PX = 28;

type ScheduleTimelineDatumV2 = {
  etiqueta: string;
  total: number;
  hourLabel: string;
  dateLabel: string;
  dateKey: string;
  showDayLabel: boolean;
  dayDividerBefore: boolean;
  __empresaHighlight: number;
  __empresaRemainder: number;
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

function asText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function ChartTooltipRow({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex justify-between gap-4 text-xs">
      <span className="text-white/80">{label}</span>
      <span className="font-semibold text-[#00e676]">{value}</span>
    </div>
  );
}

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
  selectedEmpresa?: string | null;
};

function scheduleStackTooltipDataKeyAsString(entry: ScheduleStackRechartsPayloadEntry): string {
  const raw = entry.dataKey ?? entry.name;
  if (raw === null || raw === undefined) return "";
  return String(raw).trim();
}

const ScheduleStackBarTooltipV2 = memo(function ScheduleStackBarTooltipV2(
  props: ScheduleStackBarTooltipV2Props,
) {
  const { active, payload, selectedEmpresa } = props;
  if (!active) return null;
  if (!Array.isArray(payload) || payload.length === 0) return null;

  const datum = payload.find((e) => e?.payload != null)?.payload;
  if (!datum) return null;

  if (selectedEmpresa) {
    const columnTotal = Math.max(0, Number(datum.__empresaRemainder) + Number(datum.__empresaHighlight));
    const highlight = Math.max(0, Number(datum.__empresaHighlight) || 0);
    return (
      <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
        <ChartTooltipRow label="Franja" value={datum.etiqueta} />
        <ChartTooltipRow label="Total servicios" value={columnTotal} />
        <ChartTooltipRow label="Empresa" value={selectedEmpresa} />
        <ChartTooltipRow label="Servicios de la empresa" value={highlight} />
      </div>
    );
  }

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

  const time = timeMatch
    ? `${timeMatch[1]}:${timeMatch[2]}${timeMatch[3] ? `:${timeMatch[3]}` : ""}${timeMatch[4] ? ` ${timeMatch[4]}` : ""}`
    : "";
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

function emptyScheduleDatum(
  item: { etiqueta: string; total: number },
  index: number,
  centerIndexByDay: Map<string, number>,
  scheduleV2ChartData: Array<{ etiqueta: string; total: number }>,
): ScheduleTimelineDatumV2 {
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
    __empresaHighlight: 0,
    __empresaRemainder: 0,
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
}

type ServiciosPendientesCardProps = {
  active: boolean;
  refreshKey: number;
};

export function ServiciosPendientesCard({ active, refreshKey }: ServiciosPendientesCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [selectedEmpresa, setSelectedEmpresa] = useState<string | null>(null);
  const [empresasOptions, setEmpresasOptions] = useState<string[]>([]);
  const [syncingServices, setSyncingServices] = useState(false);
  const [syncingServicesError, setSyncingServicesError] = useState<string | null>(null);
  const [visibleProducts, setVisibleProducts] = useState<Record<ScheduleV2ProductKey, boolean>>(
    () =>
      Object.fromEntries(SCHEDULE_V2_STACK_ORDER.map((key) => [key, true])) as Record<
        ScheduleV2ProductKey,
        boolean
      >,
  );

  const scheduleLegendClickTimerRef = useRef<{ id: ReturnType<typeof setTimeout>; key: ScheduleV2ProductKey } | null>(
    null,
  );
  const scheduleLegendSessionRef = useRef<{
    restore: Record<ScheduleV2ProductKey, boolean> | null;
    isolateFocus: ScheduleV2ProductKey | null;
  }>({ restore: null, isolateFocus: null });

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/dashboard-v2/reservas", { cache: "no-store" });
      const body = (await res.json()) as DashboardResponse & { error?: string };
      if (!res.ok) throw new Error(body?.error || "No se pudo cargar servicios pendientes.");
      setData(body);
      const empresas = body.filters?.empresas ?? [];
      if (empresas.length > 0) {
        setEmpresasOptions((prev) => {
          const merged = new Set([...prev, ...empresas]);
          return Array.from(merged).sort((a, b) => a.localeCompare(b, "es"));
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error inesperado en servicios pendientes.");
    } finally {
      setLoading(false);
    }
  }, []);

  const handleSyncServices = useCallback(async () => {
    setSyncingServices(true);
    setSyncingServicesError(null);
    try {
      const res = await fetch("/api/moobiz-services/sync", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body?.error || "No se pudo sincronizar servicios.");
      await loadData();
    } catch (err) {
      setSyncingServicesError(
        err instanceof Error ? err.message : "Error inesperado al sincronizar servicios.",
      );
    } finally {
      setSyncingServices(false);
    }
  }, [loadData]);

  useEffect(() => {
    if (!active) return;
    void loadData();
  }, [active, loadData, refreshKey]);

  const visibleScheduleKeys = useMemo(
    () => SCHEDULE_V2_STACK_ORDER.filter((k) => visibleProducts[k]),
    [visibleProducts],
  );

  const scheduleChartData = data?.charts.pendingBySchedule ?? [];
  const scheduleChartWidth = Math.max(scheduleChartData.length * SCHEDULE_SLOT_PX, 320);

  const timelineData = useMemo<ScheduleTimelineDatumV2[]>(() => {
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

    const baseData = scheduleChartData.map((item, index) =>
      emptyScheduleDatum(item, index, centerIndexByDay, scheduleChartData),
    );

    const bySlot = new Map<string, ScheduleTimelineDatumV2>();
    for (const item of baseData) {
      const hour = extractHour24FromScheduleEtiqueta(item.etiqueta);
      const slotKey = `${item.dateKey}|${hour !== null ? String(hour).padStart(2, "0") : ""}`;
      bySlot.set(slotKey, item);
    }

    for (const viaje of data?.data ?? []) {
      const d = parseViajeScheduledDate(viaje);
      if (!d) continue;
      const slotKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}|${String(d.getHours()).padStart(2, "0")}`;
      const slot = bySlot.get(slotKey);
      if (!slot) continue;

      if (selectedEmpresa && asText(viaje.empresa) === selectedEmpresa) {
        slot.__empresaHighlight += 1;
      }

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
      const sum = visibleScheduleKeys.reduce((acc, key) => acc + item[key], 0);
      item.total = sum > 0 ? sum : item.total;
      item.__empresaRemainder = Math.max(0, item.total - item.__empresaHighlight);
    }

    return baseData;
  }, [data?.data, scheduleChartData, visibleScheduleKeys, selectedEmpresa]);

  const chartDisplayData = useMemo(() => {
    if (!selectedEmpresa) return timelineData;
    return timelineData.map((row) => {
      const columnTotal = visibleScheduleKeys.reduce((acc, key) => acc + row[key], 0);
      const highlight = Math.max(0, row.__empresaHighlight);
      return {
        ...row,
        total: columnTotal,
        __empresaHighlight: highlight,
        __empresaRemainder: Math.max(0, columnTotal - highlight),
      };
    });
  }, [timelineData, selectedEmpresa, visibleScheduleKeys]);

  const yAxisMax = useMemo(() => {
    let m = 0;
    for (const row of chartDisplayData) {
      const total = selectedEmpresa
        ? row.__empresaRemainder + row.__empresaHighlight
        : row.total;
      if (total > m) m = total;
    }
    return Math.max(1, m);
  }, [chartDisplayData, selectedEmpresa]);

  const datumByEtiqueta = useMemo(() => {
    const map = new Map<string, ScheduleTimelineDatumV2>();
    for (const row of chartDisplayData) {
      map.set(row.etiqueta, row);
    }
    return map;
  }, [chartDisplayData]);

  const pendingTotalVisible = useMemo(
    () =>
      timelineData.reduce(
        (acc, row) =>
          acc +
          SCHEDULE_V2_STACK_ORDER.reduce(
            (rowAcc, key) => rowAcc + (visibleProducts[key] ? row[key] : 0),
            0,
          ),
        0,
      ),
    [timelineData, visibleProducts],
  );

  const toggleScheduleProduct = useCallback((key: ScheduleV2ProductKey) => {
    scheduleLegendSessionRef.current = { restore: null, isolateFocus: null };
    setVisibleProducts((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  }, []);

  const handleScheduleLegendIsolate = useCallback((key: ScheduleV2ProductKey) => {
    setVisibleProducts((vis) => {
      const session = scheduleLegendSessionRef.current;
      const onlyFocused = SCHEDULE_V2_STACK_ORDER.every((k) =>
        k === key ? vis[k] === true : vis[k] === false,
      );
      if (session.restore && session.isolateFocus === key && onlyFocused) {
        scheduleLegendSessionRef.current = { restore: null, isolateFocus: null };
        return { ...session.restore };
      }
      scheduleLegendSessionRef.current = { restore: { ...vis }, isolateFocus: key };
      const next = {} as Record<ScheduleV2ProductKey, boolean>;
      for (const k of SCHEDULE_V2_STACK_ORDER) {
        next[k] = k === key;
      }
      return next;
    });
  }, []);

  const clearScheduleLegendPendingClick = useCallback(() => {
    const p = scheduleLegendClickTimerRef.current;
    if (p) {
      clearTimeout(p.id);
      scheduleLegendClickTimerRef.current = null;
    }
  }, []);

  const onScheduleLegendItemClick = useCallback(
    (key: ScheduleV2ProductKey) => {
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
    (e: MouseEvent, key: ScheduleV2ProductKey) => {
      e.preventDefault();
      clearScheduleLegendPendingClick();
      handleScheduleLegendIsolate(key);
    },
    [clearScheduleLegendPendingClick, handleScheduleLegendIsolate],
  );

  const onScheduleLegendItemKeyDown = useCallback(
    (e: KeyboardEvent, key: ScheduleV2ProductKey) => {
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

  useEffect(
    () => () => {
      const p = scheduleLegendClickTimerRef.current;
      if (p) clearTimeout(p.id);
    },
    [],
  );

  const ScheduleXAxisTick = useMemo(
    () =>
      function ScheduleXAxisTickFn(props: { x?: number; y?: number; payload?: { value: unknown } }) {
        const { x = 0, y = 0, payload } = props;
        const entry = datumByEtiqueta.get(asText(payload?.value));
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
    [datumByEtiqueta],
  );

  const tooltipContent = useMemo(
    () => <ScheduleStackBarTooltipV2 selectedEmpresa={selectedEmpresa} />,
    [selectedEmpresa],
  );

  return (
    <Card className="border-slate-200 bg-white shadow-sm">
      <CardHeader className="space-y-1 py-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="pendientes-empresa-filter" className="text-sm font-medium text-slate-700">
                Empresa
              </Label>
              <select
                id="pendientes-empresa-filter"
                value={selectedEmpresa ?? "Todos"}
                onChange={(e) => {
                  const v = e.target.value === "Todos" ? null : e.target.value;
                  setSelectedEmpresa(v);
                }}
                className="h-8 rounded-md border border-slate-200 bg-white px-3 py-1 text-sm text-slate-800 shadow-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-400"
                aria-label="Resaltar servicios pendientes por empresa"
              >
                <option value="Todos">Todos</option>
                {empresasOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <CardTitle className="text-sm font-semibold text-slate-800">Servicios pendientes</CardTitle>
          </div>
          <div className="flex flex-col items-end gap-1 sm:flex-row sm:items-center">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 shrink-0 text-xs"
              onClick={() => void handleSyncServices()}
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
                {pendingTotalVisible.toLocaleString("es-PE")} pendientes
              </p>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {SCHEDULE_V2_STACK_ORDER.map((key) => {
            const visible = visibleProducts[key];
            return (
              <button
                key={`v2-toggle-${key}`}
                type="button"
                onClick={() => onScheduleLegendItemClick(key)}
                onDoubleClick={(e) => onScheduleLegendItemDoubleClick(e, key)}
                onKeyDown={(e) => onScheduleLegendItemKeyDown(e, key)}
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
        {error ? <p className="text-xs text-red-600">{error}</p> : null}
        {loading ? (
          <p className="flex items-center gap-1.5 text-xs text-slate-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            Cargando servicios pendientes...
          </p>
        ) : null}
        {syncingServicesError ? <p className="text-xs text-red-600">{syncingServicesError}</p> : null}
      </CardHeader>
      <CardContent className="pb-4">
        <div className="relative overflow-x-auto overflow-y-hidden rounded-lg border border-slate-100 bg-slate-50/50 [-webkit-overflow-scrolling:touch]">
          {loading ? (
            <div
              className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-slate-50/80"
              aria-live="polite"
              aria-busy="true"
            >
              <Loader2 className="h-6 w-6 animate-spin text-slate-500" aria-label="Cargando gráfica" />
            </div>
          ) : null}
          <div
            className={`relative ${loading ? "pointer-events-none opacity-50" : ""}`}
            style={{ width: scheduleChartWidth, height: 350 }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartDisplayData} margin={{ top: 10, right: 12, left: 4, bottom: 28 }}>
                <CartesianGrid stroke={CHART_GRID} vertical={false} />
                {chartDisplayData
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
                  domain={[0, yAxisMax]}
                />
                <Tooltip content={tooltipContent} />
                {selectedEmpresa ? (
                  <>
                    <Bar
                      dataKey={EMPRESA_REMAINDER_KEY}
                      name="Otros"
                      stackId="productos"
                      isAnimationActive={false}
                      barSize={SCHEDULE_SLOT_PX - 8}
                      maxBarSize={SCHEDULE_SLOT_PX - 6}
                      fill={EMPRESA_REMAINDER_FILL}
                      radius={[0, 0, 0, 0]}
                    />
                    <Bar
                      dataKey={EMPRESA_HIGHLIGHT_KEY}
                      name="Empresa seleccionada"
                      stackId="productos"
                      isAnimationActive={false}
                      barSize={SCHEDULE_SLOT_PX - 8}
                      maxBarSize={SCHEDULE_SLOT_PX - 6}
                      fill={EMPRESA_HIGHLIGHT_FILL}
                      radius={[4, 4, 0, 0]}
                    />
                  </>
                ) : (
                  visibleScheduleKeys.map((key, idx) => (
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
                        idx === visibleScheduleKeys.length - 1 ? [4, 4, 0, 0] : [0, 0, 0, 0]
                      }
                    />
                  ))
                )}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
