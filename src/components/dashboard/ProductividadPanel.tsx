"use client";

import { Download, Loader2 } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  ProductividadHorizontalBarLabel,
  ProductividadVerticalBarLabel,
} from "@/components/dashboard/productividad-chart-bar-labels";
import { ProductividadFilterMulti } from "@/components/dashboard/productividad-filter-multi";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  appendProductividadParams,
  isoInputToFechaParam,
  PRODUCTIVIDAD_LOG_TYPES,
  type ProductividadFilterField,
  type ProductividadLogType,
  type ProductividadParsedParams,
} from "@/lib/productividad-logs-params";
import type { ProductividadCardMetrics } from "@/lib/productividad-logs-query";
import {
  formatPerHour,
  pivotAndSortUserChartRows,
  resolveSortTypes,
  visibleTypesToLogNameParam,
  type UserChartPivotRow,
  type UserChartRawRow,
} from "@/lib/productividad-user-chart-transform";
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 400;
const WEEKDAY_DEBOUNCE_MS = 250;
const USER_PAGE = 20;

const WEEKDAY_TOGGLES = [
  { iso: 1, label: "Lun", aria: "Lunes" },
  { iso: 2, label: "Mar", aria: "Martes" },
  { iso: 3, label: "Mie", aria: "Miércoles" },
  { iso: 4, label: "Jue", aria: "Jueves" },
  { iso: 5, label: "Vie", aria: "Viernes" },
  { iso: 6, label: "Sab", aria: "Sábado" },
  { iso: 7, label: "Dom", aria: "Domingo" },
] as const;
const BAR_ROW_H = 34;
const CHART_GRID = "rgba(148, 163, 184, 0.35)";

const PETROLEO = "#0f5666";
const TURQUESA = "#2fb6b0";

const TYPE_COLORS: Record<ProductividadLogType, string> = {
  Creó: "#14b8a6",
  Solicitó: "#f59e0b",
  Asignó: "#a855f7",
  Modificó: "#22c55e",
  Quitó: "#f43f5e",
};

/** Opciones en cascada; type_user / type_log_name son implícitos en SQL (no UI). */
const FILTER_FIELDS: ProductividadFilterField[] = [
  "estado",
  "n_semana",
  "us_name",
];

type FilterState = {
  global: string[];
  estado: string[];
  nSemana: string[];
  typeUser: string[];
  typeLogName: string[];
  usName: string[];
  fechaFrom: string;
  fechaTo: string;
};

const EMPTY_FILTERS: FilterState = {
  global: [],
  estado: [],
  nSemana: [],
  typeUser: [],
  typeLogName: [],
  usName: [],
  fechaFrom: "",
  fechaTo: "",
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

type QueryOpts = {
  limit?: number;
  offset?: number;
  sortTypes?: ProductividadLogType[] | null;
  weekdays?: number[];
  typeLogName?: string[] | null;
};

function filtersToParams(f: FilterState, opts?: QueryOpts): ProductividadParsedParams {
  const nullIf = (a: string[]) => (a.length === 0 ? null : a);
  const sortTypes =
    opts?.sortTypes == null
      ? null
      : opts.sortTypes.length === 0
        ? null
        : [...opts.sortTypes];
  const weekdays =
    opts?.weekdays != null && opts.weekdays.length > 0 ? [...opts.weekdays].sort((a, b) => a - b) : null;
  return {
    global: nullIf(f.global),
    estado: nullIf(f.estado),
    nSemana: nullIf(f.nSemana),
    fechaFrom: isoInputToFechaParam(f.fechaFrom),
    fechaTo: isoInputToFechaParam(f.fechaTo),
    typeUser: nullIf(f.typeUser),
    typeLogName: opts?.typeLogName !== undefined ? opts.typeLogName : nullIf(f.typeLogName),
    usName: nullIf(f.usName),
    weekdays,
    limit: opts?.limit ?? USER_PAGE,
    offset: opts?.offset ?? 0,
    sortTypes,
  };
}

function buildQuery(
  f: FilterState,
  opts?: QueryOpts,
): string {
  const p = new URLSearchParams();
  appendProductividadParams(p, filtersToParams(f, opts));
  return p.toString();
}

function buildQueryFromPanel(
  f: FilterState,
  weekdays: number[],
  visibleTypes: Record<ProductividadLogType, boolean>,
  opts?: Omit<QueryOpts, "weekdays" | "typeLogName">,
): string {
  return buildQuery(f, {
    ...opts,
    weekdays,
    typeLogName: visibleTypesToLogNameParam(visibleTypes),
  });
}

function UserChartTooltip({
  row,
  typesToShow,
}: {
  row: UserChartPivotRow;
  typesToShow: ProductividadLogType[];
}) {
  const total = row.total_per_user || row.total;
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
      <p className="mb-1.5 font-semibold text-[#0f5666]">{row.us_name}</p>
      <div className="space-y-1">
        {typesToShow.map((type) => {
          const cnt = row.totals[type] ?? 0;
          const pct = total > 0 ? ((cnt / total) * 100).toFixed(1) : "0.0";
          const ph = formatPerHour(cnt, row.buckets[type] ?? 0);
          return (
            <p key={type} className="flex items-center gap-1.5 text-slate-700">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: TYPE_COLORS[type] }}
                aria-hidden
              />
              <span>
                {type}: {cnt.toLocaleString("es-PE")} ({pct}%) — {ph}
              </span>
            </p>
          );
        })}
      </div>
    </div>
  );
}

