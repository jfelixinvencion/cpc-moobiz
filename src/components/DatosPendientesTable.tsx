"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  buildDatosPendientesQueryParams,
  DATOS_PENDIENTES_COLUMNS,
} from "@/lib/datos-pendientes";

const PAGE_SIZE = 50;
/** Orden fijo en servidor (sin UI de ordenamiento en cabeceras). */
const API_SORT_BY = "n_servicios_30" as const;
const API_SORT_DIR = "desc" as const;
const FILTER_DEBOUNCE_MS = 500;

type DatosPendientesRow = Record<string, unknown>;

type ApiResponse = {
  data?: DatosPendientesRow[];
  total?: number;
  page?: number;
  pageSize?: number;
  source?: string | null;
  error?: boolean | string;
  message?: string;
  hint?: string;
  sucursalOptions?: string[];
  sucursalesDistinct?: string[];
};

function asText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

function formatDateTimeCell(value: unknown): string {
  const s = asText(value).trim();
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function sortBadgeClass(statusRaw: unknown): string {
  const s = asText(statusRaw).trim().toLowerCase();
  if (s === "completado") return "border-emerald-200 bg-emerald-100 text-emerald-700";
  if (s === "pendiente") return "border-red-200 bg-red-100 text-red-700";
  return "border-slate-200 bg-slate-100 text-slate-700";
}

export function DatosPendientesTable() {
  const [rows, setRows] = useState<DatosPendientesRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);

  const [sucursalFilter, setSucursalFilter] = useState("__all__");
  const [estadoFilter, setEstadoFilter] = useState("__all__");
  const [globalFilter, setGlobalFilter] = useState("__all__");
  const [sucursalDebounced, setSucursalDebounced] = useState("__all__");
  const [estadoDebounced, setEstadoDebounced] = useState("__all__");
  const [globalDebounced, setGlobalDebounced] = useState("__all__");
  const [searchText, setSearchText] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");
  const [sucursalOptions, setSucursalOptions] = useState<string[]>([]);
  const fetchAbortRef = useRef<AbortController | null>(null);

  const [detailRow, setDetailRow] = useState<DatosPendientesRow | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setSearchDebounced(searchText), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [searchText]);

  useEffect(() => {
    const id = window.setTimeout(() => setSucursalDebounced(sucursalFilter), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [sucursalFilter]);

  useEffect(() => {
    const id = window.setTimeout(() => setEstadoDebounced(estadoFilter), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [estadoFilter]);

  useEffect(() => {
    const id = window.setTimeout(() => setGlobalDebounced(globalFilter), FILTER_DEBOUNCE_MS);
    return () => window.clearTimeout(id);
  }, [globalFilter]);

  useEffect(() => {
    setPage(1);
  }, [sucursalDebounced, estadoDebounced, globalDebounced, searchDebounced]);

  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / PAGE_SIZE)), [total]);
  const pageClamped = Math.min(page, totalPages);

  const load = useCallback(async () => {
    fetchAbortRef.current?.abort();
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const query = buildDatosPendientesQueryParams({
        page: pageClamped,
        pageSize: PAGE_SIZE,
        sucursalFilter: sucursalDebounced,
        estadoFilter: estadoDebounced,
        globalFilter: globalDebounced,
        searchText: searchDebounced,
        sortBy: API_SORT_BY,
        sortDir: API_SORT_DIR,
      });
      const res = await fetch(`/api/moobiz-drivers-pendientes?${query}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await res.json()) as ApiResponse;
      if (!res.ok) {
        const msg =
          typeof body.message === "string" && body.message.trim()
            ? body.message
            : "No se pudo cargar Datos Pendientes.";
        throw new Error(msg);
      }
      setRows(Array.isArray(body.data) ? body.data : []);
      setTotal(typeof body.total === "number" ? body.total : 0);
      setSource(typeof body.source === "string" ? body.source : null);
      setHint(typeof body.hint === "string" ? body.hint : null);
      const branchOpts = Array.isArray(body.sucursalesDistinct)
        ? body.sucursalesDistinct
        : body.sucursalOptions;
      setSucursalOptions(
        Array.isArray(branchOpts) ? branchOpts.filter((x) => String(x).trim()) : [],
      );
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return;
      setRows([]);
      setTotal(0);
      setSource(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (fetchAbortRef.current === controller) {
        fetchAbortRef.current = null;
        setLoading(false);
      }
    }
  }, [
    pageClamped,
    sucursalDebounced,
    estadoDebounced,
    globalDebounced,
    searchDebounced,
  ]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => () => {
      fetchAbortRef.current?.abort();
    },
    [],
  );

  return (
    <Card className="border-slate-200 bg-white text-slate-900 shadow-sm">
      <CardHeader className="space-y-2 border-b border-slate-100 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-semibold">Datos Pendientes</CardTitle>
          <Badge variant="secondary" className="bg-slate-100 text-slate-700">
            {total} registro{total === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Sucursal</Label>
            <Select value={sucursalFilter} onValueChange={setSucursalFilter}>
              <SelectTrigger className="h-9 border-slate-200 bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                {sucursalOptions.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">Estado</Label>
            <Select value={estadoFilter} onValueChange={setEstadoFilter}>
              <SelectTrigger className="h-9 border-slate-200 bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todos</SelectItem>
                <SelectItem value="Pendiente">Pendiente</SelectItem>
                <SelectItem value="Completado">Completado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-slate-600">GLOBAL</Label>
            <Select value={globalFilter} onValueChange={setGlobalFilter}>
              <SelectTrigger className="h-9 border-slate-200 bg-white text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">Todas</SelectItem>
                <SelectItem value="LIMA">LIMA</SelectItem>
                <SelectItem value="PROVINCIA">PROVINCIA</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs text-slate-600">Buscar por Nombre Conductor</Label>
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Ej. Juan Pérez"
              className="h-9 border-slate-200 bg-white text-sm"
            />
          </div>
        </div>
        {source ? (
          <p className="text-[11px] text-slate-500">Fuente: {source}</p>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {error ? (
          <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            {error}
            {hint ? ` ${hint}` : ""}
          </p>
        ) : null}
        <div className="max-h-[min(70vh,640px)] overflow-y-auto overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-20 bg-slate-50 shadow-[0_1px_0_0_rgb(226,232,240)]">
              <TableRow className="border-slate-200 bg-slate-50 hover:bg-slate-50">
                {DATOS_PENDIENTES_COLUMNS.map((col) => (
                  <TableHead
                    key={col.key}
                    className="border-b border-slate-200 bg-slate-50 font-medium text-slate-900"
                  >
                    {col.label}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={DATOS_PENDIENTES_COLUMNS.length} className="py-8 text-center text-sm text-slate-500">
                    Cargando…
                  </TableCell>
                </TableRow>
              ) : rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={DATOS_PENDIENTES_COLUMNS.length} className="py-8 text-center text-sm text-slate-500">
                    No hay datos para los filtros seleccionados.
                  </TableCell>
                </TableRow>
              ) : (
                rows.map((row, idx) => {
                  const key = asText(row.id_conductor) || `dp-${pageClamped}-${idx}`;
                  const estado = asText(row.estado) || "—";
                  return (
                    <TableRow
                      key={key}
                      className="cursor-pointer border-slate-100 text-sm hover:bg-slate-50/80"
                      onClick={() => setDetailRow(row)}
                    >
                      <TableCell className="font-mono text-xs">{asText(row.id_conductor) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.nombre_conductor) || "—"}</TableCell>
                      <TableCell className="text-right text-xs tabular-nums">
                        {Number.isFinite(Number(row.n_servicios_lt_30))
                          ? Math.trunc(Number(row.n_servicios_lt_30))
                          : asText(row.n_servicios_lt_30) || "0"}
                      </TableCell>
                      <TableCell className="text-xs">{asText(row.sucursal) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.distrito_vive) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.turno) || "—"}</TableCell>
                      <TableCell className="text-xs">{formatDateTimeCell(row.vencimiento_brevete)}</TableCell>
                      <TableCell className="text-xs">{formatDateTimeCell(row.vencimiento_revision_tecnica)}</TableCell>
                      <TableCell className="text-xs">{formatDateTimeCell(row.vencimiento_soat)}</TableCell>
                      <TableCell className="text-xs">{asText(row.tipo_contribuyente) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.marca_contabilidad_moobiz) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.numero_ruc_factura) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.usuario_sunat) || "—"}</TableCell>
                      <TableCell className="text-xs">{asText(row.clave_sol_sunat) || "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`border text-[11px] ${sortBadgeClass(estado)}`}>
                          {estado}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </table>
        </div>

        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
          <p className="text-xs text-slate-600">
            Página {pageClamped} de {totalPages} · {PAGE_SIZE} por página
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.max(1, prev - 1))}
              disabled={pageClamped <= 1 || loading}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPage((prev) => Math.min(totalPages, prev + 1))}
              disabled={pageClamped >= totalPages || loading}
            >
              Siguiente
            </Button>
          </div>
        </div>

        <Dialog open={Boolean(detailRow)} onOpenChange={(open) => (!open ? setDetailRow(null) : null)}>
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Detalle de conductor</DialogTitle>
              <DialogDescription>
                Vista rápida de la fila seleccionada en Datos Pendientes.
              </DialogDescription>
            </DialogHeader>
            {detailRow ? (
              <div className="max-h-[60vh] overflow-auto rounded-md border border-slate-200 p-3">
                <pre className="whitespace-pre-wrap text-xs text-slate-700">
                  {JSON.stringify(detailRow, null, 2)}
                </pre>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}
