"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { format, parse } from "date-fns";
import { es } from "date-fns/locale";
import { Loader2 } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ymToMmmYy, type ServicesMoobizGranularity } from "@/lib/services-moobiz-dashboard-params";

const CHART_GRID = "rgba(148, 163, 184, 0.35)";
const BAR_FILL = "#0ea5e9";

type MonthOpt = { value: string; label: string };

type FiltersOptions = {
  estados: string[];
  creados_por: string[];
  productos: string[];
  empresas: string[];
  sucursales: string[];
  conductor_categories: string[];
};

type ApiSeries = { period: string; count: number };

type ApiBody = {
  series?: ApiSeries[];
  total?: number;
  monthsOptions?: MonthOpt[];
  filtersOptions?: FiltersOptions;
  error?: string;
};

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function buildQueryParams(args: {
  granularity: ServicesMoobizGranularity;
  estados: string[];
  creadosPor: string[];
  productos: string[];
  empresas: string[];
  sucursales: string[];
  conductorCategories: string[];
  months: string[];
}): string {
  const p = new URLSearchParams();
  p.set("granularity", args.granularity);
  for (const v of args.estados) p.append("estados", v);
  for (const v of args.creadosPor) p.append("creados_por", v);
  for (const v of args.productos) p.append("productos", v);
  for (const v of args.empresas) p.append("empresas", v);
  for (const v of args.sucursales) p.append("sucursal", v);
  for (const v of args.conductorCategories) p.append("conductor_category", v);
  for (const v of args.months) p.append("months", v);
  return p.toString();
}

function periodTickLabel(period: string, granularity: ServicesMoobizGranularity): string {
  if (!period) return "";
  if (granularity === "monthly") {
    if (/^\d{4}-\d{2}$/.test(period)) return ymToMmmYy(period);
    return period;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    const d = parse(period, "yyyy-MM-dd", new Date());
    if (!Number.isNaN(d.getTime())) return format(d, "d/M/yyyy", { locale: es });
  }
  return period;
}

