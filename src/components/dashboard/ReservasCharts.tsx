"use client";

import { formatInTimeZone } from "date-fns-tz";
import { Download, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { GranularityToggle } from "@/components/dashboard/GranularityToggle";
import { ProductividadFilterMulti } from "@/components/dashboard/productividad-filter-multi";
import { ReservasChartCard } from "@/components/dashboard/ReservasChartCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  appendReservasParams,
  type ReservasAggregationsResponse,
  type ReservasGranularity,
} from "@/lib/aggregations-reservas";
import { cn } from "@/lib/utils";

const AMERICA_LIMA = "America/Lima";
const CHART_COLORS = ["#0f5666", "#2fb6b0", "#14b8a6", "#f59e0b", "#a855f7", "#f43f5e", "#64748b"];
const CHART3_Y_TICK_COUNT = 5;
const CHART3_ABSOLUTE_Y_MIN = 10;

function chart3YAxisMax(numeratorValues: number[], showPercent: boolean): number {
  if (showPercent) return 100;
  const maxNumerator = numeratorValues.length > 0 ? Math.max(...numeratorValues) : 0;
  if (maxNumerator === 0) return CHART3_ABSOLUTE_Y_MIN;
  const suggestedMax = Math.ceil(maxNumerator * 1.1);
  return maxNumerator <= 10
    ? Math.max(suggestedMax, CHART3_ABSOLUTE_Y_MIN)
    : suggestedMax;
}

type Props = {
  active?: boolean;
};

function isoDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultRange(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start: isoDateInput(start), end: isoDateInput(end) };
}

function formatBucketLabel(bucket: string, granularity: ReservasGranularity): string {
  const d = new Date(bucket);
  if (Number.isNaN(d.getTime())) return bucket;
  switch (granularity) {
    case "hour":
      return formatInTimeZone(d, AMERICA_LIMA, "dd/MM/yyyy HH:mm");
    case "day":
      return formatInTimeZone(d, AMERICA_LIMA, "dd/MM/yyyy");
    case "week":
      return formatInTimeZone(d, AMERICA_LIMA, "dd/MM/yyyy") + " (sem)";
    case "month":
      return formatInTimeZone(d, AMERICA_LIMA, "MMM yyyy");
    default:
      return bucket;
  }
}

function toRechartsRows(
  buckets: string[],
  series: { name: string; data: number[] }[],
  granularity: ReservasGranularity,
) {
  return buckets.map((bucket, i) => {
    const row: Record<string, string | number> = {
      bucket,
      bucketLabel: formatBucketLabel(bucket, granularity),
    };
    for (const s of series) {
      row[s.name] = s.data[i] ?? 0;
    }
    return row;
  });
}

function chart3Rows(
  buckets: string[],
  numerator: number[],
  denominator: number[],
  showPercent: boolean,
  granularity: ReservasGranularity,
) {
  return buckets.map((bucket, i) => {
    const num = numerator[i] ?? 0;
    const den = denominator[i] ?? 0;
    const pct = den > 0 ? (num / den) * 100 : 0;
    return {
      bucket,
      bucketLabel: formatBucketLabel(bucket, granularity),
      value: showPercent ? pct : num,
      absolute: num,
      total: den,
      percentage: pct,
    };
  });
}

