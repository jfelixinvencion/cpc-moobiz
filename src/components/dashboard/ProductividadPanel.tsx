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
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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
import { cn } from "@/lib/utils";

const DEBOUNCE_MS = 400;
const USER_PAGE = 20;
const BAR_ROW_H = 34;
const CHART_SCROLL_MAX = 600;
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

const FILTER_FIELDS: ProductividadFilterField[] = [
  "global",
  "estado",
  "n_semana",
  "type_user",
  "type_log_name",
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

function filtersToParams(
  f: FilterState,
  opts?: { limit?: number; offset?: number; skipTypeLogName?: boolean },
): ProductividadParsedParams {
  const nullIf = (a: string[]) => (a.length === 0 ? null : a);
  return {
    global: nullIf(f.global),
    estado: nullIf(f.estado),
    nSemana: nullIf(f.nSemana),
    fechaFrom: isoInputToFechaParam(f.fechaFrom),
    fechaTo: isoInputToFechaParam(f.fechaTo),
    typeUser: nullIf(f.typeUser),
    typeLogName: opts?.skipTypeLogName ? null : nullIf(f.typeLogName),
    usName: nullIf(f.usName),
    limit: opts?.limit ?? USER_PAGE,
    offset: opts?.offset ?? 0,
  };
}

function buildQuery(
  f: FilterState,
  opts?: { limit?: number; offset?: number; skipTypeLogName?: boolean },
): string {
  const p = new URLSearchParams();
  appendProductividadParams(p, filtersToParams(f, opts), {
    skipTypeLogName: opts?.skipTypeLogName,
  });
  return p.toString();
}

type UserRow = {
  us_name: string;
  type_log_name: string;
  cnt: number;
  total_per_user: number;
};

type ChartUserDatum = Record<string, string | number> & { us_name: string; total: number };

function pivotUserRows(rows: UserRow[]): ChartUserDatum[] {
  const byUser = new Map<string, ChartUserDatum>();
  for (const r of rows) {
    let row = byUser.get(r.us_name);
    if (!row) {
      row = { us_name: r.us_name, total: r.total_per_user };
      for (const t of PRODUCTIVIDAD_LOG_TYPES) row[t] = 0;
      byUser.set(r.us_name, row);
    }
    row[r.type_log_name] = r.cnt;
  }
  return Array.from(byUser.values()).sort((a, b) => (b.total as number) - (a.total as number));
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
  const debouncedFilters = useDebounced(filters, DEBOUNCE_MS);

  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  const [filterLoading, setFilterLoading] = useState(false);

  const [userRows, setUserRows] = useState<UserRow[]>([]);
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

  const loadFilterOptions = useCallback(async (f: FilterState) => {
    setFilterLoading(true);
    try {
      const q = buildQuery(f);
      const entries = await Promise.all(
        FILTER_FIELDS.map(async (field) => {
          const res = await fetch(
            `/api/dashboard/productividad/filters?field=${field}&${q}`,
            { cache: "no-store" },
          );
          const body = (await res.json()) as { values?: string[]; error?: string };
          if (!res.ok) throw new Error(body.error ?? res.statusText);
          return [field, Array.isArray(body.values) ? body.values : []] as const;
        }),
      );
      setFilterOptions(Object.fromEntries(entries));
    } catch {
      /* mantener opciones previas */
    } finally {
      setFilterLoading(false);
    }
  }, []);

  const loadUsers = useCallback(
    async (f: FilterState, offset: number, append: boolean) => {
      setUsersLoading(true);
      setUsersError(null);
      try {
        const qs = buildQuery(f, { limit: USER_PAGE, offset });
        const res = await fetch(`/api/dashboard/productividad/users?${qs}`, {
          cache: "no-store",
        });
        const body = (await res.json()) as {
          rows?: UserRow[];
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

  const loadCards = useCallback(async (f: FilterState) => {
    setCardsLoading(true);
    try {
      const qs = buildQuery(f, { skipTypeLogName: true });
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
  }, []);

  const loadByDate = useCallback(async (f: FilterState) => {
    setByDateLoading(true);
    try {
      const qs = buildQuery(f);
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
  }, []);

  const loadByDateHour = useCallback(async (f: FilterState) => {
    setByDateHourLoading(true);
    try {
      const qs = buildQuery(f);
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
  }, []);

  useEffect(() => {
    void loadFilterOptions(debouncedFilters);
  }, [debouncedFilters, loadFilterOptions]);

  useEffect(() => {
    void loadUsers(debouncedFilters, 0, false);
    void loadCards(debouncedFilters);
    void loadByDate(debouncedFilters);
    void loadByDateHour(debouncedFilters);
  }, [debouncedFilters, loadUsers, loadCards, loadByDate, loadByDateHour]);

  const chartUserData = useMemo(() => pivotUserRows(userRows), [userRows]);
  const activeTypes = useMemo(
    () => PRODUCTIVIDAD_LOG_TYPES.filter((t) => visibleTypes[t]),
    [visibleTypes],
  );

  const chartInnerH = Math.max(chartUserData.length * BAR_ROW_H + 48, 120);

  const onChartScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || usersLoading || loadingMoreRef.current) return;
    if (userRows.length >= userTotal) return;
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 80;
    if (!nearBottom) return;
    loadingMoreRef.current = true;
    const nextOffset = userOffset + USER_PAGE;
    void loadUsers(debouncedFilters, nextOffset, true);
  }, [debouncedFilters, loadUsers, userOffset, userRows.length, userTotal, usersLoading]);

  const qsBase = buildQuery(debouncedFilters);

  return (
    <div className="space-y-4">
      <div
        className={cn(
          "max-sm:static sticky z-40 -mx-1 overflow-visible",
          "top-[var(--dashboard-nav-offset,72px)]",
          "border-b border-slate-200 bg-white/95 px-4 py-3 shadow-sm backdrop-blur-sm",
        )}
      >
        <div className="flex flex-wrap items-end gap-3">
          <ProductividadFilterMulti
            label="Global"
            options={filterOptions.global ?? []}
            selected={filters.global}
            onChange={(v) => setFilter("global", v)}
            loading={filterLoading}
          />
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
            label="Tipo usuario"
            options={filterOptions.type_user ?? []}
            selected={filters.typeUser}
            onChange={(v) => setFilter("typeUser", v)}
            loading={filterLoading}
          />
          <ProductividadFilterMulti
            label="Tipo log"
            options={filterOptions.type_log_name ?? []}
            selected={filters.typeLogName}
            onChange={(v) => setFilter("typeLogName", v)}
            loading={filterLoading}
          />
          <ProductividadFilterMulti
            label="Usuario"
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

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2.5">
            <CardTitle className="text-sm font-semibold text-[#0f5666]">
              Acciones por usuario
            </CardTitle>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-slate-500">
                {chartUserData.length} / {userTotal} usuarios
              </span>
              <ExportBtn
                disabled={usersLoading}
                onClick={() =>
                  downloadCsv(
                    `/api/dashboard/productividad/users?export=csv&${qsBase}`,
                  )
                }
              />
            </div>
          </CardHeader>
          <CardContent className="space-y-2 pb-4">
            <div className="flex flex-wrap gap-2">
              {PRODUCTIVIDAD_LOG_TYPES.map((type) => {
                const on = visibleTypes[type];
                return (
                  <button
                    key={type}
                    type="button"
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[10px] font-medium transition",
                      on ? "border-transparent text-white" : "border-slate-200 bg-white text-slate-400",
                    )}
                    style={on ? { backgroundColor: TYPE_COLORS[type] } : undefined}
                    onClick={() =>
                      setVisibleTypes((prev) => ({ ...prev, [type]: !prev[type] }))
                    }
                    aria-pressed={on}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ backgroundColor: TYPE_COLORS[type] }}
                    />
                    {type}
                  </button>
                );
              })}
            </div>
            {usersError ? (
              <p className="text-xs text-red-600">{usersError}</p>
            ) : null}
            {usersLoading && chartUserData.length === 0 ? (
              <PanelSkeleton className="h-[400px] w-full" />
            ) : chartUserData.length === 0 ? (
              <NoData />
            ) : (
              <div
                ref={scrollRef}
                className="overflow-y-auto rounded-lg border border-slate-100 pr-1"
                style={{ maxHeight: CHART_SCROLL_MAX }}
                onScroll={onChartScroll}
              >
                <ResponsiveContainer width="100%" height={chartInnerH} minWidth={320}>
                  <BarChart
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
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const total = Number(
                          chartUserData.find((d) => d.us_name === label)?.total ?? 0,
                        );
                        return (
                          <div className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs shadow-md">
                            <p className="mb-1 font-semibold text-[#0f5666]">{label}</p>
                            {payload.map((entry) => {
                              const v = Number(entry.value ?? 0);
                              const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
                              return (
                                <p key={String(entry.dataKey)} className="text-slate-700">
                                  <span style={{ color: entry.color }}>{entry.name}: </span>
                                  {v.toLocaleString("es-PE")} ({pct}%)
                                </p>
                              );
                            })}
                          </div>
                        );
                      }}
                    />
                    {activeTypes.map((type) => (
                      <Bar
                        key={type}
                        dataKey={type}
                        name={type}
                        stackId="a"
                        fill={TYPE_COLORS[type]}
                        isAnimationActive={false}
                      >
                        {chartUserData.map((entry) => (
                          <Cell
                            key={`${type}-${entry.us_name}`}
                            fillOpacity={
                              hoveredUser && hoveredUser !== entry.us_name ? 0.35 : 1
                            }
                          />
                        ))}
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
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-2">
            {PRODUCTIVIDAD_LOG_TYPES.map((type) => {
              const card = cards.find((c) => c.type === type);
              return (
                <Card
                  key={type}
                  className="border-slate-200 bg-white shadow-sm"
                >
                  <CardHeader className="space-y-0 bg-[#0f5666] px-2.5 py-2">
                    <CardTitle className="text-[10px] font-semibold uppercase tracking-wide text-white">
                      {type}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-2.5 py-2.5 text-center">
                    {cardsLoading ? (
                      <PanelSkeleton className="mx-auto h-10 w-16" />
                    ) : (
                      <>
                        <p className="text-lg font-bold tabular-nums text-[#2fb6b0]">
                          {(card?.ratio ?? 0).toFixed(2)}
                        </p>
                        <p className="text-[10px] text-slate-500">por hora</p>
                        <p className="mt-1 text-sm font-semibold tabular-nums text-slate-800">
                          {(card?.total ?? 0).toLocaleString("es-PE")}
                        </p>
                        <p className="text-[10px] text-slate-400">total</p>
                      </>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between py-2">
              <CardTitle className="text-xs font-semibold text-[#0f5666]">Por fecha</CardTitle>
              <ExportBtn
                disabled={byDateLoading}
                onClick={() =>
                  downloadCsv(`/api/dashboard/productividad/by-date?export=csv&${qsBase}`)
                }
              />
            </CardHeader>
            <CardContent className="pb-3">
              {byDateLoading ? (
                <PanelSkeleton className="h-40 w-full" />
              ) : byDate.length === 0 ? (
                <NoData />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={byDate} margin={{ top: 4, right: 4, left: 0, bottom: 32 }}>
                    <CartesianGrid stroke={CHART_GRID} vertical={false} />
                    <XAxis
                      dataKey="fecha"
                      tick={{ fontSize: 8, angle: -35, textAnchor: "end" }}
                      height={48}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 9 }} width={32} allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number) => [v.toLocaleString("es-PE"), "Conteo"]}
                      labelFormatter={(l) => `Fecha: ${l}`}
                    />
                    <Bar dataKey="cnt" name="Conteo" fill={TURQUESA} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between py-2">
              <CardTitle className="text-xs font-semibold text-[#0f5666]">
                Por fecha y hora
              </CardTitle>
              <ExportBtn
                disabled={byDateHourLoading}
                onClick={() =>
                  downloadCsv(
                    `/api/dashboard/productividad/by-date-hour?export=csv&${qsBase}`,
                  )
                }
              />
            </CardHeader>
            <CardContent className="pb-3">
              {byDateHourLoading ? (
                <PanelSkeleton className="h-40 w-full" />
              ) : byDateHour.length === 0 ? (
                <NoData />
              ) : (
                <ResponsiveContainer width="100%" height={160}>
                  <BarChart data={byDateHour} margin={{ top: 4, right: 4, left: 0, bottom: 40 }}>
                    <CartesianGrid stroke={CHART_GRID} vertical={false} />
                    <XAxis
                      dataKey="label"
                      tick={{ fontSize: 7, angle: -45, textAnchor: "end" }}
                      height={52}
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 9 }} width={32} allowDecimals={false} />
                    <Tooltip
                      formatter={(v: number) => [v.toLocaleString("es-PE"), "Conteo"]}
                    />
                    <Bar dataKey="cnt" name="Conteo" fill={PETROLEO} radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