function MultiFilterDialog(props: {
  title: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  options: string[];
  selected: Set<string>;
  onApply: (next: Set<string>) => void;
}) {
  const { title, open, onOpenChange, options, selected, onApply } = props;
  const [local, setLocal] = useState<Set<string>>(selected);

  useEffect(() => {
    if (open) setLocal(new Set(selected));
  }, [open, selected]);

  const toggle = (v: string) => {
    setLocal((prev) => {
      const n = new Set(prev);
      if (n.has(v)) n.delete(v);
      else n.add(v);
      return n;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Selecciona uno o varios valores. Vacío = sin filtro.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
          {options.length === 0 ? (
            <p className="text-sm text-slate-500">Sin opciones disponibles.</p>
          ) : (
            options.map((opt) => (
              <label key={opt} className="flex cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={local.has(opt)}
                  onChange={() => toggle(opt)}
                />
                <span className="break-all">{opt}</span>
              </label>
            ))
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" size="sm" onClick={() => setLocal(new Set())}>
            Limpiar
          </Button>
          <Button type="button" size="sm" onClick={() => onApply(local)}>
            Aplicar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ServiciosMoobizCard() {
  const [granularity, setGranularity] = useState<ServicesMoobizGranularity>("daily");
  const [estados, setEstados] = useState<Set<string>>(new Set());
  const [creadosPor, setCreadosPor] = useState<Set<string>>(new Set());
  const [productos, setProductos] = useState<Set<string>>(new Set());
  const [empresas, setEmpresas] = useState<Set<string>>(new Set());
  const [sucursales, setSucursales] = useState<Set<string>>(new Set());
  const [conductorCat, setConductorCat] = useState<Set<string>>(new Set());
  const [months, setMonths] = useState<Set<string>>(new Set());

  const debounced = useDebounced(
    {
      granularity,
      estados,
      creadosPor,
      productos,
      empresas,
      sucursales,
      conductorCat,
      months,
    },
    300,
  );

  const [series, setSeries] = useState<ApiSeries[]>([]);
  const [total, setTotal] = useState(0);
  const [monthsOptions, setMonthsOptions] = useState<MonthOpt[]>([]);
  const [filtersOptions, setFiltersOptions] = useState<FiltersOptions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataOpen, setDataOpen] = useState(false);
  const [dataRows, setDataRows] = useState<Record<string, unknown>[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [dlg, setDlg] = useState<
    | null
    | "estado"
    | "creado"
    | "producto"
    | "empresa"
    | "sucursal"
    | "conductor"
    | "mes"
  >(null);

  const abortRef = useRef<AbortController | null>(null);

  const queryString = useMemo(
    () =>
      buildQueryParams({
        granularity: debounced.granularity,
        estados: [...debounced.estados],
        creadosPor: [...debounced.creadosPor],
        productos: [...debounced.productos],
        empresas: [...debounced.empresas],
        sucursales: [...debounced.sucursales],
        conductorCategories: [...debounced.conductorCat],
        months: [...debounced.months],
      }),
    [debounced],
  );

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const c = new AbortController();
    abortRef.current = c;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/services-moobiz?${queryString}`, {
        cache: "no-store",
        signal: c.signal,
      });
      const body = (await res.json()) as ApiBody;
      if (!res.ok) throw new Error(body.error || "No se pudo cargar Servicios Moobiz.");
      setSeries(Array.isArray(body.series) ? body.series : []);
      setTotal(typeof body.total === "number" ? body.total : 0);
      setMonthsOptions(Array.isArray(body.monthsOptions) ? body.monthsOptions : []);
      setFiltersOptions(body.filtersOptions ?? null);
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setSeries([]);
      setTotal(0);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === c) {
        abortRef.current = null;
        setLoading(false);
      }
    }
  }, [queryString]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  const chartData = useMemo(
    () =>
      series.map((s) => ({
        ...s,
        label: periodTickLabel(s.period, debounced.granularity),
      })),
    [series, debounced.granularity],
  );

  const openData = async () => {
    setDataOpen(true);
    setDataLoading(true);
    setDataError(null);
    try {
      const res = await fetch(`/api/dashboard/services-moobiz/data?${queryString}`, { cache: "no-store" });
      const body = (await res.json()) as { data?: Record<string, unknown>[]; error?: string };
      if (!res.ok) throw new Error(body.error || "No se pudieron cargar las filas.");
      setDataRows(Array.isArray(body.data) ? body.data : []);
    } catch (e) {
      setDataRows([]);
      setDataError(e instanceof Error ? e.message : String(e));
    } finally {
      setDataLoading(false);
    }
  };

  const fo = filtersOptions;

  const chip = (label: string, sel: Set<string>) =>
    `${label}${sel.size ? ` (${sel.size})` : ""}`;

  return (
    <Card className="border-slate-200 bg-white text-slate-900 shadow-sm">
      <CardHeader className="space-y-2 border-b border-slate-100 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Servicios Moobiz</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="bg-slate-100 text-slate-700">
              {loading ? "…" : `${total.toLocaleString("es-PE")} servicios`}
            </Badge>
            <Button type="button" variant="outline" size="sm" className="h-8 text-xs" onClick={() => void openData()}>
              Ver datos
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-slate-200 p-0.5">
            <Button
              type="button"
              variant={granularity === "daily" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3 text-xs"
              disabled={loading}
              onClick={() => setGranularity("daily")}
            >
              Diario
            </Button>
            <Button
              type="button"
              variant={granularity === "monthly" ? "default" : "ghost"}
              size="sm"
              className="h-8 px-3 text-xs"
              disabled={loading}
              onClick={() => setGranularity("monthly")}
            >
              Mensual
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading || !fo}
            onClick={() => setDlg("estado")}
          >
            {chip("Estado", estados)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading || !fo}
            onClick={() => setDlg("creado")}
          >
            {chip("Creado por", creadosPor)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading || !fo}
            onClick={() => setDlg("producto")}
          >
            {chip("Producto", productos)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading || !fo}
            onClick={() => setDlg("empresa")}
          >
            {chip("Empresa", empresas)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading || !fo}
            onClick={() => setDlg("sucursal")}
          >
            {chip("Sucursal", sucursales)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading || !fo}
            onClick={() => setDlg("conductor")}
          >
            {chip("Conductor", conductorCat)}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 max-w-[10rem] truncate text-xs"
            disabled={loading}
            onClick={() => setDlg("mes")}
          >
            {chip("F. Programada (mes)", months)}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-800">{error}</p>
        ) : null}
        <div className="h-[320px] w-full rounded-lg border border-slate-100 bg-slate-50/40 p-2">
          {loading ? (
            <div className="flex h-full items-center justify-center text-slate-500">
              <Loader2 className="mr-2 h-6 w-6 animate-spin" aria-hidden />
              <span className="text-sm">Cargando…</span>
            </div>
          ) : chartData.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-slate-500">Sin datos en el rango.</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 8 }}>
                <CartesianGrid stroke={CHART_GRID} vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: "#475569" }}
                  interval="preserveStartEnd"
                  angle={granularity === "daily" ? -35 : 0}
                  textAnchor={granularity === "daily" ? "end" : "middle"}
                  height={granularity === "daily" ? 56 : 28}
                />
                <YAxis width={36} tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip
                  formatter={(value) => [value != null ? String(value) : "", "Servicios"]}
                  labelFormatter={(label) => String(label ?? "")}
                />
                <Bar dataKey="count" name="Servicios" fill={BAR_FILL} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </CardContent>

      {fo ? (
        <>
          <MultiFilterDialog
            title="Estado"
            open={dlg === "estado"}
            onOpenChange={(o) => !o && setDlg(null)}
            options={fo.estados}
            selected={estados}
            onApply={(next) => {
              setEstados(next);
              setDlg(null);
            }}
          />
          <MultiFilterDialog
            title="Creado por"
            open={dlg === "creado"}
            onOpenChange={(o) => !o && setDlg(null)}
            options={fo.creados_por}
            selected={creadosPor}
            onApply={(next) => {
              setCreadosPor(next);
              setDlg(null);
            }}
          />
          <MultiFilterDialog
            title="Producto"
            open={dlg === "producto"}
            onOpenChange={(o) => !o && setDlg(null)}
            options={fo.productos}
            selected={productos}
            onApply={(next) => {
              setProductos(next);
              setDlg(null);
            }}
          />
          <MultiFilterDialog
            title="Empresa"
            open={dlg === "empresa"}
            onOpenChange={(o) => !o && setDlg(null)}
            options={fo.empresas}
            selected={empresas}
            onApply={(next) => {
              setEmpresas(next);
              setDlg(null);
            }}
          />
          <MultiFilterDialog
            title="Sucursal (LIMA / PROVINCIA)"
            open={dlg === "sucursal"}
            onOpenChange={(o) => !o && setDlg(null)}
            options={fo.sucursales}
            selected={sucursales}
            onApply={(next) => {
              setSucursales(new Set([...next].filter((x) => x === "LIMA" || x === "PROVINCIA")));
              setDlg(null);
            }}
          />
          <MultiFilterDialog
            title="Categoría conductor"
            open={dlg === "conductor"}
            onOpenChange={(o) => !o && setDlg(null)}
            options={fo.conductor_categories}
            selected={conductorCat}
            onApply={(next) => {
              setConductorCat(
                new Set([...next].filter((x) => ["APOYO LIMA", "APOYO PROVINCIA", "AFILIADO"].includes(x))),
              );
              setDlg(null);
            }}
          />
        </>
      ) : null}

      <Dialog open={dlg === "mes"} onOpenChange={(o) => !o && setDlg(null)}>
        <DialogContent className="max-h-[85vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Mes (F. Programada)</DialogTitle>
            <DialogDescription>Filtra por mes de la fecha programada (zona Lima).</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-2 overflow-y-auto pr-1">
            {monthsOptions.length === 0 ? (
              <p className="text-sm text-slate-500">Sin meses disponibles.</p>
            ) : (
              monthsOptions.map((opt) => (
                <label key={opt.value} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-slate-300"
                    checked={months.has(opt.value)}
                    onChange={() =>
                      setMonths((prev) => {
                        const n = new Set(prev);
                        if (n.has(opt.value)) n.delete(opt.value);
                        else n.add(opt.value);
                        return n;
                      })
                    }
                  />
                  <span>
                    {opt.label} <span className="text-slate-400">({opt.value})</span>
                  </span>
                </label>
              ))
            )}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => setMonths(new Set())}>
              Limpiar
            </Button>
            <Button type="button" size="sm" onClick={() => setDlg(null)}>
              Listo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dataOpen} onOpenChange={setDataOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Servicios (muestra)</DialogTitle>
            <DialogDescription>Hasta 200 filas con los mismos filtros que la gráfica.</DialogDescription>
          </DialogHeader>
          {dataLoading ? (
            <div className="flex items-center gap-2 py-6 text-sm text-slate-500">
              <Loader2 className="h-5 w-5 animate-spin" />
              Cargando…
            </div>
          ) : dataError ? (
            <p className="text-sm text-red-600">{dataError}</p>
          ) : (
            <div className="max-h-[55vh] overflow-auto rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">F. Programada</TableHead>
                    <TableHead className="text-xs">ID Servicio</TableHead>
                    <TableHead className="text-xs">Estado</TableHead>
                    <TableHead className="text-xs">Producto</TableHead>
                    <TableHead className="text-xs">Empresa</TableHead>
                    <TableHead className="text-xs">Sucursal</TableHead>
                    <TableHead className="text-xs">Conductor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dataRows.map((r, i) => (
                    <TableRow key={`${String(r.id_servicio ?? i)}-${i}`}>
                      <TableCell className="max-w-[140px] truncate text-xs">
                        {String(r.f_programada ?? "—")}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{String(r.id_servicio ?? "—")}</TableCell>
                      <TableCell className="text-xs">{String(r.estado ?? "—")}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs">{String(r.producto ?? "—")}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs">{String(r.empresa ?? "—")}</TableCell>
                      <TableCell className="text-xs">{String(r.sucursal_group ?? "—")}</TableCell>
                      <TableCell className="text-xs">{String(r.conductor_category ?? "—")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
