"use client";// test cambio

import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
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
  const [dashboardEmpresa, setDashboardEmpresa] = useState("Todas");
  const [dashboardStartDate, setDashboardStartDate] = useState("");
  const [dashboardEndDate, setDashboardEndDate] = useState("");
  const [mainTab, setMainTab] = useState("datos");
  const [dashboardSubTab, setDashboardSubTab] = useState("reservas");
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
      if (dashboardStartDate) params.set("startDate", dashboardStartDate);
      if (dashboardEndDate) params.set("endDate", dashboardEndDate);
      if (dashboardEmpresa && dashboardEmpresa !== "Todas") {
        params.set("empresa", dashboardEmpresa);
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
  }, [dashboardStartDate, dashboardEndDate, dashboardEmpresa]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard, refreshKey]);

  const dashboardEmpresasEnDatos = dashboardData?.filters.empresas ?? [];

  /** Ancho por franja (px); el resto de horas se ve con scroll horizontal. */
  const SCHEDULE_SLOT_PX = 28;
  const scheduleChartData = dashboardData?.charts.pendingBySchedule ?? [];
  const scheduleChartWidth = Math.max(scheduleChartData.length * SCHEDULE_SLOT_PX, 320);

  const dashboardAgeLabel = useMemo(() => {
    void dashboardAgeTick;
    if (!dashboardRefreshedAt) return null;
    return formatDistanceToNow(dashboardRefreshedAt, { addSuffix: true, locale: es });
  }, [dashboardRefreshedAt, dashboardAgeTick]);

  return (
    <main className="flex min-h-screen flex-col bg-slate-100 text-slate-900">
      <Tabs value={mainTab} onValueChange={setMainTab} className="flex min-h-0 flex-1 flex-col">
        <div className="sticky top-0 z-50 border-b border-white/10 bg-[#0b1131] text-white shadow-md">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 md:px-6">
            <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-bold tracking-tight text-[#00e676]">moobiz.</span>
                <span className="text-sm text-white/60">Panel de viajes</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-xs text-white/70 md:text-sm">
                  Ultima actualizacion:{" "}
                  <span className="font-medium text-white">
                    {lastUpdate ? lastUpdate.toLocaleString("es-PE") : "Sin datos"}
                  </span>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void handleLogout()}
                  className="border-[#00e676]/45 bg-transparent text-xs text-[#00e676] hover:bg-[#00e676]/15 hover:text-[#00e676]"
                >
                  Cerrar sesion
                </Button>
              </div>
            </div>

            <TabsList className="h-9 w-full max-w-md bg-white/10 p-1 md:h-10">
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
              <div className="flex flex-col gap-2 border-t border-white/10 pt-3 pb-1">
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
                    <Button
                      size="sm"
                      onClick={handleSync}
                      disabled={syncing || loading}
                      className="bg-[#00e676] font-semibold text-[#0b1131] hover:bg-[#00c765]"
                    >
                      {syncing ? "Actualizando..." : "Actualizar"}
                    </Button>
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

            {mainTab === "dashboard" && (
              <div className="flex flex-col gap-3 border-t border-white/10 pt-3 pb-1">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-end lg:justify-between">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      type="date"
                      value={dashboardStartDate}
                      onChange={(e) => setDashboardStartDate(e.target.value)}
                      className="h-9 w-[150px] border-white/20 bg-white/10 text-xs text-white md:w-[170px] md:text-sm"
                    />
                    <Input
                      type="date"
                      value={dashboardEndDate}
                      onChange={(e) => setDashboardEndDate(e.target.value)}
                      className="h-9 w-[150px] border-white/20 bg-white/10 text-xs text-white md:w-[170px] md:text-sm"
                    />
                    <Select value={dashboardEmpresa} onValueChange={setDashboardEmpresa}>
                      <SelectTrigger className="h-9 w-full min-w-[180px] border-white/20 bg-white/10 text-xs text-white md:text-sm">
                        <SelectValue placeholder="Empresa" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Todas">Todas</SelectItem>
                        {dashboardEmpresasEnDatos.map((empresa) => (
                          <SelectItem key={empresa} value={empresa}>
                            {empresa}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      onClick={() => void handleSync()}
                      disabled={syncing || loading}
                      className="bg-[#00e676] font-semibold text-[#0b1131] hover:bg-[#00c765]"
                    >
                      {syncing ? "Actualizando..." : "Actualizar"}
                    </Button>
                  </div>
                  <div className="rounded-lg border border-[#00e676]/40 bg-[#00e676]/15 px-4 py-2">
                    <p className="text-[10px] uppercase tracking-wide text-white/70">
                      Pendientes (filtro)
                    </p>
                    <p className="text-2xl font-bold leading-none text-[#00e676]">
                      {dashboardData?.kpi.totalPendientes ?? 0}
                    </p>
                  </div>
                </div>
                {dashboardLoading && (
                  <p className="text-xs text-white/60">Actualizando graficos...</p>
                )}
                {!dashboardLoading && dashboardAgeLabel && (
                  <p className="text-[10px] text-white/55">
                    Graficos del dashboard actualizados {dashboardAgeLabel}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>

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
                <ConductorTimelineMatrix
                  startDate={dashboardStartDate}
                  endDate={dashboardEndDate}
                  empresa={dashboardEmpresa}
                  dataRevision={refreshKey}
                />
              </TabsContent>

              <TabsContent value="reservas" className="mt-0 space-y-4 outline-none">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardHeader className="py-3">
                  <CardTitle className="text-sm font-semibold text-slate-800">
                    Distribucion global por estado
                  </CardTitle>
                  <p className="text-xs text-slate-500">Sin filtro de fecha ni empresa</p>
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

            <Card className="border-slate-200 bg-white shadow-sm">
              <CardHeader className="py-3">
                <CardTitle className="text-base font-semibold text-slate-800">
                  Pendientes por franja de programacion
                </CardTitle>
                <p className="text-xs text-slate-500">
                  Desde la primera hora con viaje pendiente hasta la ultima. Minimo 24 h en el eje; desplaza
                  horizontalmente si hay mas franjas.
                </p>
              </CardHeader>
              <CardContent className="pb-4">
                <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-slate-100 bg-slate-50/50 [-webkit-overflow-scrolling:touch]">
                  <div style={{ width: scheduleChartWidth, height: 420 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart
                        data={scheduleChartData}
                        margin={{ top: 12, right: 16, left: 8, bottom: 72 }}
                      >
                        <CartesianGrid stroke={CHART_GRID} vertical={false} />
                        <XAxis
                          dataKey="etiqueta"
                          tick={{ ...CHART_AXIS, fontSize: 10 }}
                          interval={0}
                          angle={-40}
                          textAnchor="end"
                          height={78}
                          tickFormatter={(v) =>
                            String(v).length > 18 ? `${String(v).slice(0, 16)}…` : String(v)
                          }
                          tickLine={false}
                          axisLine={{ stroke: CHART_GRID }}
                        />
                        <YAxis
                          tick={CHART_AXIS}
                          width={40}
                          tickLine={false}
                          axisLine={{ stroke: CHART_GRID }}
                          allowDecimals={false}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as { etiqueta: string; total: number };
                            return (
                              <div className="min-w-[200px] space-y-1 p-2" style={CHART_TOOLTIP_STYLE}>
                                <ChartTooltipRow label="Franja" value={p.etiqueta} />
                                <ChartTooltipRow label="Viajes pendientes" value={p.total} />
                              </div>
                            );
                          }}
                        />
                        <Bar
                          dataKey="total"
                          name="Viajes"
                          fill="#1e88e5"
                          radius={[4, 4, 0, 0]}
                          maxBarSize={SCHEDULE_SLOT_PX - 6}
                        />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </CardContent>
            </Card>

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