function downloadCsv(url: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = "";
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function PanelSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn("animate-pulse rounded-md bg-slate-100", className)} aria-hidden />
  );
}

function ExportBtn({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-7 gap-1 px-2 text-[10px] text-[#0f5666]"
      onClick={onClick}
      disabled={disabled}
    >
      <Download className="h-3 w-3" />
      CSV
    </Button>
  );
}

function NoData({ children }: { children?: ReactNode }) {
  return (
    <p className="flex h-32 items-center justify-center text-sm text-slate-500">
      {children ?? "Sin datos"}
    </p>
  );
}

export function ProductividadPanel() {
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [weekdays, setWeekdays] = useState<number[]>([]);
  const debouncedFilters = useDebounced(filters, DEBOUNCE_MS);
  const debouncedWeekdays = useDebounced(weekdays, WEEKDAY_DEBOUNCE_MS);

  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [filterLoading, setFilterLoading] = useState(false);

  const [userRows, setUserRows] = useState<UserChartRawRow[]>([]);
  const [userTotal, setUserTotal] = useState(0);
  const [userOffset, setUserOffset] = useState(0);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const [cards, setCards] = useState<ProductividadCardMetrics[]>([]);
  const [cardsLoading, setCardsLoading] = useState(false);

  const [byDate, setByDate] = useState<{ fecha: string; cnt: number }[]>([]);
  const [byDateLoading, setByDateLoading] = useState(false);

  const [byDateHour, setByDateHour] = useState<{ label: string; cnt: number; fecha: string }[]>(
    [],
  );
  const [byDateHourLoading, setByDateHourLoading] = useState(false);

  const [visibleTypes, setVisibleTypes] = useState<Record<ProductividadLogType, boolean>>(() =>
    Object.fromEntries(PRODUCTIVIDAD_LOG_TYPES.map((t) => [t, true])) as Record<
      ProductividadLogType,
      boolean
    >,
  );
  const [hoveredUser, setHoveredUser] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const loadingMoreRef = useRef(false);

  const setFilter = useCallback(<K extends keyof FilterState>(key: K, value: FilterState[K]) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setUserOffset(0);
    setUserRows([]);
  }, []);

  const toggleWeekday = useCallback((iso: number) => {
    setWeekdays((prev) => {
      const next = prev.includes(iso) ? prev.filter((d) => d !== iso) : [...prev, iso];
      return next.sort((a, b) => a - b);
    });
    setUserOffset(0);
    setUserRows([]);
  }, []);

  const loadFilterOptions = useCallback(
    async (f: FilterState, wd: number[], visible: Record<ProductividadLogType, boolean>) => {
    setFilterLoading(true);
    try {
      const q = buildQueryFromPanel(f, wd, visible);
      const entries = await Promise.all(
        FILTER_FIELDS.map(async (field) => {
          const res = await fetch(
            `/api/dashboard/productividad/filters?field=${field}&${q}`,
            { cache: "no-store" },
          );
          const body = (await res.json()) as {
            values?: string[];
            error?: string;
            sql?: string;
          };
          if (!res.ok) {
            console.error("[productividad/filters]", field, body.error, body.sql);
            throw new Error(body.error ?? res.statusText);
          }
          return [field, Array.isArray(body.values) ? body.values : []] as const;
        }),
      );
      setFilterOptions(Object.fromEntries(entries));
    } catch {
      /* mantener opciones previas */
    } finally {
      setFilterLoading(false);
    }
  },
    [],
  );

  const userSortTypes = useMemo(() => resolveSortTypes(visibleTypes), [visibleTypes]);

  const loadUsers = useCallback(
    async (
      f: FilterState,
      wd: number[],
      visible: Record<ProductividadLogType, boolean>,
      offset: number,
      append: boolean,
      sortTypes: ProductividadLogType[] | null,
    ) => {
      setUsersLoading(true);
      setUsersError(null);
      try {
        const qs = buildQueryFromPanel(f, wd, visible, { limit: USER_PAGE, offset, sortTypes });
        const res = await fetch(`/api/dashboard/productividad/users?${qs}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as {
          rows?: UserChartRawRow[];
          totalUsers?: number;
          error?: string;
        };
        if (!res.ok) throw new Error(body.error ?? res.statusText);
        const rows = body.rows ?? [];
        setUserTotal(body.totalUsers ?? 0);
        setUserRows((prev) => (append ? [...prev, ...rows] : rows));
        setUserOffset(offset);
      } catch (e) {
        setUsersError(e instanceof Error ? e.message : String(e));
        if (!append) setUserRows([]);
      } finally {
        setUsersLoading(false);
        loadingMoreRef.current = false;
      }
    },
    [],
  );

  const loadCards = useCallback(async (f: FilterState, wd: number[]) => {
    setCardsLoading(true);
    try {
      const qs = buildQuery(f, { weekdays: wd, typeLogName: null });
      const res = await fetch(`/api/dashboard/productividad/cards?${qs}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as { cards?: ProductividadCardMetrics[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setCards(body.cards ?? []);
    } catch {
      setCards([]);
    } finally {
      setCardsLoading(false);
    }
  },
    [],
  );

  const loadByDate = useCallback(
    async (f: FilterState, wd: number[], visible: Record<ProductividadLogType, boolean>) => {
    setByDateLoading(true);
    try {
      const qs = buildQueryFromPanel(f, wd, visible);
      const res = await fetch(`/api/dashboard/productividad/by-date?${qs}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as { rows?: { fecha: string; cnt: number }[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setByDate(body.rows ?? []);
    } catch {
      setByDate([]);
    } finally {
      setByDateLoading(false);
    }
  },
    [],
  );

  const loadByDateHour = useCallback(
    async (f: FilterState, wd: number[], visible: Record<ProductividadLogType, boolean>) => {
    setByDateHourLoading(true);
    try {
      const qs = buildQueryFromPanel(f, wd, visible);
      const res = await fetch(`/api/dashboard/productividad/by-date-hour?${qs}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as {
        rows?: { fecha: string; hora: string; cnt: number }[];
        error?: string;
      };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setByDateHour(
        (body.rows ?? []).map((r) => ({
          label: `${r.fecha} ${r.hora}`,
          cnt: r.cnt,
          fecha: r.fecha,
        })),
      );
    } catch {
      setByDateHour([]);
    } finally {
      setByDateHourLoading(false);
    }
  },
    [],
  );

  useEffect(() => {
    void loadFilterOptions(debouncedFilters, debouncedWeekdays, visibleTypes);
  }, [debouncedFilters, debouncedWeekdays, visibleTypes, loadFilterOptions]);

  useEffect(() => {
    setUserRows([]);
    setUserOffset(0);
    void loadUsers(debouncedFilters, debouncedWeekdays, visibleTypes, 0, false, userSortTypes);
  }, [debouncedFilters, debouncedWeekdays, visibleTypes, userSortTypes, loadUsers]);

  useEffect(() => {
    void loadCards(debouncedFilters, debouncedWeekdays);
  }, [debouncedFilters, debouncedWeekdays, loadCards]);

  useEffect(() => {
    void loadByDate(debouncedFilters, debouncedWeekdays, visibleTypes);
    void loadByDateHour(debouncedFilters, debouncedWeekdays, visibleTypes);
  }, [debouncedFilters, debouncedWeekdays, visibleTypes, loadByDate, loadByDateHour]);

  const loadedUserCount = useMemo(
    () => new Set(userRows.map((r) => r.us_name)).size,
    [userRows],
  );

  const chartUserData = useMemo(
    () => pivotAndSortUserChartRows(userRows, visibleTypes),
    [userRows, visibleTypes],
  );

  const activeTypes = useMemo(
    () => PRODUCTIVIDAD_LOG_TYPES.filter((t) => visibleTypes[t]),
    [visibleTypes],
  );

  const tooltipTypes = useMemo(
    () => (activeTypes.length > 0 ? activeTypes : [...PRODUCTIVIDAD_LOG_TYPES]),
    [activeTypes],
  );

  const chartInnerH = Math.max(chartUserData.length * BAR_ROW_H + 48, 120);

  const onChartScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || usersLoading || loadingMoreRef.current) return;
    if (loadedUserCount >= userTotal) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    if (!nearBottom) return;
    loadingMoreRef.current = true;
    const nextOffset = userOffset + USER_PAGE;
    void loadUsers(
      debouncedFilters,
      debouncedWeekdays,
      visibleTypes,
      nextOffset,
      true,
      userSortTypes,
    );
  }, [
    debouncedFilters,
    debouncedWeekdays,
    visibleTypes,
    loadUsers,
    userOffset,
    loadedUserCount,
    userTotal,
    usersLoading,
    userSortTypes,
  ]);

  const qsBase = buildQueryFromPanel(debouncedFilters, debouncedWeekdays, visibleTypes, {
    sortTypes: userSortTypes,
  });

  const weekdayToggles = (
    <div
      role="group"
      aria-label="Filtrar por día de la semana"
      title="Filtrar por día de la semana"
      className="flex flex-wrap items-center justify-center gap-1.5 md:justify-end"
    >
      {WEEKDAY_TOGGLES.map(({ iso, label, aria }) => {
        const on = weekdays.includes(iso);
        return (
          <button
            key={iso}
            type="button"
            className={cn(
              "h-7 min-w-[2.25rem] rounded border px-2 text-[11px] font-semibold transition",
              "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0f5666]",
              on
                ? "border-[#991b1b] bg-[#dc2626] text-white shadow-md"
                : "border-red-200/90 bg-red-50 text-red-900",
            )}
            onClick={() => toggleWeekday(iso)}
            aria-pressed={on}
            aria-label={`Filtrar por ${aria}`}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  const seriesLegend = (
    <div
      role="group"
      aria-label="Mostrar u ocultar series en el gráfico de acciones por usuario"
      className="flex flex-wrap items-center justify-center gap-2 px-1 py-2 md:justify-start"
    >
      {PRODUCTIVIDAD_LOG_TYPES.map((type) => {
        const on = visibleTypes[type];
        return (
          <button
            key={type}
            type="button"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition",
              on ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-400",
            )}
            style={on ? { backgroundColor: TYPE_COLORS[type] } : undefined}
            onClick={() => {
              setVisibleTypes((prev) => ({ ...prev, [type]: !prev[type] }));
              setUserOffset(0);
              setUserRows([]);
              if (scrollRef.current) scrollRef.current.scrollTop = 0;
            }}
            aria-pressed={on}
            aria-label={
              on
                ? `Ocultar serie ${type}. Actualmente visible.`
                : `Mostrar serie ${type}. Actualmente oculto.`
            }
          >
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: TYPE_COLORS[type] }}
              aria-hidden
            />
            {type}
          </button>
        );
      })}
    </div>
  );

  const metricCardsRow = (
    <div className="-mx-1 mb-1 flex w-full min-w-0 shrink-0 items-start gap-3 overflow-x-auto pb-2 md:mb-4">
      {PRODUCTIVIDAD_LOG_TYPES.map((type) => {
        const card = cards.find((c) => c.type === type);
        return (
          <Card
            key={type}
            className={cn(
              "min-w-[120px] max-w-[160px] shrink-0 overflow-hidden rounded-lg border-slate-200 bg-white p-0 shadow-sm",
            )}
          >
            <CardHeader className="space-y-0 bg-[#0f5666] px-2 py-2">
              <CardTitle className="text-center text-[11px] font-semibold tracking-wide text-white">
                {type}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-3 text-center">
              {cardsLoading ? (
                <PanelSkeleton className="mx-auto h-10 w-16" />
              ) : (
                <>
                  <p className="text-2xl font-semibold tabular-nums text-[#2fb6b0]">
                    {(card?.ratio ?? 0).toFixed(2)}
                  </p>
                  <p className="text-xs leading-tight text-slate-500">por hora</p>
                  <p className="mt-1 text-sm font-semibold tabular-nums text-slate-800">
                    {(card?.total ?? 0).toLocaleString("es-PE")}
                  </p>
                  <p className="text-xs leading-tight text-gray-500">total</p>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  const actionsByUserBlock = (
    <div className="flex min-h-[420px] w-full min-w-0 flex-col rounded-lg border border-slate-100 bg-white p-3 shadow-sm md:h-full md:min-h-0 md:flex-1">
      <div className="mb-3 flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2">
        <h3 className="text-sm font-semibold text-[#0f5666]">Acciones por usuario</h3>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">
            {chartUserData.length} / {userTotal} usuarios
          </span>
          <ExportBtn
            disabled={usersLoading}
            onClick={() =>
              downloadCsv(`/api/dashboard/productividad/users?export=csv&${qsBase}`)
            }
          />
        </div>
      </div>
      {usersError ? <p className="text-xs text-red-600">{usersError}</p> : null}
      {usersLoading && chartUserData.length === 0 ? (
        <PanelSkeleton className="min-h-[320px] flex-1 md:min-h-[400px]" />
      ) : chartUserData.length === 0 ? (
        <div className="flex min-h-[200px] flex-1 items-center justify-center">
          <NoData />
        </div>
      ) : (
        <div
          ref={scrollRef}
          className={cn(
            "overflow-y-auto rounded-lg border border-slate-100 pr-1",
            "max-h-[400px] md:max-h-none md:min-h-0 md:flex-1",
          )}
          onScroll={onChartScroll}
        >
          <ResponsiveContainer width="100%" height={chartInnerH} minWidth={0}>
            <BarChart
              key={userSortTypes?.join("|") ?? "total"}
              layout="vertical"
              data={chartUserData}
              margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
              barCategoryGap={6}
              onMouseMove={(state) => {
                const label = state?.activeLabel;
                setHoveredUser(label != null ? String(label) : null);
              }}
              onMouseLeave={() => setHoveredUser(null)}
            >
              <CartesianGrid stroke={CHART_GRID} horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="us_name"
                width={120}
                tick={{ fontSize: 10, fill: PETROLEO }}
                tickLine={false}
              />
              <Tooltip
                content={({ active, label }) => {
                  if (!active || label == null) return null;
                  const row = chartUserData.find((d) => d.us_name === label);
                  if (!row) return null;
                  return <UserChartTooltip row={row} typesToShow={tooltipTypes} />;
                }}
              />
              {activeTypes.map((type) => (
                <Bar
                  key={type}
                  dataKey={type}
                  name={type}
                  stackId="a"
                  fill={TYPE_COLORS[type]}
                  isAnimationActive
                  animationDuration={350}
                  animationEasing="ease-out"
                >
                  {chartUserData.map((entry) => (
                    <Cell
                      key={`${type}-${entry.us_name}`}
                      fillOpacity={
                        hoveredUser && hoveredUser !== entry.us_name ? 0.35 : 1
                      }
                    />
                  ))}
                  <LabelList
                    dataKey={type}
                    content={(props) => ProductividadHorizontalBarLabel(props)}
                  />
                </Bar>
              ))}
            </BarChart>
          </ResponsiveContainer>
          {usersLoading ? (
            <div className="flex justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-[#2fb6b0]" />
            </div>
          ) : null}
        </div>
      )}
    </div>
  );

  const byDateBlock = (
    <div className="flex min-h-0 w-full min-w-0 shrink-0 flex-col rounded-lg border border-slate-100 bg-white p-3 shadow-sm">
      <div className="mb-2 flex shrink-0 flex-row items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[#0f5666]">Por fecha</h3>
        <ExportBtn
          disabled={byDateLoading}
          onClick={() => downloadCsv(`/api/dashboard/productividad/by-date?export=csv&${qsBase}`)}
        />
      </div>
      {byDateLoading ? (
        <PanelSkeleton className="h-[200px] w-full md:h-56" />
      ) : byDate.length === 0 ? (
        <NoData />
      ) : (
        <div className="h-[200px] w-full shrink-0 md:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDate} margin={{ top: 8, right: 8, left: 0, bottom: 36 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis
                dataKey="fecha"
                tick={{ fontSize: 9, angle: -30, textAnchor: "end" }}
                height={44}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10 }} width={36} allowDecimals={false} />
              <Tooltip
                formatter={(value: any) => {
                  if (value == null) return ["", "Conteo"];
                  const num = typeof value === "number" ? value : Number(value);
                  return [
                    Number.isFinite(num) ? num.toLocaleString("es-PE") : "",
                    "Conteo",
                  ];
                }}
                labelFormatter={(label) => `Fecha: ${label}`}
              />
              <Bar dataKey="cnt" name="Conteo" fill={TURQUESA} radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="cnt"
                  content={(props) => (
                    <ProductividadVerticalBarLabel {...props} barCount={byDate.length} />
                  )}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  const byDateHourBlock = (
    <div className="flex min-h-0 w-full min-w-0 shrink-0 flex-col rounded-lg border border-slate-100 bg-white p-3 shadow-sm">
      <div className="mb-2 flex shrink-0 flex-row items-center justify-between gap-2">
        <h3 className="text-xs font-semibold text-[#0f5666]">Por fecha y hora</h3>
        <ExportBtn
          disabled={byDateHourLoading}
          onClick={() =>
            downloadCsv(`/api/dashboard/productividad/by-date-hour?export=csv&${qsBase}`)
          }
        />
      </div>
      {byDateHourLoading ? (
        <PanelSkeleton className="h-[200px] w-full md:h-56" />
      ) : byDateHour.length === 0 ? (
        <NoData />
      ) : (
        <div className="h-[200px] w-full shrink-0 md:h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDateHour} margin={{ top: 8, right: 8, left: 0, bottom: 44 }}>
              <CartesianGrid stroke={CHART_GRID} vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 8, angle: -40, textAnchor: "end" }}
                height={48}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 10 }} width={36} allowDecimals={false} />
              <Tooltip
                formatter={(value: any) => {
                  if (value == null) return ["", "Conteo"];
                  const num = typeof value === "number" ? value : Number(value);
                  return [
                    Number.isFinite(num) ? num.toLocaleString("es-PE") : "",
                    "Conteo",
                  ];
                }}
              />
              <Bar dataKey="cnt" name="Conteo" fill={PETROLEO} radius={[3, 3, 0, 0]}>
                <LabelList
                  dataKey="cnt"
                  content={(props) => (
                    <ProductividadVerticalBarLabel {...props} barCount={byDateHour.length} />
                  )}
                />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );

  return (
    <div className="flex min-w-0 w-full max-w-none flex-col gap-6">
      <div
        className={cn(
          "max-sm:static sticky z-40 -mx-1 overflow-visible",
          "top-[var(--dashboard-nav-offset,72px)]",
          "border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm",
        )}
      >
        <div className="flex flex-wrap items-end gap-3">
          <ProductividadFilterMulti
            label="Estado"
            options={filterOptions.estado ?? []}
            selected={filters.estado}
            onChange={(v) => setFilter("estado", v)}
            loading={filterLoading}
          />
          <ProductividadFilterMulti
            label="Nº semana"
            options={filterOptions.n_semana ?? []}
            selected={filters.nSemana}
            onChange={(v) => setFilter("nSemana", v)}
            loading={filterLoading}
          />
          <ProductividadFilterMulti
            label="Solicitante"
            options={filterOptions.us_name ?? []}
            selected={filters.usName}
            onChange={(v) => setFilter("usName", v)}
            loading={filterLoading}
            className="min-w-[9rem]"
          />
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[#0f5666]/80">
              Fecha desde
            </label>
            <Input
              type="date"
              className="h-8 w-[9.5rem] text-xs"
              value={filters.fechaFrom}
              onChange={(e) => setFilter("fechaFrom", e.target.value)}
            />
          </div>
          <div>
            <label className="mb-0.5 block text-[10px] font-semibold uppercase tracking-wide text-[#0f5666]/80">
              Fecha hasta
            </label>
            <Input
              type="date"
              className="h-8 w-[9.5rem] text-xs"
              value={filters.fechaTo}
              onChange={(e) => setFilter("fechaTo", e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
        {seriesLegend}
        {weekdayToggles}
      </div>

      {/* md+: 50/50 (grid-cols-2), sin gutter horizontal; móvil: métricas → acciones → gráficas */}
      <div
        className={cn(
          "grid min-h-0 w-full max-w-none grid-cols-1 gap-6",
          "md:grid-cols-2 md:grid-rows-[auto_auto_auto] md:items-stretch md:gap-x-0 md:gap-y-4",
        )}
      >
        <div className="order-1 min-h-0 w-full min-w-0 md:col-start-2 md:row-start-1 md:self-start">
          {metricCardsRow}
        </div>

        <div className="order-2 flex min-h-0 w-full min-w-0 flex-col md:col-start-1 md:row-span-3 md:row-start-1 md:h-full">
          {actionsByUserBlock}
        </div>

        <div className="order-3 min-h-0 w-full min-w-0 md:col-start-2 md:row-start-2">{byDateBlock}</div>

        <div className="order-4 min-h-0 w-full min-w-0 md:col-start-2 md:row-start-3">{byDateHourBlock}</div>
      </div>
    </div>
  );
}
