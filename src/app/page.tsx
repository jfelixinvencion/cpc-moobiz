"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

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
import { ServiciosPendientesCard } from "@/components/dashboard/ServiciosPendientesCard";
import { ControlOperacionesPanel } from "@/components/control-operaciones-panel";
import { OperacionesDriverFiltersProvider } from "@/context/operaciones-driver-filters-context";
import { MouseRevealHeaderLayout } from "@/components/mouse-reveal-header-layout";
import { useRefreshData } from "@/context/refresh-data-context";

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

/** Query `datosSub` para la vista en Flota (tab principal `value="datos"`). */
const DATOS_SUB_DATOS_PENDIENTES = "datos-pendientes" as const;
const DATOS_SUB_PENDIENTES = "pendientes" as const;
const DATOS_SUB_CONDUCTORES = "conductores" as const;
const OPERACIONES_SUB_CONTROL = "control" as const;
const OPERACIONES_SUB_SEGUIMIENTO = "seguimiento" as const;
const HISTORY_PAGE_SIZE = 50;

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
      if (value === "comercial") {
        router.push("/comercial");
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
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Dashboard
              </TabsTrigger>
              <TabsTrigger
                value="operaciones"
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Operaciones
              </TabsTrigger>
              <TabsTrigger
                value="datos"
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Flota
              </TabsTrigger>
              <TabsTrigger
                value="logs"
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Logs
              </TabsTrigger>
              <TabsTrigger
                value="historial"
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Historial
              </TabsTrigger>
              <TabsTrigger
                value="calidad"
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Calidad
              </TabsTrigger>
              <TabsTrigger
                value="comercial"
                className="flex-1 text-xs text-slate-200 data-active:bg-[#00e676] data-active:text-[#0b1131] md:text-sm"
              >
                Comercial
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
            <ServiciosPendientesCard
              active={mainTab === "dashboard" && dashboardSubTab === "reservas"}
              refreshKey={refreshKey}
            />
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