export function ReservasCharts({ active = true }: Props) {
  const initialRange = useMemo(() => defaultRange(), []);
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [granularity, setGranularity] = useState<ReservasGranularity>("day");
  const [semana, setSemana] = useState<string | null>(null);
  const [estadoGlobal, setEstadoGlobal] = useState<string[]>([]);
  const [chart2Estado, setChart2Estado] = useState<string[]>([]);
  const [showPercentChart3, setShowPercentChart3] = useState(false);

  const [data, setData] = useState<ReservasAggregationsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const buildParams = useCallback(() => {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59.999`);
    return {
      start,
      end,
      granularity,
      semana,
      estado: estadoGlobal.length > 0 ? estadoGlobal : null,
      chart2Estado: chart2Estado.length > 0 ? chart2Estado : null,
    };
  }, [chart2Estado, endDate, estadoGlobal, granularity, semana, startDate]);

  const fetchData = useCallback(async () => {
    if (!active) return;
    setLoading(true);
    setError(null);
    try {
      const p = new URLSearchParams();
      appendReservasParams(p, buildParams());
      const res = await fetch(`/api/dashboard/reservas/aggregations?${p.toString()}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as ReservasAggregationsResponse & { error?: string };
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setData(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [active, buildParams]);

  useEffect(() => {
    if (!active) return;
    void fetchData();
  }, [active, fetchData]);

  const exportCsv = useCallback(
    async (chart: "1" | "2" | "3" | "all") => {
      try {
        const p = new URLSearchParams();
        appendReservasParams(p, buildParams());
        p.set("chart", chart);
        if (chart === "3" || chart === "all") {
          p.set("include_percent", showPercentChart3 ? "1" : "0");
        }
        const res = await fetch(`/api/dashboard/reservas/export?${p.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error ?? res.statusText);
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download =
          chart === "all"
            ? "reservas-charts-all.csv"
            : `reservas-chart${chart}.csv`;
        a.click();
        URL.revokeObjectURL(url);
        setNotice({ type: "success", text: "CSV exportado correctamente" });
      } catch (e) {
        setNotice({
          type: "error",
          text: e instanceof Error ? e.message : "Error al exportar CSV",
        });
      }
    },
    [buildParams, showPercentChart3],
  );

  const chart1Rows = useMemo(
    () =>
      data
        ? toRechartsRows(data.chart1.buckets, data.chart1.series, data.meta.granularity)
        : [],
    [data],
  );

  const chart2Rows = useMemo(
    () =>
      data
        ? toRechartsRows(data.chart2.buckets, data.chart2.series, data.meta.granularity)
        : [],
    [data],
  );

  const chart3RowsData = useMemo(
    () =>
      data
        ? chart3Rows(
            data.chart3.buckets,
            data.chart3.numerator,
            data.chart3.denominator,
            showPercentChart3,
            data.meta.granularity,
          )
        : [],
    [data, showPercentChart3],
  );

  const chart3YMax = useMemo(
    () => chart3YAxisMax(data?.chart3.numerator ?? [], showPercentChart3),
    [data, showPercentChart3],
  );

  const estadoOptions = data?.filterOptions.estados ?? [];
  const semanaOptions = data?.filterOptions.semanas ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-lg border border-slate-200 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="reservas-start" className="text-[10px] font-semibold uppercase text-slate-500">
              Desde
            </Label>
            <Input
              id="reservas-start"
              type="date"
              className="h-8 w-36 text-xs"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="reservas-end" className="text-[10px] font-semibold uppercase text-slate-500">
              Hasta
            </Label>
            <Input
              id="reservas-end"
              type="date"
              className="h-8 w-36 text-xs"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] font-semibold uppercase text-slate-500">Granularidad</Label>
            <GranularityToggle value={granularity} onChange={setGranularity} disabled={loading} />
          </div>
          <ProductividadFilterMulti
            label="Semana"
            options={semanaOptions}
            selected={semana ? [semana] : []}
            onChange={(v) => setSemana(v[0] ?? null)}
            loading={loading && !data}
            className="min-w-[12rem]"
          />
          <ProductividadFilterMulti
            label="Estado (global)"
            options={estadoOptions}
            selected={estadoGlobal}
            onChange={setEstadoGlobal}
            loading={loading && !data}
            className="min-w-[10rem]"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={loading}
            onClick={() => void fetchData()}
            aria-label="Refrescar datos"
          >
            {loading ? (
              <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden />
            )}
            Refrescar
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 text-xs"
            disabled={loading || !data}
            onClick={() => void exportCsv("all")}
            aria-label="Exportar todos los gráficos a CSV"
          >
            <Download className="mr-1 h-3.5 w-3.5" aria-hidden />
            Exportar CSV
          </Button>
        </div>
      </div>

      {notice ? (
        <p
          className={cn(
            "text-xs",
            notice.type === "success" ? "text-emerald-700" : "text-red-600",
          )}
          role="status"
        >
          {notice.text}
        </p>
      ) : null}
      {error ? <p className="text-xs text-red-600">{error}</p> : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <ReservasChartCard
          title="N° Reservas por Estado"
          subtitle="Barras apiladas por estado"
          loading={loading && !data}
          onExport={() => void exportCsv("1")}
          exportDisabled={!data}
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart1Rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
              <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                formatter={(value, name) => [Number(value).toLocaleString("es-PE"), String(name)]}
                labelFormatter={(label) => String(label)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {(data?.chart1.series ?? []).map((s, idx) => (
                <Bar
                  key={s.name}
                  dataKey={s.name}
                  stackId="estado"
                  fill={CHART_COLORS[idx % CHART_COLORS.length]}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </ReservasChartCard>

        <ReservasChartCard
          title="N° Reservas totales"
          subtitle="Total por bucket (filtro de estado en tarjeta)"
          loading={loading && !data}
          onExport={() => void exportCsv("2")}
          exportDisabled={!data}
          controls={
            <ProductividadFilterMulti
              label="Estado"
              options={estadoOptions}
              selected={chart2Estado}
              onChange={setChart2Estado}
              loading={loading && !data}
              className="min-w-[10rem]"
            />
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart2Rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
              <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
              <Tooltip
                formatter={(value) => [Number(value).toLocaleString("es-PE"), "Total"]}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="Total" fill="#0f5666" />
            </BarChart>
          </ResponsiveContainer>
        </ReservasChartCard>

        <ReservasChartCard
          title="N° Reservas Apoyo"
          subtitle="Nombre Conductor = Nuevos, Estado = Finalizado"
          loading={loading && !data}
          onExport={() => void exportCsv("3")}
          exportDisabled={!data}
          controls={
            <Button
              type="button"
              variant={showPercentChart3 ? "default" : "outline"}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowPercentChart3((v) => !v)}
              aria-pressed={showPercentChart3}
              aria-label="Mostrar porcentaje"
            >
              Mostrar %
            </Button>
          }
        >
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={chart3RowsData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.35)" />
              <XAxis dataKey="bucketLabel" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
              <YAxis
                tick={{ fontSize: 10 }}
                domain={[0, chart3YMax]}
                tickCount={CHART3_Y_TICK_COUNT}
                allowDecimals={false}
                tickFormatter={(v) => (showPercentChart3 ? `${v}%` : String(v))}
              />
              <Tooltip
                formatter={(value, _name, item) => {
                  const row = item?.payload as {
                    absolute?: number;
                    total?: number;
                    percentage?: number;
                  };
                  if (showPercentChart3) {
                    return [
                      `${Number(value).toFixed(1)}% (${row?.absolute ?? 0} / ${row?.total ?? 0})`,
                      "Apoyo",
                    ];
                  }
                  return [Number(value).toLocaleString("es-PE"), "Apoyo"];
                }}
                labelFormatter={(label) => String(label)}
              />
              <Bar dataKey="value" fill="#2fb6b0" />
            </BarChart>
          </ResponsiveContainer>
        </ReservasChartCard>
      </div>
    </div>
  );
}
